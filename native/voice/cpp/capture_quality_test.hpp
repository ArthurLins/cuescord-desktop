#pragma once
#include "audio_capture_observer.hpp"
#include "audio_gate.hpp"
#include "voice_diagnostics.hpp"

inline void checkSignalObservation() {
  Controls controls;
  CaptureSignalObserver observer(controls);
  std::array<int16_t, 960> stereo{};
  stereo[1] = 32767;
  stereo[959] = -32768;
  const auto original = stereo;
  observer.OnCaptureData(stereo.data(), 480, 4, 2, 48000);
  check(stereo == original && controls.captureDevice.nearFullScaleSamples == 2,
        "raw capture metrics must count both stereo peaks without changing PCM");
  check(controls.captureDeviceRate == 48000 && controls.captureDeviceChannels == 2 &&
            controls.captureDeviceBytesPerFrame == 4,
        "raw format must describe actual device callbacks");
  observer.OnCaptureData(nullptr, 480, 4, 2, 48000);
  observer.OnCaptureData(stereo.data(), 480, 4, 8, 48000);
  check(controls.captureDeviceFormatErrors == 2 && controls.captureDevice.frames == 1,
        "invalid PCM contracts must not read beyond the provided data");
  SignalMeter meter;
  SignalMetrics metrics;
  std::array<float, 3> samples{std::numeric_limits<float>::infinity(), 40000, 0};
  float* channel[] = {samples.data()};
  meter.observe(channel, 1, samples.size(), metrics);
  check(metrics.nonFiniteSamples == 1 && metrics.nearFullScaleSamples == 1 &&
            std::isfinite(metrics.rmsDbfs.load()),
        "signal diagnostics must distinguish invalid and clipped input");
  samples.fill(0);
  meter.observe(channel, 1, samples.size(), metrics);
  check(metrics.abruptZeroFrames == 1,
        "a zero PCM block after a loud signal must remain observable even with regular callbacks");
  const auto report = cuescord::processingMeasurements(controls);
  check(report.at("signals").at("captureDevice").at("nearFullScaleSamples") == 2 &&
            report.at("signals").at("captureOutput").empty(),
        "unobserved stages must remain unavailable rather than claim silence or safe output");
  AudioDevices::Selection selection;
  selection.mode = "missing-device-fallback";
  selection.endpoint.id = "PRIVATE-ENDPOINT";
  const auto deviceReport = cuescord::endpointMeasurements(selection);
  check(deviceReport.at("selection") == "missing-device-fallback" &&
            !deviceReport.contains("endpointPresent") &&
            deviceReport.dump().find("PRIVATE") == std::string::npos,
        "endpoint reports must omit unavailable presence and private identifiers");
}

inline void checkProcessingTransitions() {
  FrameTransition transition;
  std::array<float, 480> values{};
  float* channel[] = {values.data()};
  values.fill(5000);
  transition.process(channel, 1, values.size());
  transition.request(240);
  values.fill(-5000);
  transition.process(channel, 1, values.size());
  check(values[0] == 5000 && values[240] == -5000,
        "mode change must bridge from the last allowed sample to the new signal");
  float maximum = 0;
  for (size_t i = 1; i < values.size(); ++i)
    maximum = std::max(maximum, std::abs(values[i] - values[i - 1]));
  check(maximum < 70, "a 10000-unit mode discontinuity must become a smooth 5 ms transition");

  Controls controls;
  controls.muted = false;
  controls.threshold = 0;
  controls.noiseMode = NoiseMode::Off;
  Gate gate(controls);
  gate.Initialize(48000, 1);
  webrtc::AudioBuffer audio(48000, 1, 48000, 1, 48000, 1);
  for (int frame = 0; frame < 10; ++frame) {
    std::fill_n(audio.channels()[0], 480, 4000);
    gate.Process(&audio);
  }
  controls.automatic = true;
  float previous = 4000;
  for (int frame = 0; frame < 5; ++frame) {
    std::fill_n(audio.channels()[0], 480, 4000);
    gate.Process(&audio);
    for (size_t i = 0; i < 480; ++i) {
      check(std::abs(audio.channels()[0][i] - previous) < 80,
            "enabling automatic detection must not reset a live stream or insert an empty onset "
            "buffer");
      previous = audio.channels()[0][i];
    }
  }
}

