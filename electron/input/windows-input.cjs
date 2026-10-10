const { scanCodes, virtualKeys, mouseKeys } = require('../../renderer/push-to-talk-binding.cjs');

function createWindowsInput(koffi = require('koffi')) {
  const user32 = koffi.load('user32.dll');
  const state = user32.func('int16_t __stdcall GetAsyncKeyState(int key)');
  const metrics = user32.func('int __stdcall GetSystemMetrics(int index)');
  const foreground = user32.func('uintptr_t __stdcall GetForegroundWindow()');
  const thread = user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, void *pid)',
  );
  const layout = user32.func('uintptr_t __stdcall GetKeyboardLayout(uint32_t thread)');
  const map = user32.func(
    'uint32_t __stdcall MapVirtualKeyExW(uint32_t code, uint32_t type, uintptr_t layout)',
  );
  return {
    isDown(code) {
      let key;
      if (Object.hasOwn(mouseKeys, code)) {
        key = mouseKeys[code];
        // DOM button numbers are logical; GetAsyncKeyState uses physical buttons.
        if ((code === 'Mouse0' || code === 'Mouse2') && metrics(23)) key = key === 1 ? 2 : 1;
      } else if (Object.hasOwn(scanCodes, code)) {
        key = map(scanCodes[code], 3, layout(thread(foreground(), null)));
      } else key = virtualKeys[code];
      // Never use the unreliable "pressed since last query" low bit.
      return Boolean(key && state(key) & 0x8000);
    },
  };
}
module.exports = { createWindowsInput };
