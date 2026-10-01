import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { installCapture } = require('../electron/capture/capture.cjs');

function picker() {
  const handlers = new Map();
  const sent = [];
  const contents = new EventEmitter();
  const frame = { url: 'https://cuescord.test/voice/test', isDestroyed: () => false };
  Object.assign(contents, {
    mainFrame: frame,
    isDestroyed: () => false,
    send: (...args) => sent.push(args),
  });
  const owner = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
  });
  let request;
  let result;
  const grants = [];
  installCapture({
    session: {
      setDisplayMediaRequestHandler: (handler) => {
        request = handler;
      },
    },
    desktopCapturer: {
      getSources: async () => [
        { id: 'screen:1', name: 'Tela 1', thumbnail: { toDataURL: () => '' } },
      ],
    },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getWindow: () => owner,
    trustedUrl: 'https://cuescord.test',
    audio: { authorize: (_owner, grant) => grants.push(grant) },
  });
  request({ frame, videoRequested: true, userGesture: true, audioRequested: false }, (value) => {
    result = value;
  });
  const model = sent.find(([name]) => name === 'cuescord:capture:open')[1];
  const event = { sender: contents, senderFrame: frame };
  return { handlers, sent, model, event, grants, result: () => result };
}

test('selected desktop quality crosses the authorized capture boundary before acquisition finishes', async () => {
  const state = picker();
  assert.equal(state.model.defaultQuality, '1080p30');
  await state.handlers.get('cuescord:capture:sources')(state.event, state.model.id, 'screen');
  state.handlers.get('cuescord:capture:select')(state.event, state.model.id, 'screen:1', {
    kind: 'screen',
    quality: '1440p60',
  });
  const quality = state.sent.find(([name]) => name === 'cuescord:capture:quality')[1];
  assert.equal(quality.height, 1440);
  assert.equal(quality.frameRate, 60);
  assert.equal(quality.maxBitrate, 8_000_000);
  assert.equal(state.result().video.id, 'screen:1');
  assert.equal(state.grants[0].quality, quality);
});

test('unknown profiles and foreign frames cannot submit a capture selection', async () => {
  const state = picker();
  await state.handlers.get('cuescord:capture:sources')(state.event, state.model.id, 'screen');
  const select = state.handlers.get('cuescord:capture:select');
  assert.throws(
    () => select(state.event, state.model.id, 'screen:1', { kind: 'screen', quality: 'unlimited' }),
    /Qualidade/,
  );
  assert.throws(
    () =>
      select({ ...state.event, senderFrame: {} }, state.model.id, 'screen:1', {
        kind: 'screen',
        quality: '720p30',
      }),
    /autorizado/,
  );
  assert.equal(state.result(), undefined);
  state.handlers.get('cuescord:capture:cancel')(state.event, state.model.id);
  assert.deepEqual(state.result(), {});
  assert.equal(
    state.sent.some(([name]) => name === 'cuescord:capture:quality'),
    false,
  );
});
