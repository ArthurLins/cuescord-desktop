// MIT. Media and device access remain in this helper, outside Chromium.
#include <api/audio/audio_device.h>
#include <api/audio/builtin_audio_processing_builder.h>
#include <api/audio/create_audio_device_module.h>
#include <api/audio_codecs/builtin_audio_decoder_factory.h>
#include <api/audio_codecs/builtin_audio_encoder_factory.h>
#include <api/create_peerconnection_factory.h>
#include <api/environment/environment_factory.h>
#include <api/task_queue/default_task_queue_factory.h>
#include <modules/audio_device/include/audio_device_factory.h>
#include <modules/audio_processing/audio_buffer.h>
#include <rtc_base/ssl_adapter.h>
#include <rtc_base/thread.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <limits>
#include <mutex>
#include <thread>

#include "Device.hpp"
#include "mediasoupclient.hpp"
#ifdef _WIN32
#include <objbase.h>
#include <windows.h>
#include <winsock2.h>
#define VOICE_API extern "C" __declspec(dllexport)
#else
#define VOICE_API extern "C" __attribute__((visibility("default")))
#endif
using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;

#include "audio_devices.hpp"
#include "audio_gate.hpp"
#include "voice_health.hpp"
#include "voice_mixer.hpp"
#ifdef CUESCORD_VOICE_TRACE
#include "Logger.hpp"
class FunctionTrace final : public mediasoupclient::Logger::LogHandlerInterface {
 public:
  void OnLog(mediasoupclient::Logger::LogLevel, char* payload, size_t size) override {
    const auto prefix = std::string(payload, size).find(" | ");
    std::fprintf(stderr, "%.*s\n",
                 int(prefix == std::string::npos ? std::min<size_t>(size, 200) : prefix), payload);
  }
};
#endif
class Engine final : public mediasoupclient::SendTransport::Listener,
                     public mediasoupclient::RecvTransport::Listener,
                     public mediasoupclient::Producer::Listener,
                     public mediasoupclient::Consumer::Listener {
  std::mutex mutex;
  std::condition_variable wake;
  std::deque<Json> commands, events;
  std::map<uint64_t, std::promise<Json>> replies;
  std::atomic<bool> stopped{false};
  uint64_t nextSignal = 0;
  Controls controls;
  std::unique_ptr<webrtc::Thread> network, worker, signaling;
  std::unique_ptr<webrtc::TaskQueueFactory> queues;
  webrtc::scoped_refptr<webrtc::AudioDeviceModule> adm;
  webrtc::scoped_refptr<webrtc::AudioProcessing> apm;
  webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
  webrtc::scoped_refptr<webrtc::AudioTrackInterface> microphone;
  mediasoupclient::PeerConnection::Options options;
  std::unique_ptr<mediasoupclient::Device> device;
  std::unique_ptr<mediasoupclient::SendTransport> send;
  std::unique_ptr<mediasoupclient::RecvTransport> recv;
  std::unique_ptr<mediasoupclient::Producer> producer;
  std::map<std::string, std::unique_ptr<mediasoupclient::Consumer>> consumers;
  std::map<std::string, double> volumes;
  struct ReceiverHealth {
    Json params;
    ReceiverQualityMonitor monitor;
    bool networkWarning = false, statsWarning = false;
  };
  std::map<std::string, ReceiverHealth> receiverHealth;
  QualityWatchdog captureWatchdog;
  uint64_t captureRecoveries = 0, receiverRecoveries = 0;
  bool receiveStatsWarning = false;
  int roomBitrate = 64000;
  AudioDevices audioDevices;
  bool ssl = false;
  Json preferences = Json::object();
  bool fallbackApplied = false;
  bool com = false, powerProtection = false;
  bool sockets = false;
  std::thread runner;

  void emit(Json value) {
    std::lock_guard lock(mutex);
    // Meters are best effort. Signaling/responses are never silently dropped.
    const auto type = value.value("type", "");
    if ((type == "meter" || type == "quality") && events.size() >= 64) return;
    if (events.size() >= 256) {
      stopped = true;
      wake.notify_all();
      return;
    }
    events.push_back(std::move(value));
  }
  std::future<Json> request(const std::string& method, Json data) {
    std::lock_guard lock(mutex);
    if (stopped || replies.size() >= 32) throw std::runtime_error("signaling unavailable");
    const auto id = ++nextSignal;
    if (events.size() >= 256) throw std::runtime_error("event overflow");
    auto& promise = replies[id];
    auto result = promise.get_future();
    events.push_back(
        {{"type", "signal"}, {"requestId", id}, {"method", method}, {"data", std::move(data)}});
    return result;
  }
  void initialize() {
    if (factory) return;
#ifdef CUESCORD_VOICE_TRACE
    static FunctionTrace trace;
    mediasoupclient::Logger::SetHandler(&trace);
    mediasoupclient::Logger::SetLogLevel(mediasoupclient::Logger::LogLevel::LOG_TRACE);
#endif
#ifdef _WIN32
    WSADATA socketData{};
    if (WSAStartup(MAKEWORD(2, 2), &socketData) != 0)
      throw std::runtime_error("socket initialization failed");
    sockets = true;
    PROCESS_POWER_THROTTLING_STATE power{};
    power.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    power.ControlMask =
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
    power.StateMask = 0;
    powerProtection = SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, &power,
                                            sizeof(power)) != 0;
#endif
    webrtc::InitializeSSL();
    ssl = true;
    network = webrtc::Thread::CreateWithSocketServer();
    worker = webrtc::Thread::Create();
    signaling = webrtc::Thread::Create();
    if (!network->Start() || !worker->Start() || !signaling->Start())
      throw std::runtime_error("thread initialization failed");
    queues = webrtc::CreateDefaultTaskQueueFactory();
    const bool initialized = worker->BlockingCall([&] {
#ifdef _WIN32
      com = SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED));
      if (!com) return false;
      adm = webrtc::CreateWindowsCoreAudioAudioDeviceModule(queues.get(), true);
#else
      adm = webrtc::CreateAudioDeviceModule(webrtc::CreateEnvironment(),
                                            webrtc::AudioDeviceModule::kPlatformDefaultAudio);
#endif
      return adm && adm->Init() == 0;
    });
    if (!initialized) throw std::runtime_error("audio device unavailable");
    webrtc::BuiltinAudioProcessingBuilder builder;
    builder.SetCapturePostProcessing(std::make_unique<Gate>(controls));
    apm = builder.Build(webrtc::CreateEnvironment());
    factory = webrtc::CreatePeerConnectionFactory(
        network.get(), worker.get(), signaling.get(), adm,
        webrtc::CreateBuiltinAudioEncoderFactory(), webrtc::CreateBuiltinAudioDecoderFactory(),
        nullptr, nullptr, webrtc::make_ref_counted<VoiceMixer>(controls), apm);
    if (!factory) throw std::runtime_error("voice factory unavailable");
    options.factory = factory.get();
    options.config.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;
    device = std::make_unique<mediasoupclient::Device>();
  }
  Json devices() {
    initialize();
    return worker->BlockingCall([&] {
      Json list = Json::array();
      for (bool input : {true, false}) {
        const int total = input ? adm->RecordingDevices() : adm->PlayoutDevices();
        for (int i = 0; i < total; ++i) {
          char name[webrtc::kAdmMaxDeviceNameSize]{};
          char id[webrtc::kAdmMaxGuidSize]{};
          const int ok =
              input ? adm->RecordingDeviceName(i, name, id) : adm->PlayoutDeviceName(i, name, id);
          if (ok == 0)
            list.push_back({{"deviceId", id},
                            {"label", name},
                            {"kind", input ? "audioinput" : "audiooutput"}});
        }
      }
      return list;
    });
  }
  void selectDevices(const Json& data) {
    audioDevices.select(*worker, *adm, data.value("audioInputId", std::string{}),
                        data.value("audioOutputId", std::string{}));
  }
  void volume(mediasoupclient::Consumer* consumer) {
    auto* track = static_cast<webrtc::AudioTrackInterface*>(consumer->GetTrack());
    const auto id = consumer->GetProducerId();
    track->GetSource()->SetVolume(volumes.count(id) ? volumes[id] : 1);
  }
  static Json browserStats(Json rows) {
    // libwebrtc RTCStats::ToJson uses microseconds; RTCStatsReport in JS uses
    // milliseconds. Normalize at the boundary so both engines share units.
    for (auto& row : rows)
      if (row.contains("timestamp") && row.at("timestamp").is_number())
        row["timestamp"] = row.at("timestamp").get<double>() / 1000.0;
    return rows;
  }
  bool applyVoiceEncoding(int bitrate) {
    return signaling->BlockingCall([&] {
      auto* sender = producer->GetRtpSender();
      auto params = sender->GetParameters();
      if (params.encodings.size() != 1) return false;
      params.encodings[0].max_bitrate_bps = bitrate;
      params.encodings[0].adaptive_ptime = true;
      params.encodings[0].bitrate_priority = 4.0;
      params.encodings[0].network_priority = webrtc::Priority::kLow;
      return sender->SetParameters(params).ok();
    });
  }
  NoiseMode requestedNoise() const {
    if (!preferences.value("noiseSuppression", true)) return NoiseMode::Off;
    return preferences.value("noiseSuppressionMode", std::string{"native"}) == "rnnoise"
               ? NoiseMode::Rnnoise
               : NoiseMode::Native;
  }
  const char* noiseStatus() const {
    const auto mode = controls.noiseMode.load();
    if (mode == NoiseMode::Off) return "off";
    if (mode == NoiseMode::Native) return "native";
    if (controls.noiseFailed.load()) return "fallback";
    return controls.noiseActive.load() ? "rnnoise" : "loading";
  }
  void applyProcessing() {
    webrtc::AudioProcessing::Config config;
    config.echo_canceller.enabled = preferences.value("echoCancellation", true);
    const auto mode = requestedNoise();
    config.noise_suppression.enabled =
        mode == NoiseMode::Native || (mode == NoiseMode::Rnnoise && controls.noiseFailed.load());
    config.noise_suppression.level = webrtc::AudioProcessing::Config::NoiseSuppression::kHigh;
    // Gate owns the built-in AGC2 after denoising, including the RNNoise path.
    config.gain_controller1.enabled = false;
    config.gain_controller2.enabled = false;
    apm->ApplyConfig(config);
  }
  Json execute(const std::string& method, Json data) {
    initialize();
    if (method == "devices") return devices();
    if (method == "load") {
      if (device->IsLoaded()) throw std::runtime_error("already loaded");
      device->Load(data.at("rtpCapabilities"), &options, false);
      return {{"rtpCapabilities", device->GetRtpCapabilities()}};
    }
    if (method == "configure") {
      const bool processingChanged =
          !apm || preferences.empty() || data.contains("echoCancellation") ||
          data.contains("noiseSuppression") || data.contains("noiseSuppressionMode") ||
          data.contains("autoGainControl");
      const bool noiseChanged = preferences.empty() || data.contains("noiseSuppression") ||
                                data.contains("noiseSuppressionMode");
      preferences.update(data);
      data = preferences;
      selectDevices(data);
      if (noiseChanged) {
        controls.noiseMode = NoiseMode::Off;
        controls.noiseActive = false;
        controls.noiseFailed = !controls.noiseAvailable.load();
        ++controls.noiseRevision;
        fallbackApplied = false;
      }
      if (processingChanged) applyProcessing();
      controls.noiseMode = requestedNoise();
      if (data.contains("volumes"))
        volumes = data.at("volumes").get<std::map<std::string, double>>();
      for (auto& [id, consumer] : consumers) volume(consumer.get());
      return Json::object();
    }
    if (method == "transport") {
      if (!device->IsLoaded()) throw std::runtime_error("device not loaded");
      const auto& p = data.at("params");
      const auto direction = data.at("direction").get<std::string>();
      if (direction == "send" && !send)
        send.reset(device->CreateSendTransport(
            static_cast<mediasoupclient::SendTransport::Listener*>(this), p.at("id"),
            p.at("iceParameters"), p.at("iceCandidates"), p.at("dtlsParameters"), &options));
      else if (direction == "recv" && !recv)
        recv.reset(device->CreateRecvTransport(
            static_cast<mediasoupclient::RecvTransport::Listener*>(this), p.at("id"),
            p.at("iceParameters"), p.at("iceCandidates"), p.at("dtlsParameters"), &options));
      else
        throw std::runtime_error("invalid transport");
      auto* transport =
          direction == "send" ? static_cast<mediasoupclient::Transport*>(send.get()) : recv.get();
      transport->UpdateIceServers(data.value("iceServers", Json::array()));
      return Json::object();
    }
    if (method == "produce") {
      if (!send || producer) throw std::runtime_error("invalid producer");
      webrtc::AudioOptions audio;
      audio.echo_cancellation = preferences.value("echoCancellation", true);
      audio.auto_gain_control = false;  // The post-denoising stage owns AGC2.
      audio.noise_suppression =
          requestedNoise() == NoiseMode::Native ||
          (requestedNoise() == NoiseMode::Rnnoise && controls.noiseFailed.load());
      auto source = factory->CreateAudioSource(audio);
      microphone = factory->CreateAudioTrack("cuescord-microphone", source.get());
      const int bitrate = std::clamp(data.value("bitrate", 64000), 6000, 510000);
      roomBitrate = bitrate;
      // Negotiate the highest room ceiling once. Encoding max_bitrate_bps
      // enforces this room and can change live in either direction, without SDP.
      Json codecs = {{"opusMaxAverageBitrate", uint32_t(256000)},
                     {"opusStereo", false},
                     {"opusFec", true},
                     {"opusDtx", true}};
      std::vector<webrtc::RtpEncodingParameters> encodings(1);
      encodings[0].max_bitrate_bps = bitrate;
      encodings[0].adaptive_ptime = true;
      encodings[0].bitrate_priority = 4.0;  // Browser priority: "high".
      // Keep network_priority at kLow. A custom DSCP priority disables WebRTC's
      // audio bitrate allocation; bitrate priority does not change DSCP.
      producer.reset(send->Produce(this, microphone.get(), &encodings, &codecs, nullptr));
      // Audio transceiver initialization can ignore adaptive/priority fields.
      // Apply them to the installed sender; stats expose the actual parameters.
      if (!applyVoiceEncoding(bitrate))
        throw std::runtime_error("audio encoding update failed");
      applyProcessing();  // The media engine may apply source options during track registration.
      return {{"producerId", producer->GetId()}};
    }
    if (method == "set-bitrate") {
      const int bitrate = data.at("bitrate").get<int>();
      if (!producer || (bitrate != 32000 && bitrate != 64000 && bitrate != 96000 &&
                        bitrate != 128000 && bitrate != 256000))
        throw std::runtime_error("invalid room bitrate");
      const bool applied = applyVoiceEncoding(bitrate);
      if (!applied) throw std::runtime_error("audio bitrate update failed");
      roomBitrate = bitrate;
      return {{"bitrate", roomBitrate}};
    }
    if (method == "consume") {
      if (!recv || consumers.size() >= 256) throw std::runtime_error("invalid consumer");
      const auto id = data.at("producerId").get<std::string>();
      if (consumers.count(id)) return Json::object();
      auto params = data.at("rtpParameters");
      consumers[id].reset(recv->Consume(this, data.at("id"), id, "audio", &params));
      volume(consumers[id].get());
      receiverHealth[id].params = data;
      return Json::object();
    }
    if (method == "close-consumer") {
      const auto id = data.at("producerId").get<std::string>();
      auto item = consumers.find(id);
      if (item != consumers.end()) {
        item->second->Close();
        consumers.erase(item);
      }
      receiverHealth.erase(id);
      return Json::object();
    }
    if (method == "stats") {
      const auto encodingParameters = producer
          ? signaling->BlockingCall([&] {
              return producer->GetRtpSender()->GetParameters().encodings;
            })
          : std::vector<webrtc::RtpEncodingParameters>{};
      const int encodingBitrate = encodingParameters.empty()
          ? 0 : encodingParameters[0].max_bitrate_bps.value_or(0);
      return {{"send", send ? browserStats(send->GetStats()) : Json::array()},
              {"recv", recv ? browserStats(recv->GetStats()) : Json::array()},
              {"captureFrames", controls.frames.load()},
              {"inputLevel", controls.level.load()},
              {"engine", "libwebrtc-m140"},
              {"powerProtection", powerProtection},
              {"roomAudioBitrate", roomBitrate},
              {"microphoneEncodingBitrate", encodingBitrate},
              {"microphoneAdaptivePtime",
               !encodingParameters.empty() && encodingParameters[0].adaptive_ptime},
              {"microphoneBitratePriority",
               encodingParameters.empty() ? 0 : encodingParameters[0].bitrate_priority},
              {"captureMmcss", controls.captureMmcss.load()},
              {"renderMmcss", controls.renderMmcss.load()},
              {"captureMmcssInherited", controls.captureMmcssInherited.load()},
              {"renderMmcssInherited", controls.renderMmcssInherited.load()},
              {"capturePriorityError", controls.capturePriorityError.load()},
              {"renderPriorityError", controls.renderPriorityError.load()},
              {"captureLateFrames", controls.captureLateFrames.load()},
              {"captureMaxGapMs", double(controls.captureMaxGapMicros.load()) / 1000},
              {"limitedCaptureFrames", controls.limitedCaptureFrames.load()},
              {"limitedRenderFrames", controls.limitedRenderFrames.load()},
              {"captureLimiterGain", controls.captureLimiterGain.load()},
              {"renderLimiterGain", controls.renderLimiterGain.load()},
              {"voiceBoost", controls.voiceBoost.load()},
              {"autoGainActive", controls.autoGainActive.load()},
              {"autoGainErrors", controls.autoGainErrors.load()},
              {"autoGainFrames", controls.autoGainFrames.load()},
              {"captureRecoveries", captureRecoveries},
              {"receiverRecoveries", receiverRecoveries},
              {"noiseSuppressionMode",
               preferences.value("noiseSuppressionMode", std::string{"native"})},
              {"noiseProcessorStatus", noiseStatus()},
              {"webrtcNoiseSuppression", apm->GetConfig().noise_suppression.enabled},
              {"noiseModel", "rnnoise-70f1d25-full-0a8755f8"},
              {"noiseFrames", controls.noiseFrames.load()},
              {"noiseProcessingAverageMs",
               controls.noiseFrames.load() > 0
                   ? double(controls.noiseMicros.load()) / controls.noiseFrames.load() / 1000
                   : 0},
              {"noiseProcessingMaxMs", double(controls.noiseMaxMicros.load()) / 1000}};
    }
    if (method == "restart-ice" || method == "ice-servers") {
      auto* transport = data.value("direction", "") == "send"
                            ? static_cast<mediasoupclient::Transport*>(send.get())
                            : recv.get();
      if (!transport) throw std::runtime_error("transport missing");
      if (method == "restart-ice")
        transport->RestartIce(data.at("iceParameters"));
      else
        transport->UpdateIceServers(data.at("iceServers"));
      return Json::object();
    }
    throw std::runtime_error("unsupported voice command");
  }
  void loop() {
    auto meterAt = Clock::now(), healthAt = Clock::now();
    std::string lastNoiseStatus;
    uint64_t healthFrames = 0, lateFrames = 0;
    while (!stopped) {
      Json command;
      {
        std::unique_lock lock(mutex);
        wake.wait_for(lock, std::chrono::milliseconds(50),
                      [&] { return stopped || !commands.empty(); });
        if (stopped) break;
        if (!commands.empty()) {
          command = std::move(commands.front());
          commands.pop_front();
        }
      }
      if (!command.is_null()) {
        try {
          emit({{"type", "response"},
                {"id", command.at("id")},
                {"data", execute(command.at("method"), command.value("data", Json::object()))}});
        } catch (...) {
          emit({{"type", "response"},
                {"id", command.at("id")},
                {"error", "native-operation-failed"}});
        }
      }
      if (apm && requestedNoise() == NoiseMode::Rnnoise && controls.noiseFailed.load() &&
          !fallbackApplied) {
        applyProcessing();  // Never change APM configuration from its audio callback.
        fallbackApplied = true;
      }
      if (apm && lastNoiseStatus != noiseStatus()) {
        lastNoiseStatus = noiseStatus();
        emit({{"type", "processing-state"},
              {"noiseProcessorStatus", lastNoiseStatus},
              {"noiseSuppressionEffective", controls.noiseMode.load() != NoiseMode::Off}});
      }
      if (producer && Clock::now() - healthAt >= std::chrono::seconds(2)) {
        const auto now = Clock::now();
        const auto elapsed = std::chrono::duration<double>(now - healthAt).count();
        const auto frames = controls.frames.load();
        const auto ratio = double(frames - healthFrames) / (elapsed * 100);
        const auto late = controls.captureLateFrames.load();
        const auto stamp =
            std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
        const auto decision = captureWatchdog.observe(
            stamp, elapsed <= 4,
            ratio < 0.85 ||
                double(late - lateFrames) / std::max<uint64_t>(1, frames - healthFrames) > 0.05);
        if (decision == RecoveryDecision::Recover) {
          if (audioDevices.restartCapture(*worker, *adm)) {
            apm->Initialize();
            ++captureRecoveries;
            emit({{"type", "quality"}, {"reason", "capture-recovered"}});
          } else
            emit({{"type", "health"}, {"reason", "capture-recovery-failed"}});
        } else if (decision == RecoveryDecision::Exhausted)
          emit({{"type", "health"}, {"reason", "capture-recovery-exhausted"}});
        // One RTC stats snapshot for the receive transport, irrespective of
        // room size. Never synchronously request one report per speaker.
        Json receiveStats = Json::array();
        try {
          if (recv && !receiverHealth.empty()) receiveStats = recv->GetStats();
          receiveStatsWarning = false;
        } catch (...) {
          if (!receiveStatsWarning)
            emit({{"type", "quality"}, {"reason", "receiver-stats-unavailable"}});
          receiveStatsWarning = true;
        }
        for (auto& [id, health] : receiverHealth) {
          const auto found = consumers.find(id);
          if (found == consumers.end()) continue;
          bool repairing = false;
          try {
            bool matched = false;
            const auto ssrc =
                health.params.at("rtpParameters").at("encodings").at(0).at("ssrc").get<uint32_t>();
            for (const auto& row : receiveStats) {
              if (row.value("type", "") != "inbound-rtp" || row.value("ssrc", uint32_t{0}) != ssrc)
                continue;
              matched = true;
              const bool complete = row.contains("totalSamplesReceived") &&
                                    row.contains("concealedSamples") &&
                                    row.contains("removedSamplesForAcceleration") &&
                                    row.contains("packetsReceived") && row.contains("packetsLost");
              const uint64_t samples = row.value("totalSamplesReceived", uint64_t{0}),
                             concealed = row.value("concealedSamples", uint64_t{0}),
                             accelerated = row.value("removedSamplesForAcceleration", uint64_t{0}),
                             received = row.value("packetsReceived", uint64_t{0});
              const int64_t lostSigned = row.value("packetsLost", int64_t{0});
              const uint64_t lost = uint64_t(std::max<int64_t>(0, lostSigned));
              const auto action =
                  health.monitor.observe(stamp, complete && elapsed <= 4,
                                         {samples, concealed, accelerated, received, lost});
              health.statsWarning = false;
              if (action == RecoveryDecision::Network && !health.networkWarning)
                emit({{"type", "quality"}, {"reason", "network-degraded"}});
              health.networkWarning = action == RecoveryDecision::Network;
              if (action == RecoveryDecision::Recover) {
                repairing = true;
                found->second->Close();
                consumers.erase(found);
                // Ask the authenticated web signaling owner for a fresh SFU
                // consumer. Reusing its old MID would either duplicate the SDP
                // section or retain the same decoder/NetEq state.
                health.params = request("repair-consumer", {{"producerId", id}}).get();
                const auto& p = health.params;
                auto params = p.at("rtpParameters");
                consumers[id].reset(recv->Consume(this, p.at("id"), id, "audio", &params));
                volume(consumers[id].get());
                request("resume-consumer", {{"consumerId", p.at("id")}}).get();
                health.monitor.resetSamples();
                ++receiverRecoveries;
                emit({{"type", "quality"}, {"reason", "receiver-recovered"}});
              } else if (action == RecoveryDecision::Exhausted)
                emit({{"type", "health"}, {"reason", "receiver-recovery-exhausted"}});
              break;
            }
            if (!matched) health.monitor.resetSamples();
          } catch (...) {
            health.monitor.resetSamples();
            if (repairing || !health.statsWarning)
              emit({{"type", repairing ? "health" : "quality"},
                    {"reason",
                     repairing ? "receiver-recovery-failed" : "receiver-stats-unavailable"}});
            health.statsWarning = true;
          }
        }
        healthAt = now;
        healthFrames = frames;
        lateFrames = late;
      }
      if (producer && Clock::now() - meterAt >= std::chrono::milliseconds(100)) {
        meterAt = Clock::now();
        emit({{"type", "meter"},
              {"level", controls.level.load()},
              {"speaking", controls.speaking.load()},
              {"transmitting", controls.transmitting.load()},
              {"captureFrames", controls.frames.load()}});
      }
    }
    for (auto& [id, consumer] : consumers) consumer->Close();
    consumers.clear();
    if (producer) producer->Close();
    producer.reset();
    if (send) send->Close();
    if (recv) recv->Close();
    send.reset();
    recv.reset();
    microphone = nullptr;
    device.reset();
    factory = nullptr;
    apm = nullptr;
    if (worker && adm)
      worker->BlockingCall([&] {
        adm->StopRecording();
        adm->StopPlayout();
        adm->Terminate();
        adm = nullptr;
      });
#ifdef _WIN32
    if (worker && com) worker->BlockingCall([&] { CoUninitialize(); });
#endif
    queues.reset();
    signaling.reset();
    worker.reset();
    network.reset();
    if (ssl) webrtc::CleanupSSL();
#ifdef _WIN32
    if (sockets) WSACleanup();
#endif
  }

 public:
  Engine() : runner([this] { loop(); }) {}
  ~Engine() {
    {
      std::lock_guard lock(mutex);
      stopped = true;
      for (auto& [id, promise] : replies)
        promise.set_exception(std::make_exception_ptr(std::runtime_error("voice stopped")));
      replies.clear();
    }
    wake.notify_all();
    runner.join();
  }
  int submit(const char* bytes, size_t size) {
    if (size > 1024 * 1024) return -1;
    try {
      auto message = Json::parse(bytes, bytes + size);
      auto data = message.value("data", Json::object());
      const std::string method = message.at("method");
      if (method == "configure") {
        if (data.contains("muted")) controls.muted = data.at("muted").get<bool>();
        if (data.contains("deafened")) controls.deafened = data.at("deafened").get<bool>();
        if (data.contains("ptt")) controls.ptt = data.at("ptt").get<bool>();
        if (data.contains("inputMode"))
          controls.activity = data.at("inputMode") == "voice-activity";
        if (data.contains("activationMode"))
          controls.automatic = data.at("activationMode") == "automatic";
        if (data.contains("activationThreshold"))
          controls.threshold =
              std::clamp(data.at("activationThreshold").get<float>(), 0.0f, 100.0f);
        if (data.contains("inputVolume"))
          controls.input = std::clamp(data.at("inputVolume").get<float>() / 100, 0.0f, 2.0f);
        if (data.contains("outputVolume"))
          controls.output = std::clamp(data.at("outputVolume").get<float>() / 100, 0.0f, 2.0f);
        if (data.contains("autoGainControl"))
          controls.autoGain = data.at("autoGainControl").get<bool>();
        if (data.contains("voiceBoost")) controls.voiceBoost = data.at("voiceBoost").get<bool>();
      }
      std::lock_guard lock(mutex);
      if (stopped) return -1;
      if (method == "reply") {
        auto reply = replies.find(data.at("requestId").get<uint64_t>());
        if (reply != replies.end()) {
          if (data.contains("error"))
            reply->second.set_exception(
                std::make_exception_ptr(std::runtime_error("signaling failed")));
          else
            reply->second.set_value(data.value("result", Json::object()));
          replies.erase(reply);
        }
        events.push_back(
            {{"type", "response"}, {"id", message.at("id")}, {"data", Json::object()}});
      } else {
        if (commands.size() >= 64) return -1;
        commands.push_back(std::move(message));
        wake.notify_all();
      }
      return 0;
    } catch (...) {
      return -1;
    }
  }
  size_t poll(char* buffer, size_t capacity) {
    std::lock_guard lock(mutex);
    if (events.empty()) return 0;
    const auto value = events.front().dump();
    if (value.size() > capacity) {
      stopped = true;
      throw std::runtime_error("event exceeds protocol capacity");
    }
    std::memcpy(buffer, value.data(), value.size());
    events.pop_front();
    return value.size();
  }
  std::future<void> OnConnect(mediasoupclient::Transport* transport, const Json& dtls) override {
    auto future = request("connect-transport",
                          {{"transportId", transport->GetId()}, {"dtlsParameters", dtls}});
    return std::async(std::launch::deferred, [f = std::move(future)]() mutable {
      if (f.wait_for(std::chrono::seconds(10)) != std::future_status::ready)
        throw std::runtime_error("signaling timeout");
      f.get();
    });
  }
  std::future<std::string> OnProduce(mediasoupclient::SendTransport* transport, const std::string&,
                                     Json params, const Json&) override {
    auto future = request("produce", {{"transportId", transport->GetId()},
                                      {"kind", "audio"},
                                      {"rtpParameters", params},
                                      {"appData", Json::object()}});
    return std::async(std::launch::deferred, [f = std::move(future)]() mutable {
      if (f.wait_for(std::chrono::seconds(10)) != std::future_status::ready)
        throw std::runtime_error("signaling timeout");
      return f.get().at("producerId").get<std::string>();
    });
  }
  std::future<std::string> OnProduceData(mediasoupclient::SendTransport*, const Json&,
                                         const std::string&, const std::string&,
                                         const Json&) override {
    std::promise<std::string> result;
    result.set_exception(std::make_exception_ptr(std::runtime_error("voice only")));
    return result.get_future();
  }
  void OnConnectionStateChange(mediasoupclient::Transport* transport,
                               const std::string& state) override {
    emit({{"type", "transport-state"}, {"transportId", transport->GetId()}, {"state", state}});
  }
  void OnTransportClose(mediasoupclient::Producer*) override {}
  void OnTransportClose(mediasoupclient::Consumer*) override {}
};

VOICE_API unsigned cuescord_voice_version() noexcept { return 1; }
VOICE_API unsigned cuescord_voice_capabilities() noexcept {
  return 3;
}  // RNNoise + quality controls.
VOICE_API void* cuescord_voice_create() noexcept {
  try {
    return new Engine();
  } catch (...) {
    return nullptr;
  }
}
VOICE_API int cuescord_voice_send(void* engine, const char* bytes, size_t size) noexcept {
  return engine ? static_cast<Engine*>(engine)->submit(bytes, size) : -1;
}
VOICE_API size_t cuescord_voice_poll(void* engine, char* buffer, size_t capacity) noexcept {
  // Exceptions must never unwind across Rust's C ABI. A value above capacity
  // makes the helper exit, allowing Electron to revoke the session and fallback.
  try {
    return engine ? static_cast<Engine*>(engine)->poll(buffer, capacity) : 0;
  } catch (...) {
    return std::numeric_limits<size_t>::max();
  }
}
VOICE_API void cuescord_voice_destroy(void* engine) noexcept {
  delete static_cast<Engine*>(engine);
}
