const { app, BrowserWindow } = require('electron');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const profileArgument = process.argv.find((argument) => argument.startsWith('--user-data-dir='));
const profile = profileArgument
  ? profileArgument.slice('--user-data-dir='.length)
  : path.join(os.tmpdir(), `cuescord-recovery-test-${process.pid}`);
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
// Tests must never hand off to an installed client or another test process.
app.requestSingleInstanceLock = () => true;
// Exercise the real main process and preload without showing a test window.
BrowserWindow.prototype.show = () => {};
require('../../electron/main.cjs');