inline void checkCaptureHeadroomAndPrivacy() {
  Controls controls;
  controls.muted = false;
  controls.activity = false;
  controls.ptt = true;
  controls.autoGain = true;
  controls.input = 2;
  controls.noiseMode = NoiseMode::Rnnoise;
  Gate gate(controls);
  gate.Initialize(48000, 1);
  webrtc::AudioBuffer audio(48000, 1, 48000, 1, 48000, 1);
  for (int frame = 0; frame < 80; ++frame) {
    for (size_t i = 0; i < 480; ++i)
      audio.channels()[0][i] = 50000 * std::sin((frame * 480 + i) * .04);
    gate.Process(&audio);
    for (size_t i = 0; i < 480; ++i)
      check(std::isfinite(audio.channels()[0][i]) && std::abs(audio.channels()[0][i]) <= 29205,
            "overshooting float PCM, RNNoise, AGC and user gain must reach protected output "
            "without clipping");
  }
  check(controls.captureInput.nearFullScaleSamples > 0 &&
            controls.captureOutput.nearFullScaleSamples == 0,
        "diagnostics must preserve incoming overload evidence and prove protected capture output");
  controls.muted = true;
  for (int frame = 0; frame < 10; ++frame) {
    std::fill_n(audio.channels()[0], 480, 12000);
    gate.Process(&audio);
  }
  controls.muted = false;
  for (int frame = 0; frame < 10; ++frame) {
    std::fill_n(audio.channels()[0], 480, 0);
    gate.Process(&audio);
    for (size_t i = 0; i < 480; ++i)
      check(audio.channels()[0][i] == 0,
            "unmuting RNNoise/AGC must never replay PCM captured while muted");
  }
}

inline void checkQuietDetection() {
  VoiceActivityDetector detector;
  detector.reset();
  std::array<float, 480> quiet{};
  for (size_t i = 0; i < quiet.size(); ++i) quiet[i] = 40 * std::sin(i * .05);
  const auto original = quiet;
  detector.detect(quiet.data(), quiet.size());
  check(quiet == original && detector.analysisGain() > 20 && detector.analysisGain() <= 32,
        "quiet detection must normalize only its analysis copy, within a bounded gain");
  quiet.fill(0);
  for (int frame = 0; frame < 100; ++frame)
    check(!detector.detect(quiet.data(), quiet.size()),
          "digital silence must never be promoted to speech");
}

inline void checkAutomaticBackgroundRejection() {
  Controls controls;
  controls.muted = false;
  controls.automatic = true;
  controls.noiseMode = NoiseMode::Off;
  Gate gate(controls);
  gate.Initialize(48000, 1);
  webrtc::AudioBuffer audio(48000, 1, 48000, 1, 48000, 1);
  uint32_t random = 927;
  float pink = 0;
  unsigned open = 0;
  for (int frame = 0; frame < 500; ++frame) {
    for (size_t i = 0; i < 480; ++i) {
      random = random * 1664525u + 1013904223u;
      const float white = float(int32_t(random >> 16) - 32768) / 32768;
      pink = .96f * pink + .04f * white;
      audio.channels()[0][i] = pink * 4000 + white * 150;
    }
    gate.Process(&audio);
    if (frame >= 300 && controls.activityGateOpen.load()) ++open;
  }
  check(open < 10,
        "normalized automatic detection must reject stationary background instead of opening "
        "indefinitely");
  check(controls.speechClassifierActive && controls.speechClassifierFrames == 500 &&
            !controls.noiseActive,
        "automatic mode may classify a copy but must not enable a disabled audio filter");
  controls.automatic = false;
  gate.Process(&audio);
  check(!controls.speechClassifierActive && controls.speechClassifierFrames == 500,
        "manual detection with suppression off must not keep running the neural classifier");
  Controls overloaded;
  overloaded.muted = false;
  overloaded.automatic = true;
  overloaded.noiseMode = NoiseMode::Off;
  Gate bounded(overloaded, 0);
  bounded.Initialize(48000, 1);
  for (int frame = 0; frame < 11; ++frame) {
    std::fill_n(audio.channels()[0], 480, 0);
    bounded.Process(&audio);
  }
  check(overloaded.speechClassifierFailed && !overloaded.speechClassifierActive &&
            overloaded.speechClassifierFrames == 10 && !overloaded.noiseFailed,
        "classifier overload must stop inference without enabling or failing a disabled denoiser");
}
