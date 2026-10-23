#pragma once
#include <api/audio/audio_frame.h>
#include <modules/audio_mixer/audio_mixer_impl.h>

#include <array>
#include <map>
#include <memory>
#include <mutex>

#include "audio_priority.hpp"
#include "voice_controls.hpp"
#include "voice_dynamics.hpp"
#include "voice_source_gain.hpp"

// Remote microphone audio only. Browser camera/screen audio never reaches this
// mixer. WebRTC still performs source mixing and its built-in mix limiter.
class VoiceMixer : public webrtc::AudioMixer {
  Controls& controls;
  webrtc::scoped_refptr<webrtc::AudioMixerImpl> mixer = webrtc::AudioMixerImpl::Create();
  PeakLimiter limiter;
  std::array<std::array<float, 480>, 2> scratch{};
  SignalMeter inputMeter, outputMeter;
  // Control/source lifecycle lock only. The render callback reads atomic gain
  // in each already registered source; it never takes this lock.
  std::mutex sourceMutex;
  std::map<Source*, std::unique_ptr<ProtectedVoiceSource>> sources;
  std::map<uint32_t, float> sourceVolumes;

 public:
  explicit VoiceMixer(Controls& controls) : controls(controls) {}
  bool AddSource(Source* source) override {
    std::lock_guard lock(sourceMutex);
    if (!source || sources.contains(source) || sources.size() >= 256) return false;
    auto protectedSource = std::make_unique<ProtectedVoiceSource>(*source, controls);
    const auto gain = sourceVolumes.find(uint32_t(source->Ssrc()));
    if (gain != sourceVolumes.end()) protectedSource->setGain(gain->second);
    if (!mixer->AddSource(protectedSource.get())) return false;
    sources.emplace(source, std::move(protectedSource));
    return true;
  }
  void RemoveSource(Source* source) override {
    std::lock_guard lock(sourceMutex);
    const auto found = sources.find(source);
    if (found == sources.end()) return;
    // SDK RemoveSource synchronizes with Mix before the wrapper is destroyed.
    mixer->RemoveSource(found->second.get());
    sourceVolumes.erase(uint32_t(found->second->Ssrc()));
    sources.erase(found);
  }
  void setSourceVolume(uint32_t ssrc, float gain) {
    std::lock_guard lock(sourceMutex);
    sourceVolumes[ssrc] = gain;
    for (auto& [source, protectedSource] : sources)
      if (uint32_t(protectedSource->Ssrc()) == ssrc) protectedSource->setGain(gain);
  }
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
    inputMeter.observe(buffers, channelCount, count, controls.renderInput);
    const float gain = controls.deafened.load()
                           ? 0
                           : controls.output.load() * (controls.voiceBoost.load() ? 2 : 1);
    const float attenuation =
        limiter.process(buffers, channelCount, count, gain, frame->sample_rate_hz());
    controls.renderLimiterGain = attenuation;
    outputMeter.observe(buffers, channelCount, count, controls.renderOutput);
    if (attenuation < 0.999f) ++controls.limitedRenderFrames;
    for (size_t i = 0; i < count; ++i)
      for (size_t c = 0; c < channelCount; ++c)
        samples[i * channelCount + c] = static_cast<int16_t>(std::lround(scratch[c][i]));
    ++controls.renderFrames;
  }
};
