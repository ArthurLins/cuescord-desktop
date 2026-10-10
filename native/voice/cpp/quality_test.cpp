#include <array>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

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
static void checkDynamics() {
  constexpr double pi = 3.141592653589793;
  // Arbitrary callback partitions must produce the same waveform and timing.
  std::vector<float> input(12000), whole, partitioned;
  for (size_t i = 0; i < input.size(); ++i)
    input[i] = float((18000 + 8000 * std::sin(2 * pi * 7 * i / 48000)) *
                     std::cos(2 * pi * 173 * i / 48000 + .5));
  whole = partitioned = input;
  PeakLimiter a, b;
  float* full[] = {whole.data()};
  a.process(full, 1, whole.size(), 2);
  size_t at = 0;
  for (size_t block = 1; at < partitioned.size(); ++block) {
    const size_t count = std::min((block * 137) % 481 + 1, partitioned.size() - at);
    float* chunk[] = {partitioned.data() + at};
    b.process(chunk, 1, count, 2);
    at += count;
  }
  double biggestArtifact = 0;
  for (size_t i = 0; i < whole.size(); ++i) {
    check(whole[i] == partitioned[i], "limiting must be independent of callback boundaries");
    check(std::isfinite(whole[i]) && std::abs(whole[i]) <= 29204,
          "loud voice must keep protected peaks without clipping");
    if (i < 1000) continue;
    const double delayed = input[i - 240];
    if (std::abs(delayed) > 1) {
      const double currentGain = whole[i] / delayed;
      if (std::abs(input[i - 241]) > 1) {
        const double previousGain = whole[i - 1] / double(input[i - 241]);
        biggestArtifact =
            std::max(biggestArtifact, std::abs(delayed * (currentGain - previousGain)));
      }
    }
  }
  check(biggestArtifact < 200,
        "smooth limiting must remove the multi-thousand-unit gain jumps from voiced signals");
  std::cout << "Maximum smooth-limiter gain step: " << biggestArtifact << '\n';

  for (int rate : {8000, 16000, 32000, 48000}) {
    PeakLimiter limiter;
    const size_t count = size_t(rate / 100), latency = size_t(rate / 200);
    std::array<float, 480> left{}, right{};
    float* stereo[] = {left.data(), right.data()};
    // Quiet stereo must stay transparent after the startup ramp and fixed delay.
    for (int frame = 0; frame < 4; ++frame) {
      left.fill(1000);
      right.fill(2000);
      limiter.process(stereo, 2, count, 1, rate);
      for (size_t i = 0; i < count; ++i) {
        check(right[i] == left[i] * 2, "stereo channels must share one gain and delay");
        if (frame > 0) check(left[i] == 1000, "quiet audio must retain its level and samples");
      }
    }
    // One-sample, alternating and random peaks must be caught, even near block edges.
    uint32_t random = 34567;
    for (int frame = 0; frame < 100; ++frame) {
      for (size_t i = 0; i < count; ++i) {
        random = random * 1664525u + 1013904223u;
        left[i] =
            frame < 3 ? (i == count - 1 ? 32767.0f : 100.0f) : float(int32_t(random >> 16) - 32768);
        right[i] = -left[i] * .5f;
      }
      limiter.process(stereo, 2, count, 4, rate);
      for (size_t i = 0; i < count; ++i) {
        check(std::abs(left[i]) <= 29204 && std::abs(right[i]) <= 29204,
              "look-ahead must catch short and random peaks in either stereo channel");
        if (frame > 0 || i >= latency)
          check(std::abs(right[i] + left[i] * .5f) < .01f,
                "limiting must preserve the stereo image under overload");
      }
    }
    left.fill(std::numeric_limits<float>::quiet_NaN());
    right.fill(std::numeric_limits<float>::infinity());
    limiter.process(stereo, 2, count, 1, rate);
    for (size_t i = 0; i < count; ++i)
      check(std::isfinite(left[i]) && std::isfinite(right[i]), "invalid samples must be sanitized");
    limiter.process(stereo, 2, count, 0, rate);
    for (size_t i = 0; i < count; ++i)
      check(left[i] == 0 && right[i] == 0, "mute must immediately flush both channels");
    limiter.process(stereo, 2, count, 1, rate);
    for (size_t i = 0; i < count; ++i)
      check(left[i] == 0 && right[i] == 0, "unmute must never emit a pre-mute sample");
  }
  // A source/device format change cannot play samples from the previous format.
  PeakLimiter format;
  std::array<float, 480> audio{};
  float* channel[] = {audio.data()};
  audio.fill(20000);
  format.process(channel, 1, 480, 1);
  audio.fill(0);
  format.process(channel, 1, 160, 1, 16000);
  for (size_t i = 0; i < 160; ++i)
    check(audio[i] == 0, "a rate change must reset all limiter history");
}
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
    checkDynamics();
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
    controls.deafened = false;
    mixer->Mix(2, &frame);
    for (size_t i = 0; i < frame.samples_per_channel() * frame.num_channels(); ++i)
      check(std::abs(int(frame.data()[i])) <= 29205,
            "stereo playback after deafen must keep linked peak protection");
    mixer->RemoveSource(&tone);
    std::cout << "Voice dynamics, playback and bounded recovery passed\n";
  } catch (const std::exception& e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
