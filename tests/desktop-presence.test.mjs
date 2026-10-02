import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  installDesktopPresence,
  validPresence,
} = require('../electron/window/desktop-presence.cjs');
const { badgePng, callPng } = require('../electron/window/status-icons.cjs');

function setup(platform = 'win32') {
  const app = new EventEmitter();
  let quitCount = 0;
  app.quit = () => {
    quitCount++;
    app.emit('before-quit');
  };
  const calls = [];
  const frame = { url: 'https://cuescord.cuesc.net/channels/1' };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    hide: () => calls.push('hide'),
    setIcon: (image) => calls.push(['icon', image]),
    setOverlayIcon: (image, description) => calls.push(['overlay', image, description]),
  });
  let tray;
  class Tray extends EventEmitter {
    constructor() {
      super();
      tray = this;
    }
    setImage(image) {
      this.image = image;
    }
    setToolTip(tooltip) {
      this.tooltip = tooltip;
    }
    setContextMenu(menu) {
      this.menu = menu;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const nativeImage = {
    createFromPath: () => ({
      normal: true,
      resize() {
        return this;
      },
    }),
    createFromBuffer: (buffer) => ({
      buffer,
      resize() {
        return this;
      },
    }),
  };
  let handler;
  const presence = installDesktopPresence({
    app,
    Tray,
    Menu: { buildFromTemplate: (menu) => menu },
    nativeImage,
    ipcMain: {
      handle: (_name, callback) => {
        handler = callback;
      },
    },
    getWindow: () => window,
    ownsContents: (sender) => sender === contents,
    trustedUrl: 'https://cuescord.cuesc.net',
    iconPath: '/local/icon.png',
    platform,
  });
  presence.attach(window);
  calls.length = 0;
  return {
    app,
    window,
    contents,
    tray,
    calls,
    handler,
    quitCount: () => quitCount,
    event: { sender: contents, senderFrame: frame },
  };
}

test('close hides the window, tray restores it, explicit tray quit permits closing', () => {
  const { app, window, tray, calls, quitCount } = setup();
  const close = { preventDefault: () => calls.push('prevent') };
  window.emit('close', close);
  assert.deepEqual(calls, ['prevent', 'hide']);
  tray.emit('click');
  assert.deepEqual(calls.slice(-3), ['restore', 'show', 'focus']);
  tray.menu.find((item) => item.label === 'Fechar Cuescord').click();
  assert.equal(quitCount(), 1);
  calls.length = 0;
  window.emit('close', close);
  assert.deepEqual(calls, []);
  app.emit('will-quit');
  assert.equal(tray.destroyed, true);
});

test('unread badge is bounded, uses the actual count in its description and clears at zero', () => {
  const { handler, event, calls } = setup();
  handler(event, { unreadCount: 123, inCall: false, microphoneMuted: false });
  assert.deepEqual(calls.at(-1)[1].buffer, badgePng(100));
  assert.equal(calls.at(-1)[2], '123 mensagens não lidas');
  const count = calls.length;
  handler(event, { unreadCount: 123, inCall: false, microphoneMuted: false });
  assert.equal(calls.length, count);
  handler(event, { unreadCount: 0, inCall: false, microphoneMuted: false });
  assert.deepEqual(calls.at(-1), ['overlay', null, '']);
});

test('call microphone changes both icons without losing unread, and leaving restores branding', () => {
  const { handler, event, tray, calls } = setup();
  handler(event, { unreadCount: 8, inCall: true, microphoneMuted: false });
  assert.deepEqual(tray.image.buffer, callPng(false));
  assert.match(tray.tooltip, /microfone ativado.*8 mensagens/);
  handler(event, { unreadCount: 8, inCall: true, microphoneMuted: true });
  assert.deepEqual(tray.image.buffer, callPng(true));
  assert.match(tray.tooltip, /microfone desativado/);
  assert.equal(calls.at(-1)[2], '8 mensagens não lidas');
  handler(event, { unreadCount: 8, inCall: false, microphoneMuted: true });
  assert.equal(tray.image.normal, true);
  assert.doesNotMatch(tray.tooltip, /microfone|chamada/);
  assert.equal(
    tray.menu.some((item) => item.enabled === false),
    false,
  );
});

test('reload and renderer crashes reset stale badges and call states', () => {
  const { handler, event, contents, tray } = setup();
  const active = { unreadCount: 5, inCall: true, microphoneMuted: true };
  handler(event, active);
  contents.emit('did-start-navigation', {}, 'https://cuescord.cuesc.net/dms/1', true, true);
  assert.match(tray.tooltip, /chamada/);
  contents.emit('did-start-navigation', {}, 'https://cuescord.cuesc.net/', false, true);
  assert.equal(tray.tooltip, 'Cuescord');
  handler(event, active);
  contents.emit('render-process-gone');
  assert.equal(tray.tooltip, 'Cuescord');
});

test('untrusted windows, subframes, origins and malformed state cannot update native presence', () => {
  const { handler, event } = setup();
  const state = { unreadCount: 1, inCall: false, microphoneMuted: false };
  assert.throws(() => handler({ ...event, sender: {} }, state), /não autorizada/);
  assert.throws(
    () => handler({ ...event, senderFrame: { ...event.senderFrame } }, state),
    /não autorizada/,
  );
  event.senderFrame.url = 'https://evil.test';
  assert.throws(() => handler(event, state), /não autorizada/);
  for (const invalid of [
    null,
    {},
    { ...state, unreadCount: -1 },
    { ...state, unreadCount: 1.5 },
    { ...state, unreadCount: Infinity },
    { ...state, inCall: 'true' },
    { ...state, microphoneMuted: 1 },
  ])
    assert.throws(() => validPresence(invalid), /inválido/);
});

test('Windows session shutdown bypasses close to tray', () => {
  const { window, calls } = setup();
  window.emit('session-end');
  window.emit('close', { preventDefault: () => calls.push('prevent') });
  assert.deepEqual(calls, []);
});

test('other platforms never invoke Windows overlay APIs', () => {
  const { handler, event, calls } = setup('linux');
  handler(event, { unreadCount: 7, inCall: true, microphoneMuted: false });
  assert.equal(
    calls.some((call) => call[0] === 'overlay'),
    false,
  );
});
