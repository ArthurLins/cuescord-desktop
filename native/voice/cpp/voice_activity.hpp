#pragma once
#include <common_audio/vad/include/webrtc_vad.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>

// Detection gain never touches transmitted PCM. Quiet speech needs a usable
// analysis level; raising microphone gain to achieve this would amplify noise.
class VoiceActivityDetector {
  static constexpr double minimumSignalRms = 3.2768, targetAnalysisRms = 3276.8;
  static constexpr double maximumAnalysisGain = 32;
  std::unique_ptr<VadInst, decltype(&WebRtcVad_Free)> vad{WebRtcVad_Create(), WebRtcVad_Free};
  std::array<int16_t, 480> analysis{};
  float normalization = 1;
  bool failed = false;

 public:
  void reset() {
    failed = !vad || WebRtcVad_Init(vad.get()) != 0 || WebRtcVad_set_mode(vad.get(), 2) != 0;
    normalization = 1;
  }
  bool available() const { return vad && !failed; }
  float analysisGain() const { return normalization; }
  bool detect(const float* samples, size_t count) {
    if (!available() || count != analysis.size()) return false;
    double energy = 0;
    float peak = 0;
    for (size_t i = 0; i < count; ++i) {
      const float value = std::isfinite(samples[i]) ? samples[i] : 0;
      energy += double(value) * value;
      peak = std::max(peak, std::abs(value));
    }
    const double rms = std::sqrt(energy / count);
    // Below -80 dBFS there is insufficient signal to promote to speech.
    normalization = rms > minimumSignalRms
                        ? float(std::clamp(targetAnalysisRms / rms, 1.0, maximumAnalysisGain))
                        : 1;
    if (peak > 0) normalization = std::min(normalization, 30000 / peak);
    for (size_t i = 0; i < count; ++i)
      analysis[i] = std::isfinite(samples[i])
                        ? int16_t(std::clamp(samples[i] * normalization, -32768.0f, 32767.0f))
                        : 0;
    const int result = WebRtcVad_Process(vad.get(), 48000, analysis.data(), count);
    failed = result < 0;
    return !failed && rms > minimumSignalRms && result == 1;
  }
};
