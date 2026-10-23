#pragma once
#include <algorithm>
#include <string>
#ifdef _WIN32
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#endif

struct EndpointInspection {
  std::string id;
  bool present = false;
  bool presenceAvailable = false;
  int mixRate = 0, mixChannels = 0, mixBits = 0;
  long error = 0;
};

// Control-thread inspection of the selected endpoint's shared mix format.
// This does not open, initialize or record a stream, and is not the processing
// format negotiated by WebRTC. IDs stay inside the helper.
inline EndpointInspection inspectAudioEndpoint(bool input, const std::string& id) {
  EndpointInspection result;
#ifdef _WIN32
  using Microsoft::WRL::ComPtr;
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT status = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                    IID_PPV_ARGS(&enumerator));
  ComPtr<IMMDevice> device;
  if (SUCCEEDED(status)) {
    if (id.empty())
      status =
          enumerator->GetDefaultAudioEndpoint(input ? eCapture : eRender, eCommunications, &device);
    else {
      const int length =
          MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, id.data(), int(id.size()), nullptr, 0);
      std::wstring wide(size_t(std::max(0, length)), L'\0');
      if (length > 0)
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, id.data(), int(id.size()), wide.data(),
                            length);
      status = length > 0 ? enumerator->GetDevice(wide.c_str(), &device) : E_INVALIDARG;
    }
  }
  if (SUCCEEDED(status)) {
    DWORD state = 0;
    status = device->GetState(&state);
    result.presenceAvailable = SUCCEEDED(status);
    result.present = SUCCEEDED(status) && (state & DEVICE_STATE_ACTIVE) != 0;
    LPWSTR endpointId = nullptr;
    if (SUCCEEDED(device->GetId(&endpointId))) {
      const int length =
          WideCharToMultiByte(CP_UTF8, 0, endpointId, -1, nullptr, 0, nullptr, nullptr);
      if (length > 0) {
        result.id.resize(size_t(length));
        WideCharToMultiByte(CP_UTF8, 0, endpointId, -1, result.id.data(), length, nullptr, nullptr);
        result.id.pop_back();
      }
      CoTaskMemFree(endpointId);
    }
    ComPtr<IAudioClient> client;
    status = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client);
    if (SUCCEEDED(status)) {
      WAVEFORMATEX* format = nullptr;
      status = client->GetMixFormat(&format);
      if (SUCCEEDED(status) && format) {
        result.mixRate = int(format->nSamplesPerSec);
        result.mixChannels = format->nChannels;
        result.mixBits = format->wBitsPerSample;
      }
      CoTaskMemFree(format);
    }
  }
  result.error = FAILED(status) ? status : 0;
#endif
  return result;
}
