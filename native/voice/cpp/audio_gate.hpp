#pragma once
#include <api/audio/audio_processing.h>
#include <api/audio/builtin_audio_processing_builder.h>
#include <api/environment/environment_factory.h>
#include <common_audio/vad/include/webrtc_vad.h>
#include <modules/audio_processing/audio_buffer.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <memory>

#include "audio_priority.hpp"
#include "noise_reducer.hpp"
#include "voice_dynamics.hpp"
struct Controls {
  std::atomic<bool> muted{true}, deafened{false}, ptt{false}, activity{true}, automatic{false};
  std::atomic<float> input{1}, output{1}, threshold{8}, level{0};
  std::atomic<bool> speaking{false}, transmitting{false};
  std::atomic<uint64_t> frames{0};
  std::atomic<NoiseMode> noiseMode{NoiseMode::Native};
  std::atomic<bool> noiseAvailable{false}, noiseActive{false}, noiseFailed{false};
  std::atomic<uint64_t> noiseFrames{0}, noiseMicros{0}, noiseMaxMicros{0};
  std::atomic<uint32_t> noiseRevision{0};
  std::atomic<bool> autoGain{false}, voiceBoost{true};
  std::atomic<bool> autoGainActive{false};
  std::atomic<uint64_t> autoGainErrors{0}, autoGainFrames{0};
  std::atomic<bool> captureMmcss{false}, renderMmcss{false};
  std::atomic<bool> captureMmcssInherited{false}, renderMmcssInherited{false};
  std::atomic<unsigned> capturePriorityError{0}, renderPriorityError{0};
  std::atomic<uint64_t> captureLateFrames{0}, captureMaxGapMicros{0}, renderFrames{0};
  std::atomic<uint64_t> limitedCaptureFrames{0}, limitedRenderFrames{0};
  std::atomic<float> captureLimiterGain{1}, renderLimiterGain{1};
};

class Gate final : public webrtc::CustomProcessing {
  Controls& controls;
  int release = 0;
  int sampleRate = 48000;
  std::unique_ptr<VadInst, decltype(&WebRtcVad_Free)> vad{WebRtcVad_Create(), WebRtcVad_Free};
  std::array<int16_t, 480> mono{};
  NoiseReducer noise;
  std::array<float, 1440> delay{};
  size_t delayIndex = 0;
  bool wasEnabled = false, wasAutomatic = false;
  uint32_t noiseRevision = 0;
  unsigned slowNoiseFrames = 0;
  const uint64_t noiseBudgetMicros;
  webrtc::Environment environment = webrtc::CreateEnvironment();
  webrtc::scoped_refptr<webrtc::AudioProcessing> gainController;
  std::array<std::array<float, 480>, 2> gainScratch{};
  PeakLimiter limiter;
  std::chrono::steady_clock::time_point previousFrame{};

