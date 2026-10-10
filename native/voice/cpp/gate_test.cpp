#include <cmath>
#include <iostream>
#include <stdexcept>
#include <thread>

#include "audio_gate.hpp"

void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
int main() {
  Controls controls;
  Gate gate(controls);
  webrtc::AudioBuffer audio(48000, 1, 48000, 1, 48000, 1);
  const auto frame = [&](float sample) {
    std::fill_n(audio.channels()[0], audio.num_frames(), sample);
    gate.Process(&audio);
    return audio.channels()[0][audio.num_frames() - 1];
  };
  try {
    check(frame(4000) == 0, "default must be muted");
    controls.muted = false;
    check(frame(4000) > 0, "voice activity should pass speech");
    check(controls.speaking && controls.transmitting, "meter must match real gate");
    controls.deafened = true;
    check(frame(4000) == 0, "deafen must immediately silence capture");
    controls.deafened = false;
    controls.activity = false;
    check(frame(4000) == 0, "PTT must ignore activity hangover");
    controls.ptt = true;
    controls.input = 2;
    check(frame(20000) <= 29205 && frame(20000) > 20000,
          "gain must limit peaks without hard clipping");
    controls.input = 0;
    check(frame(4000) == 0 && !controls.transmitting, "zero input volume must close gate");
    controls.input = 1;
    controls.activity = true;
    controls.threshold = 20;
    frame(4000);
    for (int i = 0; i < 19; ++i) frame(0);
    check(controls.transmitting, "hold must cover syllable gaps");
    frame(0);
    check(!controls.transmitting, "hold must expire after 200ms");
    gate.Initialize(48000, 1);
    frame(0);
    check(!controls.transmitting, "device reinitialization must reset hold");
    controls.threshold = 8;
    frame(4000);
    controls.muted = true;
    frame(4000);
    controls.muted = false;
    frame(0);
    check(!controls.transmitting, "unmute must not release audio buffered before mute");
    controls.noiseMode = NoiseMode::Rnnoise;
    controls.muted = true;
    for (int i = 0; i < 100; ++i) check(frame(4000) == 0, "RNNoise must never bypass mute");
    check(controls.noiseActive && controls.noiseFrames == 100, "RNNoise must run before the gate");
    check(controls.noiseMicros > 0, "processing cost must be available to diagnostics");
    webrtc::AudioBuffer unsupported(32000, 1, 32000, 1, 32000, 1);
    gate.Initialize(32000, 1);
    gate.Process(&unsupported);
    check(controls.noiseFailed, "unsupported capture format must request filter fallback");
    Controls overloaded;
    overloaded.noiseMode = NoiseMode::Rnnoise;
    Gate budgetGate(overloaded,
                    0);  // A deterministic exhausted budget, without sleeping the audio thread.
    budgetGate.Initialize(48000, 1);
    for (int i = 0; i < 10; ++i) {
      std::fill_n(audio.channels()[0], audio.num_frames(), 4000.0f);
      budgetGate.Process(&audio);
      check(overloaded.noiseFailed.load() == (i == 9),
            "only persistent overload must request fallback");
    }
    check(!overloaded.noiseActive, "overload must stop claiming RNNoise is active");
    Controls automatic;
    automatic.muted = false;
    automatic.automatic = true;
    Gate onsetGate(automatic);
    onsetGate.Initialize(48000, 1);
    for (int i = 0; i < 3; ++i) {
      std::fill_n(audio.channels()[0], audio.num_frames(), 4000.0f);
      onsetGate.Process(&audio);
      check(audio.channels()[0][0] == 0, "automatic mode must retain 30ms of onset audio");
    }
    automatic.activity = false;
    automatic.ptt = true;
    std::fill_n(audio.channels()[0], audio.num_frames(), 4000.0f);
    onsetGate.Process(&audio);
    check(audio.channels()[0][0] == 0 && audio.channels()[0][479] > 3900,
          "PTT must flush the automatic onset buffer and open within one 10ms frame");
    Controls smooth;
    smooth.muted = false;
    smooth.threshold = 20;
    smooth.noiseMode = NoiseMode::Off;
    Gate smoothGate(smooth);
    smoothGate.Initialize(48000, 1);
    float lastOutput = 0;
    const auto continuousFrame = [&] {
      std::fill_n(audio.channels()[0], audio.num_frames(), 4000.0f);
      smoothGate.Process(&audio);
      for (size_t i = 0; i < audio.num_frames(); ++i) {
        check(std::abs(audio.channels()[0][i] - lastOutput) < 40,
              "activity transitions must not introduce a click into a continuous signal");
        lastOutput = audio.channels()[0][i];
      }
    };
    for (int i = 0; i < 3; ++i) continuousFrame();
    check(lastOutput == 4000, "opening ramp must reach the requested microphone level");
    smooth.threshold = 100;
    for (int i = 0; i < 23; ++i) continuousFrame();
    check(lastOutput == 0 && !smooth.transmitting,
          "activity fade and limiter tail must finish after the existing hangover");
    smooth.activity = false;
    smooth.ptt = true;
    continuousFrame();
    smooth.ptt = false;
    std::fill_n(audio.channels()[0], audio.num_frames(), 4000.0f);
    smoothGate.Process(&audio);
    for (size_t i = 0; i < audio.num_frames(); ++i)
      check(audio.channels()[0][i] == 0, "releasing PTT must flush voice immediately");
    smooth.ptt = true;
    std::fill_n(audio.channels()[0], audio.num_frames(), 0.0f);
    smoothGate.Process(&audio);
    for (size_t i = 0; i < audio.num_frames(); ++i)
      check(audio.channels()[0][i] == 0, "reopening PTT must never replay its buffered tail");
    Controls enhanced;
    enhanced.muted = false;
    enhanced.activity = false;
    enhanced.ptt = true;
    enhanced.autoGain = true;
    enhanced.noiseMode = NoiseMode::Rnnoise;
    enhanced.input = 2;
    Gate cleanGain(enhanced);
    cleanGain.Initialize(48000, 1);
    // A loud voiced signal plus broadband noise exercises the complete clean,
    // adaptive gain and user gain path, including filter swaps and mute.
    uint32_t random = 12345;
    for (int frameIndex = 0; frameIndex < 300; ++frameIndex) {
      for (size_t i = 0; i < audio.num_frames(); ++i) {
        random = random * 1664525u + 1013904223u;
        audio.channels()[0][i] = 23000 * std::sin((frameIndex * 480 + i) * 0.03) +
                                 (int32_t(random >> 16) - 32768) * 0.1f;
      }
      enhanced.muted = frameIndex >= 200;
      cleanGain.Process(&audio);
      for (size_t i = 0; i < audio.num_frames(); ++i) {
        check(std::isfinite(audio.channels()[0][i]) && std::abs(audio.channels()[0][i]) <= 29205,
              "RNNoise, AGC and 200% gain must remain finite with protected peaks");
        if (enhanced.muted) check(audio.channels()[0][i] == 0, "AGC must never bypass mute");
      }
    }
    check(enhanced.autoGainActive && enhanced.autoGainErrors == 0,
          "post-denoising AGC must process valid 10ms blocks");
    std::atomic<uint64_t> reads{0}, falseInactive{0};
    std::jthread diagnosticReader([&](std::stop_token stop) {
      while (!stop.stop_requested()) {
        if (!enhanced.autoGainActive.load()) ++falseInactive;
        ++reads;
      }
    });
    while (reads.load() == 0) std::this_thread::yield();
    for (int i = 0; i < 100; ++i) {
      std::fill_n(audio.channels()[0], audio.num_frames(), 4000.0f);
      cleanGain.Process(&audio);
    }
    diagnosticReader.request_stop();
    diagnosticReader.join();
    check(reads > 100 && falseInactive == 0,
          "concurrent diagnostics must not see AGC inactive during healthy processing");
    check(enhanced.autoGainFrames == 400, "diagnostics must count every completed AGC frame");
    enhanced.autoGain = false;
    cleanGain.Process(&audio);
    check(!enhanced.autoGainActive && enhanced.autoGainFrames == 400,
          "disabling AGC must publish inactive without counting a processed frame");
    enhanced.autoGain = true;
    cleanGain.Process(&audio);
    check(enhanced.autoGainActive && enhanced.autoGainFrames == 401,
          "reenabling AGC must restore its completed processing status");
    std::cout << "Voice gate invariants passed\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
