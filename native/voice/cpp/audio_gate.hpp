#pragma once
#include <api/audio/audio_processing.h>
#include <api/audio/builtin_audio_processing_builder.h>
#include <api/environment/environment_factory.h>
#include <modules/audio_processing/audio_buffer.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <memory>

#include "audio_priority.hpp"
#include "voice_activity.hpp"
#include "voice_controls.hpp"
#include "voice_dynamics.hpp"

class Gate final : public webrtc::CustomProcessing {
  Controls& controls;
  int release = 0, sampleRate = 48000;
  VoiceActivityDetector detector;
  NoiseReducer noise;
  std::array<float, 1440> delay{};
  size_t delayIndex = 0;
  bool wasEnabled = false, wasAutomatic = false, previousAutoGain = false;
  NoiseMode previousNoiseMode = NoiseMode::Native;
  uint32_t noiseRevision = 0;
  unsigned slowNoiseFrames = 0;
  const uint64_t noiseBudgetMicros;
  webrtc::Environment environment = webrtc::CreateEnvironment();
  webrtc::scoped_refptr<webrtc::AudioProcessing> gainController;
  std::array<std::array<float, 480>, 2> gainScratch{};
  std::array<float, 480> classifierScratch{};
  std::array<std::array<float, 480>, 2> preGainScratch{};
  GainRamp activityGain;
  PeakLimiter preGainLimiter, limiter;
  FrameTransition transition;
  SignalMeter inputMeter, processedMeter, outputMeter;
  std::chrono::steady_clock::time_point previousFrame{};

