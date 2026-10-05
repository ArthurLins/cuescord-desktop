#pragma once
#include <api/audio/audio_processing.h>
#include <common_audio/vad/include/webrtc_vad.h>
#include <modules/audio_processing/audio_buffer.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <memory>
struct Controls {
  std::atomic<bool> muted{true}, deafened{false}, ptt{false}, activity{true}, automatic{false};
  std::atomic<float> input{1}, output{1}, threshold{8}, level{0};
  std::atomic<bool> speaking{false}, transmitting{false};
  std::atomic<uint64_t> frames{0};
};

class Gate final : public webrtc::CustomProcessing {
  Controls& controls;
  int release = 0;
  int sampleRate = 48000;
  std::unique_ptr<VadInst, decltype(&WebRtcVad_Free)> vad{WebRtcVad_Create(), WebRtcVad_Free};
  std::array<int16_t, 480> mono{};

 public:
  explicit Gate(Controls& controls) : controls(controls) {}
  void Initialize(int rate, int) override {
    release = 0;
    sampleRate = rate;
    if (vad) {
      WebRtcVad_Init(vad.get());
      WebRtcVad_set_mode(vad.get(), 2);
    }
  }
  std::string ToString() const override { return "Cuescord voice gate"; }
  void Process(webrtc::AudioBuffer* audio) override {
    double energy = 0;
    const auto count = audio->num_frames();
    for (size_t c = 0; c < audio->num_channels(); ++c)
      for (size_t i = 0; i < count; ++i) {
        const double sample = audio->channels()[c][i] / 32768.0;
        energy += sample * sample;
      }
    const double rms = std::sqrt(energy / std::max<size_t>(1, count * audio->num_channels()));
    const float level =
        rms > 0 ? std::clamp(float((20 * std::log10(rms) + 60) * 2), 0.0f, 100.0f) : 0;
    controls.level.store(level);
    bool audible = level >= controls.threshold.load();
    if (controls.automatic.load() && vad && count <= mono.size()) {
      for (size_t i = 0; i < count; ++i) {
        float sum = 0;
        for (size_t c = 0; c < audio->num_channels(); ++c) sum += audio->channels()[c][i];
        mono[i] = int16_t(
            std::clamp(sum / std::max<size_t>(1, audio->num_channels()), -32768.0f, 32767.0f));
      }
      const auto speech = WebRtcVad_Process(vad.get(), sampleRate, mono.data(), count);
      if (speech >= 0) audible = speech == 1 && level >= 2;
    }
    if (audible)
      release = 20;
    else if (release > 0)
      --release;
    const bool active = controls.activity.load() ? release > 0 : controls.ptt.load();
    const float gain =
        !controls.muted.load() && !controls.deafened.load() && active ? controls.input.load() : 0;
    controls.transmitting.store(gain > 0);
    controls.speaking.store(gain > 0 && level >= 2);
    for (size_t c = 0; c < audio->num_channels(); ++c)
      for (size_t i = 0; i < count; ++i)
        audio->channels()[c][i] = std::clamp(audio->channels()[c][i] * gain, -32768.0f, 32767.0f);
    controls.frames.fetch_add(1);
  }
};
