#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

// Sample-by-sample linear automation, including zero as a valid target.
// https://www.w3.org/TR/webaudio-1.0/#dom-audioparam-linearramptovalueattime
class GainRamp {
  double value = 0, target = 0, step = 0;
  size_t remaining = 0;

 public:
  void reset() {
    value = target = step = 0;
    remaining = 0;
  }
  void setTarget(float next, size_t samples) {
    if (next == target) return;
    target = next;
    remaining = std::max<size_t>(1, samples);
    step = (target - value) / remaining;
  }
  float next() {
    if (remaining && --remaining == 0)
      value = target;
    else if (remaining)
      value += step;
    return float(value);
  }
};

// Linked-channel, S16-scaled limiter with 5 ms look-ahead and 80 ms release.
// A running minimum followed by a moving average smooths gain across callbacks.
// Every term in that average includes the delayed sample's required attenuation,
// so the averaged gain cannot exceed its ceiling (even for a one-sample peak).
// Order-statistics/look-ahead reference, adapted to attenuation rather than level:
// https://www.dafx.de/paper-archive/2002/DAFX02_Hamalainen_smoothing_peak_limiters.pdf
// Fixed storage only: no allocation, locks or whole-frame gain steps in process().
class PeakLimiter {
  static constexpr size_t maxDelay = 240, capacity = maxDelay + 2;
  static constexpr double ceiling = 29204.0;  // -1 dBFS of headroom.
  struct Minimum {
    double value = 1;
    uint64_t at = 0;
  };
  std::array<std::array<double, maxDelay>, 2> delay{};
  std::array<Minimum, capacity> minimum{};
  std::array<double, maxDelay + 1> average{};
  GainRamp volume;
  size_t delayIndex = 0, averageIndex = 0, head = 0, size = 0;
  size_t lookAhead = maxDelay, channels = 0;
  uint64_t sequence = 0;
  int rate = 0;
  double averageSum = maxDelay + 1, attenuation = 1, releaseStep = 0;

 public:
  void reset() {
    for (auto& channel : delay) channel.fill(0);
    average.fill(1);
    delayIndex = averageIndex = head = size = sequence = 0;
    averageSum = lookAhead + 1;
    attenuation = 1;
    volume.reset();
  }
  void initialize(int sampleRate, size_t channelCount) {
    rate = sampleRate;
    channels = channelCount;
    lookAhead = size_t(std::clamp(sampleRate / 200, 1, int(maxDelay)));
    releaseStep = -std::expm1(-1.0 / (0.080 * std::max(1, sampleRate)));
    reset();
  }
  float process(float* const* buffers, size_t channelCount, size_t count, float gain,
                int sampleRate = 48000) {
    if (rate != sampleRate || channels != channelCount) initialize(sampleRate, channelCount);
    if (!std::isfinite(gain) || gain <= 0 || channelCount == 0 || channelCount > 2 ||
        sampleRate <= 0 || sampleRate > 48000) {
      for (size_t c = 0; c < channelCount; ++c) std::fill_n(buffers[c], count, 0.0f);
      reset();
      return 1;
    }
    volume.setTarget(gain, lookAhead);
    double smallestGain = 1;
    for (size_t i = 0; i < count; ++i) {
      const double appliedVolume = volume.next();
      std::array<double, 2> input{};
      double peak = 0;
      for (size_t c = 0; c < channelCount; ++c) {
        input[c] = std::isfinite(buffers[c][i]) ? double(buffers[c][i]) * appliedVolume : 0;
        peak = std::max(peak, std::abs(input[c]));
      }
      const double required = peak > ceiling ? ceiling / peak : 1;
      // Monotonic deque: each entry is pushed/popped once, including across blocks.
      while (size && sequence - minimum[head].at > lookAhead) {
        head = (head + 1) % capacity;
        --size;
      }
      while (size && minimum[(head + size - 1) % capacity].value >= required) --size;
      minimum[(head + size) % capacity] = {required, sequence++};
      ++size;
      const double held = minimum[head].value;
      averageSum += held - average[averageIndex];
      average[averageIndex] = held;
      averageIndex = (averageIndex + 1) % (lookAhead + 1);
      const double smoothed = std::clamp(averageSum / (lookAhead + 1), 0.0, 1.0);
      attenuation = std::min(smoothed, attenuation + (1 - attenuation) * releaseStep);
      smallestGain = std::min(smallestGain, attenuation);
      for (size_t c = 0; c < channelCount; ++c) {
        const double output = delay[c][delayIndex] * attenuation;
        delay[c][delayIndex] = input[c];
        // Only a numerical guard; the look-ahead envelope already bounds peaks.
        buffers[c][i] = float(std::clamp(output, -ceiling, ceiling));
      }
      delayIndex = (delayIndex + 1) % lookAhead;
    }
    return float(smallestGain);
  }
};
