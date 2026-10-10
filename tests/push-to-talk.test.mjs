import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { attachPushToTalkInput } from '../renderer/push-to-talk.ts';
const require = createRequire(import.meta.url);
const { installPushToTalk } = require('../electron/input/push-to-talk.cjs');
const { createWindowsInput } = require('../electron/input/windows-input.cjs');
const { validPushToTalkShortcut, mouseShortcut } = require('../renderer/push-to-talk-binding.cjs');

test('a late configuration reply or older button event cannot overwrite newer input', async () => {
  const target = Object.assign(new EventTarget(), {
    crypto: { randomUUID },
    document: { documentElement: { hasAttribute: () => false } },
  });
  let listener, pending, configuration;
  const changes = [],
    releases = [];
  const bridge = {
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    configure: (value) => {
      configuration = value;
      return new Promise((resolve) => {
        pending = resolve;
      });
    },
    release: async (id) => {
      releases.push(id);
    },
  };
  const stop = attachPushToTalkInput({
    target,
    shortcut: 'KeyV',
    bridge,
    onPressed: (value) => changes.push(value),
  });
  const id = configuration.id;
  listener({ id, global: true, available: true, pressed: true, sequence: 2 });
  pending({ id, global: true, available: true, pressed: false, sequence: 1 });
  await Promise.resolve();
  assert.deepEqual(changes, [false, true]);
  listener({ id, global: true, available: true, pressed: false, sequence: 3 });
  listener({ id, global: true, available: true, pressed: true, sequence: 2 });
  assert.deepEqual(changes, [false, true, false]);
  stop();
  assert.deepEqual(releases, [id]);
});

function fixture(options = {}) {
  const handlers = new Map(),
    events = [],
    transitions = [],
    timers = new Set();
  const frame = { url: 'https://cuescord.cuesc.net/app', isDestroyed: () => false };
  let destroyed = false,
    down = false;
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    isDestroyed: () => destroyed,
    send: (_channel, value) => events.push(value),
  });
  const app = new EventEmitter(),
    powerMonitor = new EventEmitter();
  const monitor = installPushToTalk({
    app,
    powerMonitor,
    trustedUrl: frame.url,
    ipcMain: {
      handle: (key, fn) => handlers.set(key, fn),
      removeHandler: (key) => handlers.delete(key),
    },
    window: { webContents: contents, isDestroyed: () => destroyed },
    platform: 'win32',
    createInput: () => ({ isDown: () => down }),
    onPressed: (value) => transitions.push(value),
    schedule: (fn, ms) => {
      assert.equal(ms, 8);
      timers.add(fn);
      return fn;
    },
    cancel: (fn) => timers.delete(fn),
    ...options,
  });
  const event = { sender: contents, senderFrame: frame };
  const invoke = (name, ...args) => handlers.get('cuescord:ptt:' + name)(event, ...args);
  const configure = (id = 'call', shortcut = 'KeyV', suspended = false) =>
    invoke('configure', { id, enabled: true, shortcut, suspended });
  const tick = (value) => {
    down = value;
    for (const fn of timers) fn();
  };
  return {
    monitor,
    app,
    contents,
    powerMonitor,
    events,
    transitions,
    timers,
    frame,
    handlers,
    event,
    invoke,
    configure,
    tick,
    destroy() {
      destroyed = true;
      contents.emit('destroyed');
    },
  };
}
test('global press and release survive blur/hide, repeated reads do not duplicate changes', () => {
  const f = fixture();
  assert.equal(f.configure().global, true);
  f.contents.emit('blur');
  f.contents.emit('hide');
  f.tick(true);
  f.tick(true);
  assert.equal(f.monitor.snapshot().pressed, true);
  f.tick(false);
  assert.deepEqual(f.transitions, [false, true, false]);
  f.destroy();
  assert.equal(f.timers.size, 0);
  assert.equal(f.handlers.size, 0);
});
test('rebind, recording, lock and sleep release held input and require a fresh press', () => {
  const f = fixture();
  f.configure();
  f.tick(true);
  f.configure('next', 'Mouse4');
  f.tick(true);
  assert.equal(f.monitor.snapshot().pressed, false);
  f.tick(false);
  f.tick(true);
  assert.equal(f.monitor.snapshot().pressed, true);
  f.configure('recording', 'Mouse4', true);
  assert.equal(f.monitor.snapshot().pressed, false);
  assert.equal(f.timers.size, 0);
  f.configure('restored', 'Mouse4');
  f.tick(true);
  assert.equal(f.monitor.snapshot().pressed, false);
  f.tick(false);
  f.tick(true);
  for (const [suspend, resume] of [
    ['lock-screen', 'unlock-screen'],
    ['suspend', 'resume'],
  ]) {
    f.powerMonitor.emit(suspend);
    assert.equal(f.monitor.snapshot().pressed, false);
    assert.equal(f.timers.size, 0);
    f.powerMonitor.emit(resume);
    f.tick(true);
    assert.equal(f.monitor.snapshot().pressed, false);
    f.tick(false);
    f.tick(true);
    assert.equal(f.monitor.snapshot().pressed, true);
  }
  f.destroy();
  assert.equal(f.powerMonitor.listenerCount('resume'), 0);
});
test('old owner release cannot disable a new call; navigation and renderer crash revoke polling', () => {
  for (const cause of ['navigation', 'crash', 'quit']) {
    const f = fixture();
    f.configure('old');
    f.configure('new');
    f.invoke('release', 'old');
    f.tick(true);
    assert.equal(f.monitor.snapshot().pressed, true);
    if (cause === 'navigation')
      f.contents.emit('did-start-navigation', {}, f.frame.url, false, true);
    if (cause === 'crash') f.contents.emit('render-process-gone');
    if (cause === 'quit') f.app.emit('before-quit');
    assert.equal(f.monitor.snapshot().global, false);
    assert.equal(f.monitor.snapshot().pressed, false);
    assert.equal(f.timers.size, 0);
    f.destroy();
  }
});

