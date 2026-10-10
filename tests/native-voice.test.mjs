import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { validCommand, MAX_MESSAGE } = require('../electron/voice/protocol.cjs');
const { installNativeVoice } = require('../electron/voice/native-voice.cjs');

test(
  'main-process PTT release reaches audio without renderer and rejects delayed renderer presses',
  { skip: process.platform !== 'win32' },
  async () => {
    const app = Object.assign(new EventEmitter(), { isPackaged: false });
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      send() {},
      getBackgroundThrottling: () => true,
      setBackgroundThrottling() {},
    });
    const frame = { url: 'https://cuescord.cuesc.net/app', isDestroyed: () => false };
    contents.mainFrame = frame;
    const handlers = new Map();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill() {},
    });
    const controls = [];
    let reply = true;
    child.stdin.on('data', (chunk) => {
      const command = JSON.parse(chunk.toString());
      controls.push(command.data);
      if (reply)
        child.stdout.write(JSON.stringify({ type: 'response', id: command.id, data: {} }) + '\n');
    });
    let pressed = false;
    const voice = installNativeVoice({
      app,
      ipcMain: {
        handle: (key, fn) => handlers.set(key, fn),
        removeHandler: (key) => handlers.delete(key),
      },
      window: { webContents: contents, isDestroyed: () => false },
      trustedUrl: frame.url,
      filesExist: () => true,
      spawnHelper: () => child,
      getPushToTalk: () => ({ global: true, pressed }),
    });
    const invoke = (name, ...args) =>
      handlers.get('cuescord:voice:' + name)({ sender: contents, senderFrame: frame }, ...args);
    const opening = invoke('open');
    child.stdout.write(JSON.stringify({ type: 'ready', protocol: 1, media: ['voice'] }) + '\n');
    const ready = await opening;
    await invoke('request', {
      sessionId: ready.sessionId,
      method: 'configure',
      data: { inputMode: 'push-to-talk', ptt: true },
    });
    pressed = true;
    voice.setPushToTalk(true);
    pressed = false;
    voice.setPushToTalk(false);
    await invoke('request', {
      sessionId: ready.sessionId,
      method: 'configure',
      data: { ptt: true, inputVolume: 120 },
    });
    assert.deepEqual(
      controls.map((value) => value.ptt),
      [false, true, false, false],
    );
    assert.equal(controls.at(-1).inputVolume, 120);
    reply = false;
    const pending = Array.from({ length: 64 }, () =>
      invoke('request', { sessionId: ready.sessionId, method: 'stats', data: {} }),
    );
    const settled = Promise.allSettled(pending);
    voice.setPushToTalk(false);
    await Promise.resolve();
    assert.equal(invoke('status').active, false, 'a saturated queue cannot leave capture open');
    assert.equal(invoke('status').lastStopReason, 'ptt-release-failed');
    assert.equal(
      (await settled).every((value) => value.status === 'rejected'),
      true,
    );
    voice.stop();
    contents.emit('destroyed');
  },
);

