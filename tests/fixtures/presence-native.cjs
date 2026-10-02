const { app, BrowserWindow, Tray } = require('electron');
const { mkdirSync } = require('node:fs');
const profile = process.argv
  .find((argument) => argument.startsWith('--user-data-dir='))
  .slice('--user-data-dir='.length);
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.requestSingleInstanceLock = () => true;
globalThis.presenceTest = { overlay: null, icon: null, tooltip: '', menu: null, tray: null };
// Exercise native APIs with an isolated, invisible test window.
const show = BrowserWindow.prototype.show;
BrowserWindow.prototype.show = function () {
  this.setOpacity(0);
  this.setSkipTaskbar(true);
  return show.call(this);
};
for (const [prototype, method, record] of [
  [
    BrowserWindow.prototype,
    'setIcon',
    (icon) => {
      globalThis.presenceTest.icon = icon.toPNG().toString('base64');
    },
  ],
  [
    BrowserWindow.prototype,
    'setOverlayIcon',
    (icon, description) => {
      globalThis.presenceTest.overlay = icon ? icon.toPNG().toString('base64') : null;
      globalThis.presenceTest.description = description;
    },
  ],
  [
    Tray.prototype,
    'setToolTip',
    function (tooltip) {
      globalThis.presenceTest.tooltip = tooltip;
      globalThis.presenceTest.tray = this;
    },
  ],
  [
    Tray.prototype,
    'setContextMenu',
    (menu) => {
      globalThis.presenceTest.menu = menu;
    },
  ],
]) {
  const original = prototype[method];
  prototype[method] = function (...args) {
    const result = original.apply(this, args);
    record.apply(this, args);
    return result;
  };
}
require('../../electron/main.cjs');