test('resuming from sleep cannot re-enable input while Windows is still locked', () => {
  const f = fixture();
  f.configure();
  f.tick(true);
  f.powerMonitor.emit('lock-screen');
  f.powerMonitor.emit('suspend');
  f.powerMonitor.emit('resume');
  assert.equal(f.timers.size, 0);
  f.tick(true);
  assert.equal(f.monitor.snapshot().pressed, false);
  f.powerMonitor.emit('unlock-screen');
  assert.equal(f.timers.size, 1);
  f.tick(true);
  assert.equal(f.monitor.snapshot().pressed, false);
  f.tick(false);
  f.tick(true);
  assert.equal(f.monitor.snapshot().pressed, true);
  f.destroy();
});
test('trusted top frame only; invalid keys rejected; unsupported platforms use focused fallback', () => {
  const f = fixture();
  assert.throws(
    () => f.handlers.get('cuescord:ptt:configure')({ ...f.event, senderFrame: { ...f.frame } }, {}),
    /Untrusted/,
  );
  f.frame.url = 'https://elsewhere.test';
  assert.throws(() => f.invoke('status'), /Untrusted/);
  f.frame.url = 'https://cuescord.cuesc.net/app';
  assert.throws(() => f.configure('bad', 'unknown'), /Invalid/);
  f.destroy();
  for (const options of [
    { platform: 'linux' },
    {
      createInput: () => {
        throw Error('unavailable');
      },
    },
  ]) {
    const other = fixture(options);
    assert.equal(other.configure().global, false);
    assert.equal(other.timers.size, 0);
    other.destroy();
  }
  for (let i = 0; i <= 4; i++) assert.equal(validPushToTalkShortcut(mouseShortcut(i)), true);
  assert.equal(mouseShortcut(5), undefined);
  assert.equal(validPushToTalkShortcut('__proto__'), false);
});
test('Windows adapter honors mouse swapping, physical keyboard layout and current high bit', () => {
  let swapped = 0,
    result = 0,
    requested,
    mapped;
  const functions = {
    GetAsyncKeyState: (key) => {
      requested = key;
      return result;
    },
    GetSystemMetrics: () => swapped,
    GetForegroundWindow: () => 99,
    GetWindowThreadProcessId: (hwnd) => {
      assert.equal(hwnd, 99);
      return 42;
    },
    GetKeyboardLayout: (id) => {
      assert.equal(id, 42);
      return 123;
    },
    MapVirtualKeyExW: (...args) => {
      mapped = args;
      return 0x56;
    },
  };
  const input = createWindowsInput({
    load: () => ({
      func: (declaration) => {
        const name = /__stdcall (\w+)\(/.exec(declaration)[1];
        return functions[name];
      },
    }),
  });
  assert.equal(input.isDown('Mouse0'), false);
  assert.equal(requested, 1);
  swapped = 1;
  input.isDown('Mouse0');
  assert.equal(requested, 2);
  input.isDown('Mouse2');
  assert.equal(requested, 1);
  input.isDown('Mouse4');
  assert.equal(requested, 6);
  result = 1;
  assert.equal(input.isDown('KeyV'), false);
  result = -32768;
  assert.equal(input.isDown('KeyV'), true);
  assert.deepEqual(mapped, [0x2f, 3, 123]);
  input.isDown('ControlRight');
  assert.equal(requested, 0xa3);
});
test(
  'real Windows input library loads and reads only a selected button',
  { skip: process.platform !== 'win32' },
  () => {
    const input = createWindowsInput();
    for (const code of ['KeyV', 'Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'ControlRight'])
      assert.equal(typeof input.isDown(code), 'boolean');
  },
);
