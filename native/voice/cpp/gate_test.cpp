#include <iostream>
#include <stdexcept>

#include "audio_gate.hpp"

void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
int main() {
  Controls controls;
  Gate gate(controls);
  webrtc::AudioBuffer audio(48000, 1, 48000, 1, 48000, 1);
  const auto frame = [&](float sample) {
    std::fill_n(audio.channels()[0], audio.num_frames(), sample);
    gate.Process(&audio);
    return audio.channels()[0][0];
  };
  try {
    check(frame(4000) == 0, "default must be muted");
    controls.muted = false;
    check(frame(4000) > 0, "voice activity should pass speech");
    check(controls.speaking && controls.transmitting, "meter must match real gate");
    controls.deafened = true;
    check(frame(4000) == 0, "deafen must immediately silence capture");
    controls.deafened = false;
    controls.activity = false;
    check(frame(4000) == 0, "PTT must ignore activity hangover");
    controls.ptt = true;
    controls.input = 2;
    check(frame(20000) == 32767, "gain must clip safely");
    controls.input = 0;
    check(frame(4000) == 0 && !controls.transmitting, "zero input volume must close gate");
    controls.input = 1;
    controls.activity = true;
    controls.threshold = 20;
    frame(4000);
    for (int i = 0; i < 19; ++i) frame(0);
    check(controls.transmitting, "hold must cover syllable gaps");
    frame(0);
    check(!controls.transmitting, "hold must expire after 200ms");
    gate.Initialize(48000, 1);
    frame(0);
    check(!controls.transmitting, "device reinitialization must reset hold");
    std::cout << "Voice gate invariants passed\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
