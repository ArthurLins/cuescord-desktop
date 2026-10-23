#pragma once
#include <api/audio/audio_frame.h>
#include <api/audio/audio_mixer.h>

#include <algorithm>
#include <array>
#include <atomic>

#include "voice_controls.hpp"
#include "voice_dynamics.hpp"

// ChannelReceive's PCM16 scaling can saturate before the final mixer limiter.
// Keep SDK source volume at unity and own each participant's protected gain.
class ProtectedVoiceSource final : public webrtc::AudioMixer::Source {
  webrtc::AudioMixer::Source& source;
  Controls& controls;
  const int ssrc;
  std::atomic<float> requestedGain{1};
  PeakLimiter limiter;
  std::array<std::array<float, 480>, 2> scratch{};

 public:
  ProtectedVoiceSource(webrtc::AudioMixer::Source& source, Controls& controls)
      : source(source), controls(controls), ssrc(source.Ssrc()) {}
  void setGain(float gain) {
    requestedGain = std::isfinite(gain) ? std::clamp(gain, 0.0f, 2.0f) : 0;
  }
  int Ssrc() const override { return ssrc; }
  int PreferredSampleRate() const override { return source.PreferredSampleRate(); }
  AudioFrameInfo GetAudioFrameWithInfo(int rate, webrtc::AudioFrame* frame) override {
    const auto info = source.GetAudioFrameWithInfo(rate, frame);
    const auto count = frame->samples_per_channel(), channels = frame->num_channels();
    const float gain = requestedGain.load();
    if (info != AudioFrameInfo::kNormal || gain == 0 || count > 480 || channels == 0 ||
        channels > 2) {
      frame->Mute();
      limiter.reset();
      return info == AudioFrameInfo::kError ? info : AudioFrameInfo::kMuted;
    }
    const auto* input = frame->data();
    for (size_t i = 0; i < count; ++i)
      for (size_t c = 0; c < channels; ++c) scratch[c][i] = input[i * channels + c];
    float* buffers[] = {scratch[0].data(), scratch[1].data()};
    const float attenuation =
        limiter.process(buffers, channels, count, gain, frame->sample_rate_hz());
    if (attenuation < .999f) ++controls.limitedSourceFrames;
    controls.sourceLimiterMinimumGain =
        std::min(controls.sourceLimiterMinimumGain.load(), attenuation);
    auto* output = frame->mutable_data();
    for (size_t i = 0; i < count; ++i)
      for (size_t c = 0; c < channels; ++c)
        output[i * channels + c] = int16_t(std::lround(scratch[c][i]));
    return info;
  }
};
