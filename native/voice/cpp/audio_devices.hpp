#pragma once
#include <api/audio/audio_device.h>
#include <rtc_base/thread.h>

#include <stdexcept>
#include <string>

// ADM is worker-affine. Driver errors are returned to the control thread rather
// than throwing through WebRTC's task runner. A disappeared endpoint selects
// the communication default; WASAPI also restarts after device notifications.
class AudioDevices {
  std::string inputId, outputId;
  bool selected = false;

 public:
  void select(webrtc::Thread& worker, webrtc::AudioDeviceModule& adm, const std::string& nextInput,
              const std::string& nextOutput) {
    if (selected && nextInput == inputId && nextOutput == outputId) return;
    const bool ok = worker.BlockingCall([&] {
      const bool recording = adm.Recording(), playing = adm.Playing();
      if ((recording && adm.StopRecording() != 0) || (playing && adm.StopPlayout() != 0))
        return false;
      for (bool input : {true, false}) {
        const auto& id = input ? nextInput : nextOutput;
        const int count = input ? adm.RecordingDevices() : adm.PlayoutDevices();
        bool matched = false;
        for (int i = 0; i < count && !id.empty(); ++i) {
          char name[webrtc::kAdmMaxDeviceNameSize]{}, guid[webrtc::kAdmMaxGuidSize]{};
          const int result =
              input ? adm.RecordingDeviceName(i, name, guid) : adm.PlayoutDeviceName(i, name, guid);
          if (result == 0 && id == guid) {
            if ((input ? adm.SetRecordingDevice(uint16_t(i)) : adm.SetPlayoutDevice(uint16_t(i))) !=
                0)
              return false;
            matched = true;
            break;
          }
        }
        if (!matched) {
#ifdef _WIN32
          const auto device = webrtc::AudioDeviceModule::kDefaultCommunicationDevice;
#else
          const uint16_t device = 0;
#endif
          if ((input ? adm.SetRecordingDevice(device) : adm.SetPlayoutDevice(device)) != 0)
            return false;
        }
      }
      if (recording && (adm.InitRecording() != 0 || adm.StartRecording() != 0)) return false;
      if (playing && (adm.InitPlayout() != 0 || adm.StartPlayout() != 0)) return false;
      return true;
    });
    if (!ok) throw std::runtime_error("audio endpoint unavailable");
    inputId = nextInput;
    outputId = nextOutput;
    selected = true;
  }
};