  void observeClock() {
    const auto& priority = AudioPriority::current();
    controls.captureMmcss = priority.registered;
    controls.captureMmcssInherited = priority.inherited;
    controls.capturePriorityError = priority.error;
    const auto now = std::chrono::steady_clock::now();
    if (previousFrame.time_since_epoch().count() != 0) {
      const uint64_t gap =
          std::chrono::duration_cast<std::chrono::microseconds>(now - previousFrame).count();
      controls.captureMaxGapMicros.store(std::max(gap, controls.captureMaxGapMicros.load()));
      if (gap > 40000) ++controls.captureLateFrames;
    }
    previousFrame = now;
  }
  void flushPrivateAudio() {
    delay.fill(0);
    delayIndex = 0;
    release = 0;
    activityGain.reset();
    limiter.reset();
    preGainLimiter.reset();
    transition.reset();
    noise.resetHistory();
    detector.reset();
  }
  void prepareProcessing(bool enabled, bool automatic) {
    const auto mode = controls.noiseMode.load();
    const auto revision = controls.noiseRevision.load();
    const bool filterReset = revision != noiseRevision;
    if (enabled != wasEnabled) flushPrivateAudio();
    if (revision != noiseRevision) {
      noise.initialize(sampleRate, controls.captureProcessingChannels.load());
      noiseRevision = revision;
      slowNoiseFrames = 0;
      controls.speechClassifierFailed = !noise.available();
    }
    if (enabled && wasEnabled &&
        (automatic != wasAutomatic || mode != previousNoiseMode || filterReset ||
         controls.autoGain.load() != previousAutoGain))
      transition.request(size_t(std::max(1, sampleRate / 200)));
    if (automatic != wasAutomatic) {
      detector.reset();
    }
    wasEnabled = enabled;
    wasAutomatic = automatic;
    previousNoiseMode = mode;
    previousAutoGain = controls.autoGain.load();
  }
  void failSpeechModel(bool filtering) {
    controls.speechClassifierFailed = true;
    controls.speechClassifierActive = false;
    if (filtering) controls.noiseFailed = true;
    controls.noiseActive = false;
  }
  void recordSpeechModelCost(bool filtering, bool automatic, uint64_t micros) {
    if (filtering) {
      ++controls.noiseFrames;
      controls.noiseMicros.fetch_add(micros);
      controls.noiseMaxMicros.store(std::max(micros, controls.noiseMaxMicros.load()));
    }
    if (automatic) {
      ++controls.speechClassifierFrames;
      controls.speechClassifierMicros.fetch_add(micros);
      controls.speechClassifierMaxMicros.store(
          std::max(micros, controls.speechClassifierMaxMicros.load()));
    }
    // One shared inference, whether used for filtering, detection or both.
    // Persistent overload degrades the model before audio can accumulate.
    slowNoiseFrames = micros > noiseBudgetMicros ? slowNoiseFrames + 1 : 0;
    if (slowNoiseFrames >= 10) failSpeechModel(filtering);
  }
  void processNoise(webrtc::AudioBuffer& audio, bool automatic) {
    const auto mode = controls.noiseMode.load();
    const bool filtering = mode == NoiseMode::Rnnoise && !controls.noiseFailed.load();
    const bool classifying = automatic && !controls.speechClassifierFailed.load();
    if (!filtering && !classifying) {
      noise.process(audio.channels()[0], audio.num_frames(),
                    mode == NoiseMode::Rnnoise ? NoiseMode::Off : mode);
      controls.noiseActive = false;
      controls.noiseSpeechProbability = controls.noiseDryMix = 0;
      controls.speechClassifierActive = false;
      controls.speechProbability = 0;
      return;
    }
    if (audio.num_channels() != 1 || audio.num_frames() != classifierScratch.size()) {
      failSpeechModel(filtering);
      return;
    }
    float* samples = audio.channels()[0];
    if (!filtering) {
      std::copy_n(samples, audio.num_frames(), classifierScratch.data());
      samples = classifierScratch.data();
    }
    const auto start = std::chrono::steady_clock::now();
    if (!noise.process(samples, audio.num_frames(), NoiseMode::Rnnoise)) {
      failSpeechModel(filtering);
      return;
    }
    const uint64_t micros = std::chrono::duration_cast<std::chrono::microseconds>(
                                std::chrono::steady_clock::now() - start)
                                .count();
    controls.noiseActive = filtering;
    controls.noiseSpeechProbability = filtering ? noise.speech() : 0;
    controls.noiseDryMix = filtering ? noise.preservedSpeechMix() : 0;
    controls.speechClassifierActive = automatic;
    controls.speechProbability = automatic ? noise.speech() : 0;
    recordSpeechModelCost(filtering, automatic, micros);
  }
  void applyAutoGain(webrtc::AudioBuffer& audio) {
    bool applied = false;
    const auto count = audio.num_frames(), channels = audio.num_channels();
    if (controls.autoGain.load() && gainController && count == size_t(sampleRate / 100) &&
        count <= 480 && channels > 0 && channels <= 2) {
      float* pointers[] = {gainScratch[0].data(), gainScratch[1].data()};
      for (size_t c = 0; c < channels; ++c)
        for (size_t i = 0; i < count; ++i)
          pointers[c][i] =
              std::isfinite(audio.channels()[c][i]) ? audio.channels()[c][i] / 32768.0f : 0;
      const webrtc::StreamConfig format(sampleRate, channels);
      if (gainController->ProcessStream(pointers, format, format, pointers) == 0) {
        applied = true;
        ++controls.autoGainFrames;
        for (size_t c = 0; c < channels; ++c)
          for (size_t i = 0; i < count; ++i) audio.channels()[c][i] = pointers[c][i] * 32768.0f;
      } else
        ++controls.autoGainErrors;
    }
    controls.autoGainActive = applied;
  }
  void protectAutoGainInput(webrtc::AudioBuffer& audio, bool enabled) {
    const auto count = audio.num_frames(), channels = audio.num_channels();
    if (count > 480 || channels == 0 || channels > 2) return;
    float* buffers[] = {preGainScratch[0].data(), preGainScratch[1].data()};
    for (size_t c = 0; c < channels; ++c) std::copy_n(audio.channels()[c], count, buffers[c]);
    // Keep the protection delay warm when bypassed. Enabling AGC must not insert
    // a fresh 5 ms hole into an already audible stream.
    const float attenuation =
        preGainLimiter.process(buffers, channels, count, enabled ? 1 : 0, sampleRate);
    const bool applied = controls.autoGain.load();
    if (applied)
      for (size_t c = 0; c < channels; ++c) std::copy_n(buffers[c], count, audio.channels()[c]);
    controls.preGainLimiterGain = applied ? attenuation : 1;
    if (applied && attenuation < .999f) ++controls.limitedPreGainFrames;
  }
  float measureLevel(const webrtc::AudioBuffer& audio) {
    double energy = 0;
    for (size_t c = 0; c < audio.num_channels(); ++c)
      for (size_t i = 0; i < audio.num_frames(); ++i) {
        const float value = audio.channels_const()[c][i];
        if (std::isfinite(value)) energy += double(value / 32768) * (value / 32768);
      }
    const double rms =
        std::sqrt(energy / std::max<size_t>(1, audio.num_frames() * audio.num_channels()));
    return rms > 0 ? std::round(std::clamp(float((20 * std::log10(rms) + 60) * 2), 0.0f, 100.0f))
                   : 0;
  }
  bool detectActivity(bool analyzedSpeech, bool automatic, float level) {
    const bool neural = controls.speechClassifierActive.load();
    const bool confidentSpeech = !neural || noise.speech() >= .8f;
    const bool modelSpeech = neural && noise.speech() >= .95f && level > 0;
    const bool detected = automatic ? (analyzedSpeech && confidentSpeech) || modelSpeech
                                    : level >= controls.threshold.load();
    controls.activityDetected = detected;
    controls.activityAnalysisGain = automatic ? detector.analysisGain() : 1;
    if (detected) ++controls.activitySpeechFrames;
    return detected;
  }
  void applyActivity(webrtc::AudioBuffer& audio, bool enabled, bool automatic, bool detected) {
    if (!enabled)
      release = 0;
    else if (detected)
      release = automatic ? 30 : 20;  // 300 / 200 ms, independent of sample rate.
    else if (release > 0)
      --release;
    const bool active = enabled && (controls.activity.load() ? release > 0 : controls.ptt.load());
    if (active != controls.activityGateOpen.load()) ++controls.activityTransitions;
    controls.activityGateOpen = active;
    if (enabled && !active) ++controls.activityClosedFrames;
    activityGain.setTarget(active ? 1 : 0, size_t(std::max(1, sampleRate / 100)));
    for (size_t i = 0; i < audio.num_frames(); ++i) {
      const float envelope = enabled ? activityGain.next() : 0;
      for (size_t c = 0; c < audio.num_channels(); ++c) {
        float value = std::isfinite(audio.channels()[c][i]) ? audio.channels()[c][i] : 0;
        if (enabled && audio.num_channels() == 1 && sampleRate == 48000) {
          const float delayed = delay[delayIndex];
          delay[delayIndex] = value;
          delayIndex = (delayIndex + 1) % delay.size();
          if (automatic) value = delayed;
        }
        audio.channels()[c][i] = value * envelope;
      }
    }
  }

