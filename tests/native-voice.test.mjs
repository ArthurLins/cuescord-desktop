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

test('voice controls preserve units and reject malformed or excessive input', () => {
  assert.equal(
    validCommand('configure', {
      muted: true,
      inputMode: 'push-to-talk',
      inputVolume: 200,
      volumes: { peer: 0.5 },
    }),
    true,
  );
  for (const data of [
    { muted: 'false' },
    { activationThreshold: NaN },
    { outputVolume: 201 },
    { inputMode: 'always' },
    { volumes: { peer: -1 } },
    { shell: 'cmd' },
  ])
    assert.equal(validCommand('configure', data), false);
  assert.equal(validCommand('exec', {}), false);
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
      const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send() {} });
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
        const opening = invoke('open');
        child.stdout.write(JSON.stringify({ type: 'ready', protocol: 1, media: ['voice'] }) + '\n');
        const ready = await opening;
        assert.equal(invoke('status').active, true);
        await assert.rejects(invoke('open'), /already active/);
        const pending = invoke('request', {
          sessionId: ready.sessionId,
          method: 'stats',
          data: {},
        });
        const rejected = assert.rejects(pending, /closed/);
        if (cause === 'crash') child.emit('exit', 1);
        if (cause === 'navigation')
          contents.emit('did-start-navigation', {}, frame.url, false, true);
        await rejected;
        assert.equal(child.killed, true);
        assert.equal(invoke('status').active, false);
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
test('IPC defaults off and rejects subframes, foreign origins and stale sessions', async () => {
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
