import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { installCapture } = require('../electron/capture/capture.cjs');

function picker({ platform, macOSRelease, audioRequested = false, sources } = {}) {
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
      getSources: async () =>
        sources ?? [{ id: 'screen:1', name: 'Tela 1', thumbnail: { toDataURL: () => '' } }],
    },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getWindow: () => owner,
    trustedUrl: 'https://cuescord.test',
    audio: { authorize: (_owner, grant) => grants.push(grant) },
    platform,
    macOSRelease,
  });
  request({ frame, videoRequested: true, userGesture: true, audioRequested }, (value) => {
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

test('macOS audio grants require supported OS, explicit selection and an audio request', async () => {
  for (const [release, requested, checked, expected] of [
    ['22.0.0', true, true, true],
    ['22.0.0', true, false, false],
    ['22.0.0', false, true, false],
    ['21.6.0', true, true, false],
  ]) {
    const state = picker({
      platform: 'darwin',
      macOSRelease: release,
      audioRequested: requested,
      sources: [{ id: 'window:77:0', name: 'Selected app', thumbnail: { toDataURL: () => '' } }],
    });
    await state.handlers.get('cuescord:capture:sources')(state.event, state.model.id, 'window');
    state.handlers.get('cuescord:capture:select')(state.event, state.model.id, 'window:77:0', {
      kind: 'window',
      quality: '1080p30',
      audio: checked,
    });
    assert.equal(state.grants[0].enabled, expected);
    assert.equal(state.grants[0].sourceId, 'window:77:0');
    assert.deepEqual(Object.keys(state.result()), ['video']);
    assert.equal(state.sent.find(([name]) => name === 'cuescord:capture:quality')[2], expected);
  }
});

test('macOS display identity comes from the enumerated source and unselected sources are refused', async () => {
  const state = picker({
    platform: 'darwin',
    macOSRelease: '22.0.0',
    audioRequested: true,
    sources: [
      {
        id: 'screen:1:0',
        display_id: '99',
        name: 'Selected screen',
        thumbnail: { toDataURL: () => '' },
      },
    ],
  });
  await state.handlers.get('cuescord:capture:sources')(state.event, state.model.id, 'screen');
  const select = state.handlers.get('cuescord:capture:select');
  assert.throws(
    () =>
      select(state.event, state.model.id, 'screen:2:0', {
        kind: 'screen',
        quality: '1080p30',
        audio: true,
      }),
    /inválida/,
  );
  select(state.event, state.model.id, 'screen:1:0', {
    kind: 'screen',
    quality: '1080p30',
    audio: true,
    displayId: '123',
  });
  assert.equal(state.grants[0].displayId, '99');
  assert.equal(state.grants[0].enabled, true);
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
