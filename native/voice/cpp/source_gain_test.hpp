#pragma once
#include "voice_source_gain.hpp"

class SteadyVoiceSource final : public webrtc::AudioMixer::Source {
 public:
  AudioFrameInfo GetAudioFrameWithInfo(int rate, webrtc::AudioFrame* frame) override {
    std::array<int16_t, 480> data{};
    data.fill(20000);
    frame->UpdateFrame(0, data.data(), rate / 100, rate, webrtc::AudioFrame::kNormalSpeech,
                       webrtc::AudioFrame::kVadActive, 1);
    return AudioFrameInfo::kNormal;
  }
  int Ssrc() const override { return 77; }
  int PreferredSampleRate() const override { return 48000; }
};
inline void checkIndividualVoiceGain() {
  Controls controls;
  SteadyVoiceSource original;
  ProtectedVoiceSource source(original, controls);
  source.setGain(2);
  webrtc::AudioFrame frame;
  for (int block = 0; block < 20; ++block) {
    source.GetAudioFrameWithInfo(48000, &frame);
    for (size_t i = 0; i < frame.samples_per_channel(); ++i)
      check(std::abs(int(frame.data()[i])) <= 29205,
            "200% participant gain must be limited before converting back to PCM16");
  }
  check(controls.limitedSourceFrames > 0 && controls.sourceLimiterMinimumGain < .9f,
        "individual voice limiting must be observable rather than saturating inside the SDK");
  source.setGain(0);
  check(source.GetAudioFrameWithInfo(48000, &frame) ==
            webrtc::AudioMixer::Source::AudioFrameInfo::kMuted,
        "individual mute must clear its gain and audio history");
  for (size_t i = 0; i < frame.samples_per_channel(); ++i)
    check(frame.data()[i] == 0, "an individually muted source must emit no buffered PCM");
  source.setGain(.5);
  for (int block = 0; block < 10; ++block) source.GetAudioFrameWithInfo(48000, &frame);
  check(frame.data()[479] == 10000,
        "a quiet participant gain must preserve its requested linear level");
  source.setGain(1);
  int previous = 10000;
  for (int block = 0; block < 3; ++block) {
    source.GetAudioFrameWithInfo(48000, &frame);
    for (size_t i = 0; i < frame.samples_per_channel(); ++i) {
      check(std::abs(int(frame.data()[i]) - previous) < 100,
            "participant gain changes must ramp instead of clicking between PCM16 levels");
      previous = frame.data()[i];
    }
  }
}

inline void checkSourceGainLifecycle() {
  Controls controls;
  controls.voiceBoost = false;
  auto mixer = webrtc::make_ref_counted<VoiceMixer>(controls);
  SteadyVoiceSource source;
  mixer->setSourceVolume(77, .25f);
  check(mixer->AddSource(&source) && !mixer->AddSource(&source),
        "source registration must retain pending gain and reject a duplicate source");
  webrtc::AudioFrame frame;
  for (int i = 0; i < 10; ++i) mixer->Mix(1, &frame);
  check(std::abs(int(frame.data()[479]) - 5000) <= 2,
        "a gain set before source registration must apply to the actual mix");
  mixer->RemoveSource(&source);
  check(mixer->AddSource(&source), "a removed source must be independently registerable again");
  for (int i = 0; i < 10; ++i) mixer->Mix(1, &frame);
  check(std::abs(int(frame.data()[479]) - 20000) <= 2,
        "a new registration must not inherit gain from the old source lifetime");
  mixer->RemoveSource(&source);
}
