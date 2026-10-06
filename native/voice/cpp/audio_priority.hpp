#pragma once
#ifdef _WIN32
// avrt.h requires Windows declarations before inclusion.
// clang-format off
#include <windows.h>
#include <avrt.h>
// clang-format on
#endif

// The registration and its revocation belong to the audio thread, not Engine's
// control thread. No global realtime priority or persistent OS setting changes.
class AudioPriority {
#ifdef _WIN32
  HANDLE handle = nullptr;
#endif
 public:
  bool registered = false;
  bool inherited = false;
  unsigned error = 0;
  AudioPriority() {
#ifdef _WIN32
    DWORD task = 0;
    handle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task);
    registered = handle != nullptr;
    if (!registered) {
      error = GetLastError();
      // WASAPI/libwebrtc already registers its threads. A second registration
      // is rejected with 1552; that is an existing MMCSS task, not lost priority.
      // Never revoke a registration owned by the SDK.
      if (error == ERROR_THREAD_ALREADY_IN_TASK) {
        inherited = registered = true;
        error = 0;
      }
    }
#endif
  }
  ~AudioPriority() {
#ifdef _WIN32
    if (handle) AvRevertMmThreadCharacteristics(handle);
#endif
  }
  AudioPriority(const AudioPriority&) = delete;
  AudioPriority& operator=(const AudioPriority&) = delete;
  static const AudioPriority& current() {
    thread_local AudioPriority priority;
    return priority;
  }
};