 public:
  explicit Gate(Controls& controls, uint64_t noiseBudgetMicros = 8000)
      : controls(controls), noiseBudgetMicros(noiseBudgetMicros) {
    controls.noiseAvailable = noise.available();
  }
  void Initialize(int rate, int channels) override {
    release = 0;
    sampleRate = rate;
    if (vad) {
      WebRtcVad_Init(vad.get());
      WebRtcVad_set_mode(vad.get(), 3);
    }
    delay.fill(0);
    delayIndex = 0;
    wasEnabled = wasAutomatic = false;
    noise.initialize(rate, channels);
    controls.noiseActive = false;
    slowNoiseFrames = 0;
    limiter.reset();
    previousFrame = {};
    webrtc::AudioProcessing::Config config;
    config.gain_controller2.enabled = true;
    config.gain_controller2.adaptive_digital.enabled = true;
    config.gain_controller2.adaptive_digital.headroom_db = 6;
    config.gain_controller2.adaptive_digital.max_gain_db = 18;
    config.gain_controller2.adaptive_digital.initial_gain_db = 6;
    config.gain_controller2.adaptive_digital.max_gain_change_db_per_second = 3;
    // Public opaque APM API: avoid internal AGC2 structs whose ABI depends on
    // SDK-specific debug-dump build flags. This stage has no AEC or denoiser.
    gainController = webrtc::BuiltinAudioProcessingBuilder(config).Build(environment);
    webrtc::ProcessingConfig format;
    format.input_stream() = webrtc::StreamConfig(rate, channels);
    format.output_stream() = webrtc::StreamConfig(rate, channels);
    if (!gainController || gainController->Initialize(format) != 0) gainController = nullptr;
    controls.autoGainActive = false;
  }
  std::string ToString() const override { return "Cuescord voice gate"; }
  void Process(webrtc::AudioBuffer* audio) override {
    const auto& priority = AudioPriority::current();
    controls.captureMmcss = priority.registered;
    controls.captureMmcssInherited = priority.inherited;
    controls.capturePriorityError = priority.error;
    const auto now = std::chrono::steady_clock::now();
    if (previousFrame.time_since_epoch().count() != 0) {
      const uint64_t gap =
          std::chrono::duration_cast<std::chrono::microseconds>(now - previousFrame).count();
      controls.captureMaxGapMicros.store(std::max(gap, controls.captureMaxGapMicros.load()));
      if (gap > 40000) ++controls.captureLateFrames;
    }
    previousFrame = now;
    const auto count = audio->num_frames();
    const auto noiseMode = controls.noiseMode.load();
    const auto revision = controls.noiseRevision.load();
    if (revision != noiseRevision) {
      noise.initialize(sampleRate, int(audio->num_channels()));
      noiseRevision = revision;
      slowNoiseFrames = 0;
    }
    if (noiseMode == NoiseMode::Rnnoise && !controls.noiseFailed.load()) {
      const auto start = std::chrono::steady_clock::now();
      const bool success =
          audio->num_channels() == 1 && noise.process(audio->channels()[0], count, noiseMode);
      if (!success) {
        controls.noiseFailed = true;
        controls.noiseActive = false;
      } else {
        controls.noiseActive = true;
        const uint64_t micros = std::chrono::duration_cast<std::chrono::microseconds>(
                                    std::chrono::steady_clock::now() - start)
                                    .count();
        ++controls.noiseFrames;
        controls.noiseMicros.fetch_add(micros);
        controls.noiseMaxMicros.store(std::max(micros, controls.noiseMaxMicros.load()));
        // Persistently exceeding most of a 10 ms capture budget must degrade the
        // filter before a backlog can spoil the voice clock. No audio is queued.
        slowNoiseFrames = micros > noiseBudgetMicros ? slowNoiseFrames + 1 : 0;
        if (slowNoiseFrames >= 10) {
          controls.noiseFailed = true;
          controls.noiseActive = false;
        }
      }
    } else if (noiseMode != NoiseMode::Rnnoise) {
      noise.process(audio->channels()[0], count, noiseMode);
      controls.noiseActive = false;
    }
    // Main APM handles echo/standard NS. AGC2 runs after RNNoise too, with a
    // conservative gain ceiling and speech/noise estimation from cleaned audio.
    bool autoGainApplied = false;
    if (controls.autoGain.load() && gainController && count == size_t(sampleRate / 100) &&
        count <= 480 && audio->num_channels() > 0 && audio->num_channels() <= 2) {
      float* pointers[] = {gainScratch[0].data(), gainScratch[1].data()};
      for (size_t c = 0; c < audio->num_channels(); ++c)
        for (size_t i = 0; i < count; ++i)
          pointers[c][i] =
              std::isfinite(audio->channels()[c][i]) ? audio->channels()[c][i] / 32768.0f : 0;
      const webrtc::StreamConfig format(sampleRate, audio->num_channels());
      if (gainController->ProcessStream(pointers, format, format, pointers) == 0) {
        autoGainApplied = true;
        ++controls.autoGainFrames;
        for (size_t c = 0; c < audio->num_channels(); ++c)
          for (size_t i = 0; i < count; ++i) audio->channels()[c][i] = pointers[c][i] * 32768.0f;
      } else
        ++controls.autoGainErrors;
    }
    // Publish the last completed result once. Clearing the flag before every
    // ProcessStream made concurrent diagnostics report a healthy AGC as off.
    controls.autoGainActive = autoGainApplied;
    double energy = 0;
    for (size_t c = 0; c < audio->num_channels(); ++c)
      for (size_t i = 0; i < count; ++i) {
        const float raw = audio->channels()[c][i];
        const double sample = std::isfinite(raw) ? raw / 32768.0 : 0;
        energy += sample * sample;
      }
    const double rms = std::sqrt(energy / std::max<size_t>(1, count * audio->num_channels()));
    const float level =
        rms > 0 ? std::round(std::clamp(float((20 * std::log10(rms) + 60) * 2), 0.0f, 100.0f)) : 0;
    controls.level.store(level);
    const bool enabled = !controls.muted.load() && !controls.deafened.load() &&
                         controls.input.load() > 0 &&
                         (controls.activity.load() || controls.ptt.load());
    const bool automatic = controls.activity.load() && controls.automatic.load() && vad &&
                           sampleRate == 48000 && count == 480 && audio->num_channels() == 1;
    if (enabled != wasEnabled || automatic != wasAutomatic) {
      release = 0;
      delay.fill(0);
      delayIndex = 0;
      if (vad) {
        WebRtcVad_Init(vad.get());
        WebRtcVad_set_mode(vad.get(), 3);
      }
    }
    wasEnabled = enabled;
    wasAutomatic = automatic;
    bool audible = level >= controls.threshold.load();
    if (automatic) {
      for (size_t i = 0; i < count; ++i) {
        float sum = 0;
        for (size_t c = 0; c < audio->num_channels(); ++c) sum += audio->channels()[c][i];
        mono[i] = std::isfinite(sum)
                      ? int16_t(std::clamp(sum / std::max<size_t>(1, audio->num_channels()),
                                           -32768.0f, 32767.0f))
                      : 0;
      }
      const auto speech = WebRtcVad_Process(vad.get(), sampleRate, mono.data(), count);
      if (speech >= 0) audible = speech == 1;
    }
    if (!enabled)
      release = 0;
    else if (audible)
      release = 20;
    else if (release > 0)
      --release;
    const bool active = controls.activity.load() ? release > 0 : controls.ptt.load();
    const float gain = enabled && active ? controls.input.load() : 0;
    controls.transmitting.store(gain > 0);
    controls.speaking.store(gain > 0 && level >= 2);
    for (size_t c = 0; c < audio->num_channels(); ++c)
      for (size_t i = 0; i < count; ++i) {
        float value = audio->channels()[c][i];
        if (!std::isfinite(value)) value = 0;
        if (automatic && enabled) {
          const float delayed = delay[delayIndex];
          delay[delayIndex] = value;
          delayIndex = (delayIndex + 1) % delay.size();
          value = delayed;
        }
        audio->channels()[c][i] = value;
      }
    const float attenuation =
        limiter.process(audio->channels(), audio->num_channels(), count, gain);
    controls.captureLimiterGain = attenuation;
    if (attenuation < 0.999f) ++controls.limitedCaptureFrames;
    controls.frames.fetch_add(1);
  }
};
