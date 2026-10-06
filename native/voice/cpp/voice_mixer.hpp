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
  std::array<float, 960> scratch{};

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
    const auto count = frame->samples_per_channel() * frame->num_channels();
    // A mismatched SDK format must never read beyond the fixed scratch buffer.
    if (count > scratch.size()) {
      frame->Mute();
      return;
    }
    auto* samples = frame->mutable_data();
    for (size_t i = 0; i < count; ++i) scratch[i] = samples[i];
    float* buffers[] = {scratch.data()};
    const float gain = controls.deafened.load()
                           ? 0
                           : controls.output.load() * (controls.voiceBoost.load() ? 2 : 1);
    const float attenuation = limiter.process(buffers, 1, count, gain);
    controls.renderLimiterGain = attenuation;
    if (attenuation < 0.999f) ++controls.limitedRenderFrames;
    for (size_t i = 0; i < count; ++i) samples[i] = static_cast<int16_t>(std::lround(scratch[i]));
    ++controls.renderFrames;
  }
};
