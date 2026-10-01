const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
const { installUpdates } = require(
  process.env.CUESCORD_TEST_ASAR
    ? path.join(process.env.CUESCORD_TEST_ASAR, 'electron/update/window.cjs')
    : '../../electron/update/window.cjs',
);
app.setPath('userData', path.join(os.tmpdir(), `cuescord-native-test-${process.pid}`));
// Exercise the real sandbox/preload/IPC without displaying a test window.
BrowserWindow.prototype.show = () => {};
app.whenReady().then(() =>
  installUpdates({
    app: process.env.CUESCORD_TEST_ASAR
      ? {
          isPackaged: true,
          getVersion: () => '0.4.0',
          getPath: (name) => app.getPath(name),
          on: (...args) => app.on(...args),
          quit: () => app.quit(),
        }
      : app,
    ipcMain,
    getWindow: () => undefined,
  }).show(),
);
