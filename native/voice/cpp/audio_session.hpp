// MIT. This policy belongs to Cuescord's streams, never to Windows or other apps.
#pragma once
#ifdef _WIN32
#include <audioclient.h>

namespace cuescord {
inline HRESULT ConfigureCallAudio(IAudioClient2* client) {
  if (!client) return E_POINTER;
  AudioClientProperties properties{};
  properties.cbSize = sizeof(properties);
  // Communications opts both capture and render into Windows attenuation.
  // Selecting the user's communications endpoint is independent of this category.
  properties.eCategory = AudioCategory_Other;
  properties.bIsOffload = FALSE;
  properties.Options = AUDCLNT_STREAMOPTIONS_NONE;
  return client->SetClientProperties(&properties);
}

// Apply after Initialize, before Start, to this render stream only. Windows 11
// can attenuate other streams even when the call uses AudioCategory_Other.
inline HRESULT PreventOtherAudioAttenuation(IAudioClient* client) {
  if (!client) return E_POINTER;
  IAudioClientDuckingControl* control = nullptr;
  const HRESULT service = client->GetService(__uuidof(IAudioClientDuckingControl),
                                            reinterpret_cast<void**>(&control));
  // Older Windows versions do not expose this service. Their stream category
  // remains Other; no global audio preference or other application's volume is changed.
  if (service == E_NOINTERFACE) return S_FALSE;
  if (FAILED(service)) return service;
  const HRESULT result = control->SetDuckingOptionsForCurrentStream(
      AUDIO_DUCKING_OPTIONS_DO_NOT_DUCK_OTHER_STREAMS);
  control->Release();
  return result;
}
}  // namespace cuescord
#endif
