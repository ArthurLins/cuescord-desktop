#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

// Measurements only: no PCM, device identifiers or recording buffers are exported.
// Values at the capture input are AFTER the main WebRTC AEC/NS, not raw WASAPI.
struct SignalMetrics {
  std::atomic<float> rmsDbfs{-120}, peakDbfs{-120}, boundaryStepPeak{0};
  std::atomic<uint64_t> frames{0}, silentFrames{0}, nearFullScaleSamples{0}, nonFiniteSamples{0};
  std::atomic<uint64_t> abruptZeroFrames{0};
};

class SignalMeter {
  std::array<float, 2> previous{};
  bool initialized = false;
  float previousPeak = 0;

  template <class ReadSample>
  void measure(size_t channelCount, size_t count, ReadSample read, SignalMetrics& metrics) {
    double energy = 0;
    float peak = 0, boundary = 0;
    uint64_t clipped = 0, invalid = 0;
    for (size_t c = 0; c < channelCount; ++c) {
      for (size_t i = 0; i < count; ++i) {
        const float raw = read(c, i);
        invalid += !std::isfinite(raw);
        const float sample = std::isfinite(raw) ? raw : 0;
        energy += double(sample) * sample;
        peak = std::max(peak, std::abs(sample));
        clipped += std::abs(sample) >= 32760;
        if (i == 0 && initialized && c < previous.size())
          boundary = std::max(boundary,
                              float(std::min(1048576.0, std::abs(double(sample) - previous[c]))));
        if (i + 1 == count && c < previous.size()) previous[c] = sample;
      }
    }
    const double rms = std::sqrt(energy / std::max<size_t>(1, count * channelCount)) / 32768;
    metrics.rmsDbfs = rms > 1e-6 ? float(20 * std::log10(rms)) : -120;
    metrics.peakDbfs = peak > .032768f ? float(20 * std::log10(peak / 32768)) : -120;
    metrics.boundaryStepPeak = std::max(metrics.boundaryStepPeak.load(), boundary / 32768);
    metrics.nearFullScaleSamples.fetch_add(clipped);
    metrics.nonFiniteSamples.fetch_add(invalid);
    if (peak == 0) {
      ++metrics.silentFrames;
      // A zero block following an audible block can reveal a device/DSP gap.
      // It is an observation, not a diagnosis of packet loss or a click.
      if (initialized && previousPeak > 1036.2f) ++metrics.abruptZeroFrames;
    }
    previousPeak = peak;
    ++metrics.frames;
    initialized = true;
  }

 public:
  void reset() { initialized = false; }
  void observe(float* const* channels, size_t channelCount, size_t count, SignalMetrics& metrics) {
    measure(channelCount, count, [&](size_t c, size_t i) { return channels[c][i]; }, metrics);
  }
  void observeInterleaved(const int16_t* samples, size_t channelCount, size_t count,
                          SignalMetrics& metrics) {
    measure(
        channelCount, count,
        [&](size_t c, size_t i) { return float(samples[i * channelCount + c]); }, metrics);
  }
};
