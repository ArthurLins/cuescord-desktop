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
}  // namespace cuescord
#endif
