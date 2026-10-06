#include <array>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

#include "voice_health.hpp"
#include "voice_mixer.hpp"
static void check(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}
class Tone final : public webrtc::AudioMixer::Source {
 public:
  AudioFrameInfo GetAudioFrameWithInfo(int rate, webrtc::AudioFrame* frame) override {
    std::array<int16_t, 480> data{};
    for (int i = 0; i < rate / 100; ++i) data[i] = int16_t(20000 * std::sin(i * 0.1));
    frame->UpdateFrame(0, data.data(), rate / 100, rate, webrtc::AudioFrame::kNormalSpeech,
                       webrtc::AudioFrame::kVadActive, 1);
    return AudioFrameInfo::kNormal;
  }
  int Ssrc() const override { return 1; }
  int PreferredSampleRate() const override { return 48000; }
};
int main() {
  try {
#ifdef _WIN32
    DWORD task = 0;
    HANDLE existing = AvSetMmThreadCharacteristicsW(L"Audio", &task);
    if (existing) {
      {
        AudioPriority inherited;
        check(inherited.registered && inherited.inherited && inherited.error == 0,
              "an existing SDK MMCSS registration must remain active");
      }
      check(AvSetMmThreadPriority(existing, AVRT_PRIORITY_NORMAL) != 0,
            "destroying the wrapper must not revoke an SDK-owned registration");
      check(AvRevertMmThreadCharacteristics(existing) != 0,
            "MMCSS must be released by its actual owner");
    }
#endif
    PeakLimiter limiter;
    std::array<float, 480> samples{};
    float* channels[] = {samples.data()};
    for (size_t i = 0; i < samples.size(); ++i) samples[i] = 25000 * std::sin(i * 0.1);
    const auto original = samples;
    const float reduction = limiter.process(channels, 1, samples.size(), 2);
    check(reduction < 1, "200% gain must activate peak protection");
    for (size_t i = 0; i < samples.size(); ++i) {
      check(std::abs(samples[i]) <= 29205, "peaks must retain headroom");
      check(std::abs(samples[i] - original[i] * 2 * reduction) < 0.02,
            "limiting must preserve waveform shape");
    }
    samples.fill(std::numeric_limits<float>::quiet_NaN());
    limiter.process(channels, 1, samples.size(), 1);
    check(samples[0] == 0, "invalid values must never reach the output");
    samples.fill(1000);
    limiter.process(channels, 1, samples.size(), 0);
    check(samples[0] == 0, "mute must immediately revoke audio");
    QualityWatchdog health;
    check(health.observe(0, true, true) == RecoveryDecision::None, "startup needs warmup");
    check(health.observe(10000, true, true) == RecoveryDecision::None,
          "one bad window is transient");
    check(health.observe(12000, true, true, true) == RecoveryDecision::Network,
          "network loss must not reset healthy receivers");
    check(health.observe(14000, true, true) == RecoveryDecision::None,
          "loss must reset the local fault streak");
    check(health.observe(16000, true, true) == RecoveryDecision::None, "second bad window waits");
    check(health.observe(18000, true, true) == RecoveryDecision::Recover,
          "persistent local faults need a bounded repair");
    check(health.observe(20000, true, true) == RecoveryDecision::None,
          "cooldown prevents repair loops");
    health.observe(48000, true, true);
    health.observe(50000, true, true);
    check(health.observe(52000, true, true) == RecoveryDecision::Recover,
          "second repair is allowed after cooldown");
    health.observe(82000, true, true);
    health.observe(84000, true, true);
    check(health.observe(86000, true, true) == RecoveryDecision::Exhausted,
          "exhaustion must request engine fallback");
    QualityWatchdog missing;
    missing.observe(0, true, false);
    for (int i = 10000; i < 50000; i += 2000)
      check(missing.observe(i, false, true) == RecoveryDecision::None,
            "missing stats must never imply a fault");
    ReceiverQualityMonitor receiver;
    ReceiverQualitySample received;
    receiver.observe(0, true, received);
    for (int time = 2000; time <= 20000; time += 2000) {
      received.samples += 96000;
      received.concealed += 96000;
      check(receiver.observe(time, true, received) == RecoveryDecision::None,
            "silence and paused senders must not be mistaken for a damaged receiver");
    }
    for (int time = 22000; time <= 28000; time += 2000) {
      received.samples += 96000;
      received.concealed += 30000;
      received.received += 90;
      received.lost += 10;
      check(receiver.observe(time, true, received) == RecoveryDecision::Network,
            "real network loss must be diagnosed without restarting the decoder");
    }
    for (int time = 30000; time <= 34000; time += 2000) {
      received.samples += 96000;
      received.accelerated += 12000;
      received.received += 100;
      check(receiver.observe(time, true, received) ==
                (time == 34000 ? RecoveryDecision::Recover : RecoveryDecision::None),
            "persistent acceleration with packet flow must recover a stuck receiver");
    }
    receiver.resetSamples();
    check(receiver.observe(36000, true, {}) == RecoveryDecision::None,
          "replacement receiver counters must not reuse the old window");
    Controls controls;
    controls.voiceBoost = true;
    controls.output = 2;
    auto mixer = webrtc::make_ref_counted<VoiceMixer>(controls);
    Tone tone;
    check(mixer->AddSource(&tone), "mixer must preserve WebRTC source ownership");
    webrtc::AudioFrame frame;
    mixer->Mix(1, &frame);
    for (size_t i = 0; i < frame.samples_per_channel(); ++i)
      check(std::abs(int(frame.data()[i])) <= 29205,
            "boost and output gain need final peak protection");
    controls.deafened = true;
    mixer->Mix(1, &frame);
    for (size_t i = 0; i < frame.samples_per_channel(); ++i)
      check(frame.data()[i] == 0, "deafen must silence the native mix");
    mixer->RemoveSource(&tone);
    std::cout << "Voice dynamics, playback and bounded recovery passed\n";
  } catch (const std::exception& e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
