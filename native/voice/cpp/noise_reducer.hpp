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
  std::unique_ptr<DenoiseState, decltype(&rnnoise_destroy)> state{nullptr, rnnoise_destroy};
  std::array<float, 480> input{}, output{};
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
  void initialize(int rate, int channels) {
    usable = state && rate == 48000 && channels == 1 && rnnoise_get_frame_size() == 480;
    previous = NoiseMode::Off;
    if (usable && rnnoise_init(state.get(), nullptr) != 0) usable = false;
  }
  bool process(float* samples, size_t count, NoiseMode mode) {
    if (mode != NoiseMode::Rnnoise) {
      previous = mode;
      return true;
    }
    if (!usable || count != input.size()) return false;
    if (previous != mode && rnnoise_init(state.get(), nullptr) != 0) return false;
    previous = mode;
    for (size_t i = 0; i < count; ++i)
      input[i] = std::isfinite(samples[i]) ? std::clamp(samples[i], -32768.0f, 32767.0f) : 0;
    const float speech = rnnoise_process_frame(state.get(), output.data(), input.data());
    if (!std::isfinite(speech) || std::any_of(output.begin(), output.end(),
                                              [](float value) { return !std::isfinite(value); })) {
      usable = false;
      return false;  // Leave the original frame audible; the control thread enables WebRTC NS.
    }
    for (size_t i = 0; i < count; ++i) samples[i] = std::clamp(output[i], -32768.0f, 32767.0f);
    return true;
  }
};
