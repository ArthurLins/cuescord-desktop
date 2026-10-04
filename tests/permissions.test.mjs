import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { installPermissions } = require('../electron/security/permissions.cjs');
const origin = 'https://cuescord.cuesc.net';

function fixture(platform = 'darwin', statuses = {}) {
  const prompts = [];
  const contents = { getURL: () => origin, isDestroyed: () => false };
  const session = {
    setPermissionCheckHandler(handler) {
      this.check = handler;
    },
    setPermissionRequestHandler(handler) {
      this.request = handler;
    },
  };
  const preferences = {
    getMediaAccessStatus: (kind) => statuses[kind] || 'not-determined',
    askForMediaAccess: async (kind) => {
      prompts.push(kind);
      return true;
    },
  };
  installPermissions(session, origin, (candidate) => candidate === contents, preferences, platform);
  return {
    session,
    contents,
    preferences,
    prompts,
    request: (details = {}, candidate = contents) =>
      new Promise((resolve) =>
        session.request(candidate, 'media', resolve, {
          requestingUrl: origin,
          isMainFrame: true,
          ...details,
        }),
      ),
  };
}

test('macOS voice requests only the microphone, even when the camera was denied', async () => {
  const f = fixture('darwin', { camera: 'denied' });
  assert.equal(await f.request({ mediaTypes: ['audio'] }), true);
  assert.deepEqual(f.prompts, ['microphone']);
});

test('macOS reuses granted consent, but never overrides denied/restricted consent', async () => {
  for (const status of ['granted', 'denied', 'restricted', 'unknown']) {
    const f = fixture('darwin', { microphone: status });
    assert.equal(await f.request({ mediaTypes: ['audio'] }), status === 'granted');
    assert.deepEqual(f.prompts, []);
  }
});

test('macOS checks the specific device and refuses ambiguous media checks', () => {
  const f = fixture('darwin', { microphone: 'granted', camera: 'denied' });
  const check = (details) => f.session.check(f.contents, 'media', origin, details);
  assert.equal(check({ mediaType: 'audio' }), true);
  assert.equal(check({ mediaType: 'video' }), false);
  assert.equal(check({ mediaType: 'unknown' }), false);
  assert.equal(check({}), false);
});

test('macOS display capture reaches the picker without requesting camera or microphone consent', async () => {
  const f = fixture('darwin', { microphone: 'denied', camera: 'denied' });
  f.preferences.getMediaAccessStatus = () => {
    throw new Error('Display capture must not query camera/microphone consent');
  };
  assert.equal(await f.request({ mediaTypes: [], securityOrigin: origin }), true);
  assert.deepEqual(f.prompts, []);
});

test('empty macOS media requests require the trusted security origin and an explicit main frame', async () => {
  const f = fixture();
  for (const details of [
    {},
    { securityOrigin: 'https://other.example' },
    { securityOrigin: 'file:///recovery/ui/index.html' },
    { securityOrigin: origin, isMainFrame: false },
    { securityOrigin: origin, isMainFrame: undefined },
    { securityOrigin: origin, requestingUrl: 'https://other.example' },
  ])
    assert.equal(await f.request({ mediaTypes: [], ...details }), false);
  assert.equal(
    await f.request({ mediaTypes: [], securityOrigin: origin }, { ...f.contents }),
    false,
  );
  assert.deepEqual(f.prompts, []);
});

test('missing, empty and unrecognized macOS media requests never prompt for unrelated devices', async () => {
  const f = fixture();
  for (const mediaTypes of [undefined, [], ['unknown'], ['audio', 'screen']])
    assert.equal(await f.request({ mediaTypes }), false);
  assert.deepEqual(f.prompts, []);
});

test('macOS prompts sequentially, once per requested device', async () => {
  const f = fixture();
  let answer;
  f.preferences.askForMediaAccess = (kind) => {
    f.prompts.push(kind);
    return new Promise((resolve) => {
      answer = resolve;
    });
  };
  const request = f.request({ mediaTypes: ['audio', 'video', 'audio'] });
  assert.deepEqual(f.prompts, ['microphone']);
  answer(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.prompts, ['microphone', 'camera']);
  answer(true);
  assert.equal(await request, true);
});

test('denial and OS failures finish the request without granting access', async () => {
  for (const reply of [
    async () => false,
    async () => {
      throw new Error('OS failure');
    },
  ]) {
    const f = fixture();
    f.preferences.askForMediaAccess = reply;
    assert.equal(await f.request({ mediaTypes: ['audio', 'video'] }), false);
  }
});

test('navigation or destruction during the OS prompt revokes consent and cancels later prompts', async () => {
  for (const revoke of [
    (contents) => {
      contents.getURL = () => 'https://other.example';
    },
    (contents) => {
      contents.isDestroyed = () => true;
    },
  ]) {
    const f = fixture();
    f.preferences.askForMediaAccess = async (kind) => {
      f.prompts.push(kind);
      revoke(f.contents);
      return true;
    };
    assert.equal(await f.request({ mediaTypes: ['audio', 'video'] }), false);
    assert.deepEqual(f.prompts, ['microphone']);
  }
});

test('Linux and Windows authorize trusted audio without calling macOS APIs', async () => {
  for (const platform of ['linux', 'win32']) {
    const f = fixture(platform);
    f.preferences.getMediaAccessStatus = () => {
      throw new Error('macOS API');
    };
    f.preferences.askForMediaAccess = async () => {
      throw new Error('macOS API');
    };
    assert.equal(f.session.check(f.contents, 'media', origin, { mediaType: 'audio' }), true);
    assert.equal(await f.request({ mediaTypes: ['audio'] }), true);
  }
});

test('every platform rejects other windows, origins, subframes and local recovery', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const f = fixture(platform);
    assert.equal(await f.request({ mediaTypes: ['audio'] }, null), false);
    assert.equal(await f.request({ mediaTypes: ['audio'] }, { ...f.contents }), false);
    for (const details of [
      { isMainFrame: false },
      { requestingUrl: 'https://other.example' },
      { requestingUrl: 'file:///recovery/ui/index.html' },
      { embeddingOrigin: 'https://other.example' },
    ])
      assert.equal(await f.request({ mediaTypes: ['audio'], ...details }), false);
    assert.equal(f.session.check(f.contents, 'media', 'https://other.example', {}), false);
    assert.equal(f.session.check(f.contents, 'geolocation', origin, {}), false);
    assert.deepEqual(f.prompts, []);
  }
});
