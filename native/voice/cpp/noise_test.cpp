#include <chrono>
#include <iostream>
#include <limits>
#include <stdexcept>

#include "noise_reducer.hpp"

static void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
int main() {
  try {
    NoiseReducer noise;
    check(noise.available(), "compiled full RNNoise model must initialize");
    noise.initialize(48000, 1);
    std::array<float, 480> samples{};
    check(noise.process(samples.data(), samples.size(), NoiseMode::Rnnoise),
          "silence must process");
    for (float value : samples)
      check(std::isfinite(value) && value == 0, "silence must stay silent");
    samples.fill(4000);
    const auto original = samples;
    noise.process(samples.data(), samples.size(), NoiseMode::Off);
    check(samples == original, "disabled filter must preserve the original samples");
    noise.process(samples.data(), samples.size(), NoiseMode::Native);
    check(samples == original, "WebRTC mode must not apply RNNoise as a second filter");
    noise.initialize(32000, 1);
    check(!noise.process(samples.data(), samples.size(), NoiseMode::Rnnoise),
          "unsupported format must request fallback");
    check(samples == original, "failure must leave the original frame audible");
    noise.initialize(48000, 1);
    check(!noise.process(samples.data(), 479, NoiseMode::Rnnoise),
          "incomplete frames must not read past the buffer");
    samples.fill(std::numeric_limits<float>::quiet_NaN());
    check(noise.process(samples.data(), samples.size(), NoiseMode::Rnnoise),
          "invalid input must be sanitized");
    for (float value : samples)
      check(std::isfinite(value), "invalid input must not poison the audio pipeline");
    uint32_t random = 1;
    double inputEnergy = 0, outputEnergy = 0;
    noise.initialize(48000, 1);
    const auto start = std::chrono::steady_clock::now();
    for (int frame = 0; frame < 1000; ++frame) {
      for (float& value : samples) {
        random = random * 1664525u + 1013904223u;
        value = (float(random >> 8) / 16777216.0f - 0.5f) * 3000;
        if (frame >= 100) inputEnergy += double(value) * value;
      }
      check(noise.process(samples.data(), samples.size(), NoiseMode::Rnnoise),
            "continuous capture must process");
      for (float value : samples) {
        check(std::isfinite(value) && std::abs(value) <= 32768,
              "output must remain finite and bounded");
        if (frame >= 100) outputEnergy += double(value) * value;
      }
    }
    const double averageMs =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start)
            .count() /
        1000;
    check(outputEnergy < inputEnergy * 0.5, "stationary background noise must be reduced");
    std::cout << "RNNoise full model: noise energy ratio=" << outputEnergy / inputEnergy
              << ", average frame ms=" << averageMs << " (10 ms audio/frame)\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
