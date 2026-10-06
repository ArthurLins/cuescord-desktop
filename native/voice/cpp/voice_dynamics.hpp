#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>

// Frame look-ahead without an audio queue. Attenuate the whole waveform rather
// than flattening peaks; recover over 80 ms. S16-scaled float input/output.
class PeakLimiter {
  float attenuation = 1;

 public:
  void reset() { attenuation = 1; }
  float process(float* const* channels, size_t channelCount, size_t count, float gain) {
    if (!std::isfinite(gain) || gain <= 0) {
      for (size_t c = 0; c < channelCount; ++c) std::fill_n(channels[c], count, 0.0f);
      reset();
      return 1;
    }
    float peak = 0;
    for (size_t c = 0; c < channelCount; ++c)
      for (size_t i = 0; i < count; ++i) {
        const float value = channels[c][i];
        channels[c][i] = std::isfinite(value) ? value : 0;
        peak = std::max(peak, std::abs(channels[c][i] * gain));
      }
    constexpr float ceiling = 29204.0f;  // -1 dBFS of headroom.
    const float desired = peak > ceiling ? ceiling / peak : 1;
    attenuation = desired < attenuation ? desired : desired + (attenuation - desired) * 0.882497f;
    const float applied = gain * attenuation;
    for (size_t c = 0; c < channelCount; ++c)
      for (size_t i = 0; i < count; ++i) channels[c][i] *= applied;
    return attenuation;
  }
};
