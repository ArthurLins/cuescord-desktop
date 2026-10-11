#pragma once
#ifdef _WIN32
// avrt.h requires Windows declarations before inclusion.
// clang-format off
#include <windows.h>
#include <avrt.h>
// clang-format on
#endif

// Only the dedicated voice helper owns this scope. Raise all its codec/RTP
// workers before starting them; the Electron UI keeps its usual priority.
// HIGH stays below OS realtime work and does not reserve CPU or change affinity.
class ProcessAudioPriority {
#ifdef _WIN32
  DWORD previous = 0;
  bool changed = false;
#endif
 public:
  unsigned error = 0;
  ProcessAudioPriority() {
#ifdef _WIN32
    previous = GetPriorityClass(GetCurrentProcess());
    if (!previous) {
      error = GetLastError();
      return;
    }
    if (previous != HIGH_PRIORITY_CLASS) {
      changed = SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS) != 0;
      // A denied boost must not prevent a person from joining voice.
      if (!changed) error = GetLastError();
    }
#endif
  }
  ~ProcessAudioPriority() {
#ifdef _WIN32
    if (changed && currentClass() == HIGH_PRIORITY_CLASS)
      SetPriorityClass(GetCurrentProcess(), previous);
#endif
  }
  unsigned currentClass() const {
#ifdef _WIN32
    return GetPriorityClass(GetCurrentProcess());
#else
    return 0;
#endif
  }
  ProcessAudioPriority(const ProcessAudioPriority&) = delete;
  ProcessAudioPriority& operator=(const ProcessAudioPriority&) = delete;
};

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
