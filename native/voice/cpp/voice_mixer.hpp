#pragma once
#include <api/audio/audio_frame.h>
#include <modules/audio_mixer/audio_mixer_impl.h>

#include <array>

#include "audio_gate.hpp"

// Remote microphone audio only. Browser camera/screen audio never reaches this
// mixer. WebRTC still performs source mixing and its built-in mix limiter.
class VoiceMixer : public webrtc::AudioMixer {
  Controls& controls;
  webrtc::scoped_refptr<webrtc::AudioMixerImpl> mixer = webrtc::AudioMixerImpl::Create();
  PeakLimiter limiter;
  std::array<std::array<float, 480>, 2> scratch{};

 public:
  explicit VoiceMixer(Controls& controls) : controls(controls) {}
  bool AddSource(Source* source) override { return mixer->AddSource(source); }
  void RemoveSource(Source* source) override { mixer->RemoveSource(source); }
  void Mix(size_t channels, webrtc::AudioFrame* frame) override {
    const auto& priority = AudioPriority::current();
    controls.renderMmcss = priority.registered;
    controls.renderMmcssInherited = priority.inherited;
    controls.renderPriorityError = priority.error;
    mixer->Mix(channels, frame);
    const auto count = frame->samples_per_channel(), channelCount = frame->num_channels();
    // A mismatched SDK format must never read beyond the fixed scratch buffer.
    if (count > scratch[0].size() || channelCount == 0 || channelCount > scratch.size()) {
      frame->Mute();
      limiter.reset();
      return;
    }
    auto* samples = frame->mutable_data();
    for (size_t i = 0; i < count; ++i)
      for (size_t c = 0; c < channelCount; ++c) scratch[c][i] = samples[i * channelCount + c];
    float* buffers[] = {scratch[0].data(), scratch[1].data()};
    const float gain = controls.deafened.load()
                           ? 0
                           : controls.output.load() * (controls.voiceBoost.load() ? 2 : 1);
    const float attenuation =
        limiter.process(buffers, channelCount, count, gain, frame->sample_rate_hz());
    controls.renderLimiterGain = attenuation;
    if (attenuation < 0.999f) ++controls.limitedRenderFrames;
    for (size_t i = 0; i < count; ++i)
      for (size_t c = 0; c < channelCount; ++c)
        samples[i * channelCount + c] = static_cast<int16_t>(std::lround(scratch[c][i]));
    ++controls.renderFrames;
  }
};
