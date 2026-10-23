#pragma once
#include <rnnoise.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <memory>

enum class NoiseMode { Off, Native, Rnnoise };

// One mono microphone, 48 kHz / 10 ms. State and scratch buffers belong to the
// capture thread. Allocation is limited to construction; reset uses rnnoise_init
// with the compiled default model (no loading, locks or allocations per frame).
class NoiseReducer {
  static constexpr size_t frameSamples = 480, modelDelayFrames = 2;
  static constexpr float maximumPreservedSpeech = .5f, minimumSpeechProbability = .8f;
  static constexpr double maximumResidualRatio = .03;
  std::unique_ptr<DenoiseState, decltype(&rnnoise_destroy)> state{nullptr, rnnoise_destroy};
  std::array<float, 480> input{}, output{};
  // The pinned model has two 10 ms frames of algorithmic delay. Any speech
  // preservation must use this same timeline or the mix creates comb filtering.
  std::array<float, frameSamples * modelDelayFrames> dryDelay{};
  size_t dryIndex = 0;
  float speechProbability = 0, dryMix = 0;
  bool usable = false;
  NoiseMode previous = NoiseMode::Off;

 public:
  NoiseReducer() {
    auto* memory = static_cast<DenoiseState*>(std::malloc(rnnoise_get_size()));
    if (memory && rnnoise_init(memory, nullptr) == 0)
      state.reset(memory);
    else
      std::free(memory);
  }
  bool available() const { return bool(state); }
  float speech() const { return speechProbability; }
  float preservedSpeechMix() const { return dryMix; }
  void resetHistory() {
    dryDelay.fill(0);
    dryIndex = 0;
    speechProbability = dryMix = 0;
    if (state && rnnoise_init(state.get(), nullptr) != 0) usable = false;
  }
  void initialize(int rate, int channels) {
    usable = state && rate == 48000 && channels == 1 && rnnoise_get_frame_size() == 480;
    previous = NoiseMode::Off;
    resetHistory();
  }
  bool process(float* samples, size_t count, NoiseMode mode) {
    if (mode != NoiseMode::Rnnoise) {
      previous = mode;
      return true;
    }
    if (!usable || count != input.size()) return false;
    if (previous != mode) resetHistory();
    if (!usable) return false;
    previous = mode;
    for (size_t i = 0; i < count; ++i) input[i] = std::isfinite(samples[i]) ? samples[i] : 0;
    const float speech = rnnoise_process_frame(state.get(), output.data(), input.data());
    if (!std::isfinite(speech) || std::any_of(output.begin(), output.end(),
                                              [](float value) { return !std::isfinite(value); })) {
      usable = false;
      return false;  // Leave the original frame audible; the control thread enables WebRTC NS.
    }
    speechProbability = std::clamp(speech, 0.0f, 1.0f);
    double dryEnergy = 0, residualEnergy = 0;
    for (size_t i = 0; i < count; ++i) {
      const float delayed = dryDelay[dryIndex];
      dryDelay[dryIndex] = input[i];
      dryIndex = (dryIndex + 1) % dryDelay.size();
      input[i] = delayed;
      dryEnergy += double(delayed) * delayed;
      const double residual = delayed - output[i];
      residualEnergy += residual * residual;
    }
    // Keep clean voiced detail, but retain full suppression of noise/uncertain
    // frames. Residual energy includes filter changes: this is a conservative
    // blend policy, not an asserted SNR measurement of the hardware microphone.
    const float clean = float(
        std::clamp(1 - residualEnergy / std::max(1.0, dryEnergy) / maximumResidualRatio, 0.0, 1.0));
    const float target =
        speechProbability >= minimumSpeechProbability ? maximumPreservedSpeech * clean : 0;
    const float step = (target - dryMix) / float(count);
    for (size_t i = 0; i < count; ++i) {
      dryMix += step;
      // Float headroom belongs to the final look-ahead limiter. Hard clipping
      // here irreversibly distorted peaks before AGC/user gain could limit them.
      samples[i] = output[i] + dryMix * (input[i] - output[i]);
    }
    dryMix = target;
    return true;
  }
};
