#pragma once
#include <atomic>

#include "noise_reducer.hpp"
#include "voice_signal_metrics.hpp"

struct Controls {
  std::atomic<bool> muted{true}, deafened{false}, ptt{false}, activity{true}, automatic{false};
  std::atomic<float> input{1}, output{1}, threshold{8}, level{0};
  std::atomic<bool> speaking{false}, transmitting{false};
  std::atomic<uint64_t> frames{0};
  std::atomic<NoiseMode> noiseMode{NoiseMode::Native};
  std::atomic<bool> noiseAvailable{false}, noiseActive{false}, noiseFailed{false};
  std::atomic<uint64_t> noiseFrames{0}, noiseMicros{0}, noiseMaxMicros{0};
  std::atomic<uint32_t> noiseRevision{0};
  std::atomic<float> noiseSpeechProbability{0}, noiseDryMix{0};
  std::atomic<bool> autoGain{false}, voiceBoost{true};
  std::atomic<bool> autoGainActive{false};
  std::atomic<uint64_t> autoGainErrors{0}, autoGainFrames{0};
  std::atomic<bool> captureMmcss{false}, renderMmcss{false};
  std::atomic<bool> captureMmcssInherited{false}, renderMmcssInherited{false};
  std::atomic<unsigned> capturePriorityError{0}, renderPriorityError{0};
  std::atomic<uint64_t> captureLateFrames{0}, captureMaxGapMicros{0}, renderFrames{0};
  std::atomic<uint64_t> limitedCaptureFrames{0}, limitedRenderFrames{0};
  std::atomic<float> captureLimiterGain{1}, renderLimiterGain{1};
  std::atomic<float> preGainLimiterGain{1};
  std::atomic<uint64_t> limitedPreGainFrames{0};
  std::atomic<uint64_t> limitedSourceFrames{0};
  std::atomic<float> sourceLimiterMinimumGain{1};
  std::atomic<int> captureProcessingRate{0}, captureProcessingChannels{0};
  std::atomic<unsigned> captureDeviceRate{0}, captureDeviceChannels{0},
      captureDeviceBytesPerFrame{0};
  std::atomic<uint64_t> captureDeviceFormatErrors{0};
  std::atomic<bool> activityDetected{false}, activityGateOpen{false};
  std::atomic<float> activityAnalysisGain{1};
  std::atomic<bool> speechClassifierActive{false}, speechClassifierFailed{false};
  std::atomic<float> speechProbability{0};
  std::atomic<uint64_t> speechClassifierFrames{0}, speechClassifierMicros{0},
      speechClassifierMaxMicros{0};
  std::atomic<uint64_t> activitySpeechFrames{0}, activityClosedFrames{0}, activityTransitions{0};
  SignalMetrics captureDevice, captureInput, captureProcessed, captureOutput, renderInput,
      renderOutput;
};