test('voice controls preserve units and reject malformed or excessive input', () => {
  assert.equal(
    validCommand('configure', {
      muted: true,
      inputMode: 'push-to-talk',
      inputVolume: 200,
      noiseSuppressionMode: 'rnnoise',
      voiceBoost: true,
      volumes: { peer: 0.5 },
    }),
    true,
  );
  for (const data of [
    { muted: 'false' },
    { activationThreshold: NaN },
    { outputVolume: 201 },
    { inputMode: 'always' },
    { noiseSuppressionMode: 'unknown' },
    { noiseSuppressionMode: true },
    { voiceBoost: 'true' },
    { volumes: { peer: -1 } },
    { shell: 'cmd' },
  ])
    assert.equal(validCommand('configure', data), false);
  assert.equal(validCommand('exec', {}), false);
  for (const bitrate of [32000, 64000, 96000, 128000, 256000])
    assert.equal(validCommand('set-bitrate', { bitrate }), true);
  for (const bitrate of [0, 510000, NaN, '64000'])
    assert.equal(validCommand('set-bitrate', { bitrate }), false);
  assert.equal(validCommand('load', { blob: 'x'.repeat(MAX_MESSAGE) }), false);
});
test(
  'helper crash, navigation and command timeout revoke capture and reject pending work',
  { skip: process.platform !== 'win32' },
  async () => {
    for (const cause of ['crash', 'navigation', 'timeout']) {
      const temp = mkdtempSync(path.join(os.tmpdir(), 'cuescord-voice-life-'));
      writeFileSync(path.join(temp, 'native-voice.json'), JSON.stringify({ enabled: true }));
      const app = Object.assign(new EventEmitter(), { isPackaged: false, getPath: () => temp });
      let throttling = true;
      const contents = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        send() {},
        getBackgroundThrottling: () => throttling,
        setBackgroundThrottling: (value) => {
          throttling = value;
        },
      });
      const frame = { url: 'https://cuescord.cuesc.net/app', isDestroyed: () => false };
      contents.mainFrame = frame;
      const handlers = new Map();
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        killed: false,
        kill() {
          this.killed = true;
        },
      });
      const event = { sender: contents, senderFrame: frame };
      const invoke = (name, ...args) => handlers.get('cuescord:voice:' + name)(event, ...args);
      installNativeVoice({
        app,
        ipcMain: {
          handle: (name, handler) => handlers.set(name, handler),
          removeHandler: (name) => handlers.delete(name),
        },
        window: { isDestroyed: () => false, webContents: contents },
        trustedUrl: frame.url,
        filesExist: () => true,
        requestTimeoutMs: 20,
        spawnHelper: () => child,
      });
      try {
        assert.deepEqual(invoke('status').noiseSuppressionModes, ['native', 'rnnoise']);
        const opening = invoke('open');
        const modern = cause === 'timeout';
        child.stdout.write(
          JSON.stringify({
            type: 'ready',
            protocol: 1,
            media: ['voice'],
            ...(modern ? { noiseSuppressionModes: ['native', 'rnnoise'] } : {}),
          }) + '\n',
        );
        const ready = await opening;
        assert.deepEqual(ready.noiseSuppressionModes, modern ? ['native', 'rnnoise'] : ['native']);
        assert.deepEqual(invoke('status').noiseSuppressionModes, ready.noiseSuppressionModes);
        if (modern) {
          child.stdout.write(
            JSON.stringify({ type: 'processing-state', noiseProcessorStatus: 'fallback' }) + '\n',
          );
          assert.equal(child.killed, false, 'a filter fallback must keep capture alive');
        }
        assert.equal(invoke('status').active, true);
        assert.equal(throttling, false, 'native signaling stays responsive in the background');
        await assert.rejects(invoke('open'), /already active/);
        const pending = invoke('request', {
          sessionId: ready.sessionId,
          method: 'configure',
          data: { muted: true },
        });
        const rejected = assert.rejects(pending, /closed/);
        if (cause === 'crash') child.emit('exit', 1);
        if (cause === 'navigation')
          contents.emit('did-start-navigation', {}, frame.url, false, true);
        await rejected;
        assert.equal(child.killed, true);
        assert.equal(invoke('status').active, false);
        assert.equal(throttling, true, 'closing restores the previous background policy');
        assert.equal(
          invoke('status').lastStopReason,
          { crash: 'helper-exited', navigation: 'navigation', timeout: 'command-timeout' }[cause],
        );
        assert.equal(invoke('status').enabled, true);
        await assert.rejects(
          invoke('request', {
            sessionId: ready.sessionId,
            method: 'configure',
            data: { muted: false },
          }),
          /Invalid/,
        );
        contents.emit('destroyed');
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    }
  },
);
test('unavailable voice rejects capture, subframes, foreign origins and stale sessions', async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cuescord-native-voice-'));
  const app = Object.assign(new EventEmitter(), { isPackaged: false, getPath: () => temp });
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send() {} });
  const mainFrame = { url: 'https://cuescord.cuesc.net/app', isDestroyed: () => false };
  contents.mainFrame = mainFrame;
  const window = { isDestroyed: () => false, webContents: contents };
  const handlers = new Map();
  const ipcMain = {
    handle: (name, handler) => handlers.set(name, handler),
    removeHandler: (name) => handlers.delete(name),
  };
  const invoke = (name, event = { sender: contents, senderFrame: mainFrame }, ...args) =>
    handlers.get('cuescord:voice:' + name)(event, ...args);
  let spawned = 0;
  installNativeVoice({
    app,
    ipcMain,
    window,
    trustedUrl: mainFrame.url,
    filesExist: () => false,
    spawnHelper: () => {
      spawned++;
      throw new Error('Unexpected capture');
    },
  });
  try {
    assert.equal(invoke('status').enabled, false);
    assert.throws(
      () => invoke('status', { sender: contents, senderFrame: { ...mainFrame } }),
      /Untrusted/,
    );
    mainFrame.url = 'https://example.org';
    assert.throws(() => invoke('status'), /Untrusted/);
    mainFrame.url = 'https://cuescord.cuesc.net/app';
    await assert.rejects(invoke('open'), /disabled|unavailable/);
    await assert.rejects(
      invoke('request', undefined, { sessionId: 'stale', method: 'configure', data: {} }),
      /Invalid/,
    );
    assert.equal(spawned, 0);
    contents.emit('destroyed');
    assert.equal(handlers.size, 0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function nativeHarness(t, requestTimeoutMs = 1000) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cuescord-voice-default-'));
  // A saved opt-out from older releases must no longer disable Windows voice.
  writeFileSync(path.join(temp, 'native-voice.json'), JSON.stringify({ enabled: false }));
  const app = Object.assign(new EventEmitter(), { isPackaged: false, getPath: () => temp });
  let throttling = true;
  const events = [];
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (_channel, event) => events.push(event),
    getBackgroundThrottling: () => throttling,
    setBackgroundThrottling: (value) => {
      throttling = value;
    },
  });
  const frame = { url: 'https://cuescord.cuesc.net/app', isDestroyed: () => false };
  contents.mainFrame = frame;
  const handlers = new Map(),
    children = [];
  const { stop } = installNativeVoice({
    app,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler() {} },
    window: { isDestroyed: () => false, webContents: contents },
    trustedUrl: frame.url,
    filesExist: () => true,
    requestTimeoutMs,
    spawnHelper: () => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        killed: false,
        kill() {
          this.killed = true;
        },
      });
      children.push(child);
      return child;
    },
  });
  t.after(() => {
    stop();
    rmSync(temp, { recursive: true, force: true });
  });
  return {
    children,
    events,
    contents,
    frame,
    invoke: (name, ...args) =>
      handlers.get('cuescord:voice:' + name)({ sender: contents, senderFrame: frame }, ...args),
    ready: (child = children.at(-1)) =>
      child.stdout.write(JSON.stringify({ type: 'ready', protocol: 1, media: ['voice'] }) + '\n'),
  };
}

