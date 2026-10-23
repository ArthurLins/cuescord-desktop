#pragma once
#include <modules/audio_device/include/audio_device_data_observer.h>

#include "voice_controls.hpp"

// Observes PCM before WebRTC resampling/AEC/NS. Only aggregates survive a callback.
// The SDK wrapper forwards the original pointer unchanged to its audio transport.
class CaptureSignalObserver final : public webrtc::AudioDeviceDataObserver {
  Controls& controls;
  SignalMeter meter;

 public:
  explicit CaptureSignalObserver(Controls& controls) : controls(controls) {}
  void OnCaptureData(const void* data, size_t count, size_t bytes, size_t channels,
                     uint32_t rate) override {
    if (!data || channels == 0 || channels > 2 || count == 0 || count > 1920 || rate < 8000 ||
        rate > 192000 || (bytes != sizeof(int16_t) && bytes != sizeof(int16_t) * channels)) {
      ++controls.captureDeviceFormatErrors;
      return;
    }
    if (rate != controls.captureDeviceRate.load() ||
        channels != controls.captureDeviceChannels.load())
      meter.reset();
    controls.captureDeviceRate = rate;
    controls.captureDeviceChannels = unsigned(channels);
    controls.captureDeviceBytesPerFrame = unsigned(sizeof(int16_t) * channels);
    meter.observeInterleaved(static_cast<const int16_t*>(data), channels, count,
                             controls.captureDevice);
  }
  void OnRenderData(const void*, size_t, size_t, size_t, uint32_t) override {
    // Render aggregates are measured at VoiceMixer, after its protected gain.
  }
};
