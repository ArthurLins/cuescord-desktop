// Stable DOM codes shared by settings, focused input and Windows input.
const scanCodes = {
  Backquote: 0x29,
  Minus: 0x0c,
  Equal: 0x0d,
  BracketLeft: 0x1a,
  BracketRight: 0x1b,
  Backslash: 0x2b,
  Semicolon: 0x27,
  Quote: 0x28,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
  IntlBackslash: 0x56,
  IntlRo: 0x73,
  IntlYen: 0x7d,
};
for (const [codes, scans] of [
  ['QWERTYUIOP', [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19]],
  ['ASDFGHJKL', [0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26]],
  ['ZXCVBNM', [0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32]],
])
  for (let i = 0; i < codes.length; i++) scanCodes['Key' + codes[i]] = scans[i];
for (let i = 1; i <= 9; i++) scanCodes['Digit' + i] = i + 1;
scanCodes.Digit0 = 0x0b;
const virtualKeys = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  Escape: 0x1b,
  Space: 0x20,
  CapsLock: 0x14,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  Pause: 0x13,
  PrintScreen: 0x2c,
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
  NumLock: 0x90,
  ScrollLock: 0x91,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,
  NumpadEnter: 0x0d,
};
for (let i = 1; i <= 24; i++) virtualKeys['F' + i] = 0x6f + i;
for (let i = 0; i <= 9; i++) virtualKeys['Numpad' + i] = 0x60 + i;
const mouseKeys = { Mouse0: 0x01, Mouse1: 0x04, Mouse2: 0x02, Mouse3: 0x05, Mouse4: 0x06 };
function validPushToTalkShortcut(code) {
  return (
    typeof code === 'string' &&
    (Object.hasOwn(scanCodes, code) ||
      Object.hasOwn(virtualKeys, code) ||
      Object.hasOwn(mouseKeys, code))
  );
}
function mouseShortcut(button) {
  return Number.isInteger(button) && button >= 0 && button <= 4 ? 'Mouse' + button : undefined;
}
function formatPushToTalkShortcut(code, locale = 'pt-BR') {
  const labels =
    locale === 'pt-BR'
      ? ['Mouse esquerdo', 'Mouse do meio', 'Mouse direito', 'Mouse lateral 1', 'Mouse lateral 2']
      : ['Left mouse', 'Middle mouse', 'Right mouse', 'Mouse side 1', 'Mouse side 2'];
  if (Object.hasOwn(mouseKeys, code)) return labels[Number(code.slice(5))];
  return code
    .replace(/^Key|^Digit/, '')
    .replace(/Left$/, ' (L)')
    .replace(/Right$/, ' (R)');
}
module.exports = {
  scanCodes,
  virtualKeys,
  mouseKeys,
  validPushToTalkShortcut,
  mouseShortcut,
  formatPushToTalkShortcut,
};