test(
  'Windows defaults to native voice without honoring old opt-out',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const h = nativeHarness(t);
    assert.equal(h.invoke('status').enabled, true);
    assert.equal(h.children.length, 0, 'a default does not itself capture audio');
    assert.throws(() => h.invoke('enabled', false), /automatically/);
    const opening = h.invoke('open');
    h.ready();
    const ready = await opening;
    assert.equal(ready.active, true);
    assert.equal(h.invoke('enabled', true).enabled, true);
  },
);

test(
  'late statistics and device replies do not revoke native voice',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const h = nativeHarness(t, 15);
    const opening = h.invoke('open');
    h.ready();
    const ready = await opening;
    for (const method of ['stats', 'devices']) {
      await assert.rejects(
        h.invoke('request', { sessionId: ready.sessionId, method, data: {} }),
        /timed out/,
      );
      assert.equal(h.invoke('status').active, true);
      assert.equal(h.children[0].killed, false);
    }
    assert.equal(h.events.length, 0);
    const request = h.invoke('request', {
      sessionId: ready.sessionId,
      method: 'configure',
      data: { muted: true },
    });
    h.children[0].stdout.write(JSON.stringify({ type: 'response', id: 1, data: {} }) + '\n');
    h.children[0].stdout.write(JSON.stringify({ type: 'response', id: 3, data: {} }) + '\n');
    await request;
    assert.equal(h.invoke('status').active, true);
  },
);

test(
  'idle device enumeration shares one probe and finishes before a call starts',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const h = nativeHarness(t);
    const devices = h.invoke('devices');
    const concurrent = h.invoke('devices');
    const opening = h.invoke('open');
    assert.equal(h.children.length, 1);
    h.ready();
    await new Promise((resolve) => setImmediate(resolve));
    const rows = [{ deviceId: 'default', kind: 'audioinput', label: 'Default' }];
    h.children[0].stdout.write(JSON.stringify({ type: 'response', id: 1, data: rows }) + '\n');
    assert.deepEqual(await devices, rows);
    assert.deepEqual(await concurrent, rows);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.children[0].killed, true);
    assert.equal(h.children.length, 2);
    h.ready();
    const ready = await opening;
    const liveDevices = h.invoke('devices');
    await new Promise((resolve) => setImmediate(resolve));
    h.children[1].stdout.write(JSON.stringify({ type: 'response', id: 2, data: rows }) + '\n');
    assert.deepEqual(await liveDevices, rows);
    assert.equal(h.children.length, 2);
    assert.equal(h.children[1].killed, false);
    assert.equal(h.invoke('status').active, true);
    assert.notEqual(
      h.events[0].sessionId,
      ready.sessionId,
      'the probe cannot close the call session',
    );
  },
);

test(
  'a call waiting for enumeration cannot reopen after navigation to another origin',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const h = nativeHarness(t);
    const probe = assert.rejects(h.invoke('devices'), /closed/);
    const call = assert.rejects(h.invoke('open'), /Untrusted/);
    h.frame.url = 'https://example.org';
    h.contents.emit('did-start-navigation', {}, h.frame.url, false, true);
    await Promise.all([probe, call]);
    assert.equal(h.children.length, 1);
    assert.equal(h.children[0].killed, true);
  },
);
