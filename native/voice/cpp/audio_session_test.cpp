#include <iostream>
#include <stdexcept>

#include "audio_session.hpp"

static void check(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}

// All audio/device/volume operations other than stream properties are forbidden.
class Client final : public IAudioClient2 {
 public:
  AudioClientProperties properties{};
  HRESULT result = S_OK;
  int calls = 0, otherCalls = 0;
  HRESULT STDMETHODCALLTYPE SetClientProperties(const AudioClientProperties* value) override {
    properties = *value;
    ++calls;
    return result;
  }
  HRESULT unexpected() { ++otherCalls; return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void**) override { return unexpected(); }
  ULONG STDMETHODCALLTYPE AddRef() override { ++otherCalls; return 1; }
  ULONG STDMETHODCALLTYPE Release() override { ++otherCalls; return 1; }
  HRESULT STDMETHODCALLTYPE Initialize(AUDCLNT_SHAREMODE, DWORD, REFERENCE_TIME,
      REFERENCE_TIME, const WAVEFORMATEX*, LPCGUID) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE GetBufferSize(UINT32*) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE GetStreamLatency(REFERENCE_TIME*) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE GetCurrentPadding(UINT32*) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE IsFormatSupported(AUDCLNT_SHAREMODE, const WAVEFORMATEX*,
      WAVEFORMATEX**) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE GetMixFormat(WAVEFORMATEX**) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE GetDevicePeriod(REFERENCE_TIME*, REFERENCE_TIME*) override {
    return unexpected();
  }
  HRESULT STDMETHODCALLTYPE Start() override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE Stop() override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE Reset() override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE SetEventHandle(HANDLE) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE GetService(REFIID, void**) override { return unexpected(); }
  HRESULT STDMETHODCALLTYPE IsOffloadCapable(AUDIO_STREAM_CATEGORY, BOOL*) override {
    return unexpected();
  }
  HRESULT STDMETHODCALLTYPE GetBufferSizeLimits(const WAVEFORMATEX*, BOOL,
      REFERENCE_TIME*, REFERENCE_TIME*) override { return unexpected(); }
};

int main() {
  try {
    for (const char* direction : {"capture", "render"}) {
      Client client;
      for (int opening = 1; opening <= 3; ++opening) {
        check(cuescord::ConfigureCallAudio(&client) == S_OK, direction);
        check(client.calls == opening && client.otherCalls == 0,
              "initialization/restarts must only configure this stream");
        check(client.properties.cbSize == sizeof(AudioClientProperties), "property size");
        check(client.properties.eCategory == AudioCategory_Other,
              "a call must not opt into communications attenuation");
        check(client.properties.bIsOffload == FALSE &&
              client.properties.Options == AUDCLNT_STREAMOPTIONS_NONE,
              "shared software processing must remain available");
      }
      client.result = E_ACCESSDENIED;
      check(cuescord::ConfigureCallAudio(&client) == E_ACCESSDENIED,
            "configuration errors must reach initialization before the stream starts");
      check(client.otherCalls == 0, "policy must never touch device/session volume");
    }
    check(cuescord::ConfigureCallAudio(nullptr) == E_POINTER, "missing client");
    std::cout << "Audio session policy: capture, render, reopen, error and no volume writes passed\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
