const input = require('../../electron/input/windows-input.cjs');
const actual = input.createWindowsInput();
globalThis.pttFixture = { held: {}, read: (code) => actual.isDown(code) };
// OS library is real; button states are controlled to avoid injecting input
// into the user's desktop or depending on their physical keyboard/mouse.
input.createWindowsInput = () => ({ isDown: (code) => Boolean(globalThis.pttFixture.held[code]) });
require('./media-native.cjs');
