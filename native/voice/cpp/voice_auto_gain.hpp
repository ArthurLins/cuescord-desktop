#pragma once
#include <api/audio/audio_processing.h>
#include <api/audio/builtin_audio_processing_builder.h>
#include <api/environment/environment_factory.h>
#include <modules/audio_processing/audio_buffer.h>

#include <algorithm>
#include <array>
#include <cmath>

#include "voice_controls.hpp"
#include "voice_dynamics.hpp"

// Keep AGC2's normalized API away from its internal hard clipper. Restore the
// staging attenuation in float, where the final capture limiter can protect peaks.
class AutomaticVoiceGain {
  static constexpr float apiScale = .125f;
  static constexpr float apiHeadroomDb = 18.0618f;  // -20 * log10(apiScale).
  static constexpr float maximumGainDb = 18;
  static constexpr float floatS16Scale = 32768;
  static_assert(apiScale * 8 == 1);
  static_assert(maximumGainDb < apiHeadroomDb);
  Controls& controls;
  int sampleRate = 48000;
  webrtc::Environment environment = webrtc::CreateEnvironment();
  webrtc::scoped_refptr<webrtc::AudioProcessing> processor;
  std::array<std::array<float, 480>, 2> scratch{};
  PeakLimiter inputLimiter;

  void protectInput(webrtc::AudioBuffer& audio, bool enabled) {
    const auto count = audio.num_frames(), channels = audio.num_channels();
    float* buffers[] = {scratch[0].data(), scratch[1].data()};
    for (size_t c = 0; c < channels; ++c) std::copy_n(audio.channels()[c], count, buffers[c]);
    // Keep the delay warm while bypassed so enabling AGC adds no empty onset.
    const float attenuation =
        inputLimiter.process(buffers, channels, count, enabled ? 1 : 0, sampleRate);
    const bool applied = controls.autoGain.load();
    if (applied)
      for (size_t c = 0; c < channels; ++c) std::copy_n(buffers[c], count, audio.channels()[c]);
    controls.preGainLimiterGain = applied ? attenuation : 1;
    if (applied && attenuation < .999f) ++controls.limitedPreGainFrames;
  }
  void observeApiOutput(float* const* buffers, size_t channels, size_t count) {
    float peak = 0;
    uint64_t fullScale = 0;
    for (size_t c = 0; c < channels; ++c)
      for (size_t i = 0; i < count; ++i) {
        const float value = buffers[c][i];
        peak = std::max(peak, std::abs(value));
        fullScale += value >= 32767 / floatS16Scale || value <= -1;
      }
    const float dbfs = peak > 1e-6f ? 20 * std::log10(peak) : -120;
    controls.autoGainApiPeakDbfs = std::max(controls.autoGainApiPeakDbfs.load(), dbfs);
    controls.autoGainApiFullScaleSamples.fetch_add(fullScale);
  }

 public:
  explicit AutomaticVoiceGain(Controls& controls) : controls(controls) {}
  void reset() { inputLimiter.reset(); }
  void initialize(int rate, int channels) {
    sampleRate = rate;
    inputLimiter.initialize(rate, channels);
    webrtc::AudioProcessing::Config config;
    config.gain_controller2.enabled = true;
    auto& adaptive = config.gain_controller2.adaptive_digital;
    adaptive.enabled = true;
    // Translate level/noise targets into the attenuated API's reference frame.
    // Effective speech headroom, maximum gain and gain speed remain unchanged.
    adaptive.headroom_db = 6 + apiHeadroomDb;
    adaptive.max_output_noise_level_dbfs = -50 - apiHeadroomDb;
    adaptive.max_gain_db = maximumGainDb;
    adaptive.initial_gain_db = 6;
    adaptive.max_gain_change_db_per_second = 3;
    processor = webrtc::BuiltinAudioProcessingBuilder(config).Build(environment);
    webrtc::ProcessingConfig format;
    format.input_stream() = webrtc::StreamConfig(rate, channels);
    format.output_stream() = webrtc::StreamConfig(rate, channels);
    if (!processor || processor->Initialize(format) != 0) processor = nullptr;
    controls.autoGainApiHeadroomDb = apiHeadroomDb;
    controls.autoGainActive = false;
  }
  void process(webrtc::AudioBuffer& audio, bool enabled) {
    const auto count = audio.num_frames(), channels = audio.num_channels();
    if (count > scratch[0].size() || channels == 0 || channels > scratch.size()) {
      controls.autoGainActive = false;
      return;
    }
    protectInput(audio, enabled);
    if (!controls.autoGain.load() || !processor || count != size_t(sampleRate / 100)) {
      controls.autoGainActive = false;
      return;
    }
    float* buffers[] = {scratch[0].data(), scratch[1].data()};
    for (size_t c = 0; c < channels; ++c)
      for (size_t i = 0; i < count; ++i)
        buffers[c][i] = std::isfinite(audio.channels()[c][i])
                            ? audio.channels()[c][i] * (apiScale / floatS16Scale)
                            : 0;
    const webrtc::StreamConfig format(sampleRate, channels);
    if (processor->ProcessStream(buffers, format, format, buffers) != 0) {
      controls.autoGainActive = false;
      ++controls.autoGainErrors;
      return;
    }
    observeApiOutput(buffers, channels, count);
    for (size_t c = 0; c < channels; ++c)
      for (size_t i = 0; i < count; ++i)
        audio.channels()[c][i] = buffers[c][i] * (floatS16Scale / apiScale);
    ++controls.autoGainFrames;
    controls.autoGainActive = true;
  }
};
