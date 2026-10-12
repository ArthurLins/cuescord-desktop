import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fixture } from './update-fixture.mjs';
const { DesktopUpdater } = createRequire(import.meta.url)('../electron/update/updater.cjs');

function inMemoryUpdater(overrides = {}) {
  const data = fixture();
  const calls = [];
  let watermark;
  const staged = { destination: 'download', directory: 'staging', file: 'installer' };
  const storage = {
    ensure: async () => calls.push('ensure'),
    readWatermark: async () => watermark,
    remember: async (envelope) => {
      watermark = envelope;
    },
    createDownload: async () => staged,
    prepare: async () => calls.push('prepare'),
    verifyReady: async () => calls.push('verify-ready'),
    discard: async (value) => {
      assert.equal(value, staged);
      calls.push('discard');
    },
  };
  const updater = new DesktopUpdater({
    version: '0.4.0',
    platform: 'win32',
    arch: 'x64',
    keys: data.keys,
    packaged: true,
    storage,
    readJson: async (_url, kind) =>
      kind === 'api' ? { draft: false, prerelease: false, tag_name: 'v0.5.0' } : data.envelope,
    downloadVerified: async () => calls.push('download'),
    confirmInstall: async () => {
      calls.push('confirm');
      return true;
    },
    openInstaller: async () => {
      calls.push('open');
      return '';
    },
    ...overrides,
  });
  return { updater, calls, staged };
}

test('update orchestration uses ports and verifies staging after user confirmation', async () => {
  const { updater, calls } = inMemoryUpdater();
  assert.equal((await updater.check()).status, 'available');
  assert.equal((await updater.download()).status, 'ready');
  assert.equal((await updater.install()).status, 'opened');
  assert.deepEqual(calls, ['ensure', 'download', 'prepare', 'confirm', 'verify-ready', 'open']);
});

test('a cancelled download discards only its own staging without preparing or installing it', async () => {
  const { updater, calls } = inMemoryUpdater({
    downloadVerified: async (_url, _artifact, _destination, signal) => {
      updater.cancel();
      signal.throwIfAborted();
    },
  });
  await updater.check();
  assert.equal((await updater.download()).status, 'idle');
  await updater.install();
  assert.deepEqual(calls, ['ensure', 'discard']);
});