 public:
  explicit Gate(Controls& controls, uint64_t noiseBudgetMicros = 8000)
      : controls(controls), noiseBudgetMicros(noiseBudgetMicros) {
    controls.noiseAvailable = noise.available();
    controls.speechClassifierFailed = !noise.available();
    detector.reset();
  }
  void Initialize(int rate, int channels) override {
    sampleRate = rate;
    controls.captureProcessingRate = rate;
    controls.captureProcessingChannels = channels;
    noise.initialize(rate, channels);
    flushPrivateAudio();
    wasEnabled = wasAutomatic = false;
    controls.noiseActive = false;
    slowNoiseFrames = 0;
    limiter.initialize(rate, channels);
    preGainLimiter.initialize(rate, channels);
    inputMeter.reset();
    processedMeter.reset();
    outputMeter.reset();
    previousFrame = {};
    webrtc::AudioProcessing::Config config;
    config.gain_controller2.enabled = true;
    config.gain_controller2.adaptive_digital.enabled = true;
    config.gain_controller2.adaptive_digital.headroom_db = 6;
    config.gain_controller2.adaptive_digital.max_gain_db = 18;
    config.gain_controller2.adaptive_digital.initial_gain_db = 6;
    config.gain_controller2.adaptive_digital.max_gain_change_db_per_second = 3;
    gainController = webrtc::BuiltinAudioProcessingBuilder(config).Build(environment);
    webrtc::ProcessingConfig format;
    format.input_stream() = webrtc::StreamConfig(rate, channels);
    format.output_stream() = webrtc::StreamConfig(rate, channels);
    if (!gainController || gainController->Initialize(format) != 0) gainController = nullptr;
    controls.autoGainActive = false;
  }
  std::string ToString() const override { return "Cuescord voice gate"; }
  void Process(webrtc::AudioBuffer* audio) override {
    observeClock();
    inputMeter.observe(audio->channels(), audio->num_channels(), audio->num_frames(),
                       controls.captureInput);
    const bool enabled = !controls.muted.load() && !controls.deafened.load() &&
                         controls.input.load() > 0 &&
                         (controls.activity.load() || controls.ptt.load());
    const bool automatic = controls.activity.load() && controls.automatic.load() &&
                           detector.available() && sampleRate == 48000 &&
                           audio->num_frames() == 480 && audio->num_channels() == 1;
    prepareProcessing(enabled, automatic);
    // Do not feed muted PCM into stateful filters: unmute must not replay it.
    if (!enabled)
      for (size_t c = 0; c < audio->num_channels(); ++c)
        std::fill_n(audio->channels()[c], audio->num_frames(), 0.0f);
    // Analyze before denoising/AGC. Normalizing their low-level, nonstationary
    // residual can otherwise keep the detector open on background noise alone.
    const bool analyzedSpeech =
        automatic && detector.detect(audio->channels()[0], audio->num_frames());
    processNoise(*audio, automatic);
    // AGC's normalized-float API must not receive already clipped RNNoise peaks.
    // The final limiter is sufficient when the normalized-float AGC API is off.
    protectAutoGainInput(*audio, enabled);
    applyAutoGain(*audio);
    processedMeter.observe(audio->channels(), audio->num_channels(), audio->num_frames(),
                           controls.captureProcessed);
    const float level = measureLevel(*audio);
    controls.level = level;
    applyActivity(*audio, enabled, automatic, detectActivity(analyzedSpeech, automatic, level));
    if (enabled) transition.process(audio->channels(), audio->num_channels(), audio->num_frames());
    const float attenuation =
        limiter.process(audio->channels(), audio->num_channels(), audio->num_frames(),
                        enabled ? controls.input.load() : 0, sampleRate);
    outputMeter.observe(audio->channels(), audio->num_channels(), audio->num_frames(),
                        controls.captureOutput);
    const bool audible = controls.captureOutput.peakDbfs.load() > -120;
    controls.transmitting = enabled && (controls.activityGateOpen.load() || audible);
    controls.speaking = enabled && audible && level >= 2;
    controls.captureLimiterGain = attenuation;
    if (attenuation < .999f) ++controls.limitedCaptureFrames;
    ++controls.frames;
  }
};
