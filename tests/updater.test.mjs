import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fixture, bytes } from './update-fixture.mjs';
const require = createRequire(import.meta.url);
const { DesktopUpdater, markDownloadedFile } = require('../electron/update/updater.cjs');

async function setup(t, overrides = {}, data = fixture()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cuescord-updater-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [],
    state = [];
  const updater = new DesktopUpdater({
    version: '0.4.0',
    platform: 'win32',
    arch: 'x64',
    cacheRoot: path.join(directory, 'updates'),
    keys: data.keys,
    packaged: true,
    readJson: async (_url, kind) =>
      kind === 'api'
        ? { draft: false, prerelease: false, tag_name: `v${data.manifest.version}` }
        : data.envelope,
    downloadVerified: async (_url, _artifact, file, _signal, progress) => {
      calls.push('download');
      progress(50);
      await writeFile(file, bytes);
    },
    markFile: async () => calls.push('mark'),
    confirmInstall: async () => {
      calls.push('confirm');
      return true;
    },
    openInstaller: async (file) => {
      assert.deepEqual(await readFile(file), bytes);
      calls.push('open');
      return '';
    },
    onInstalled: () => calls.push('installed'),
    ...overrides,
  });
  updater.on('state', (value) => state.push(value.status));
  return { updater, calls, state, directory, data };
}

for (const [platform, arch] of [
  ['win32', 'x64'],
  ['linux', 'x64'],
  ['darwin', 'arm64'],
])
  test(`manual ${platform} flow: no startup check, signed download, native confirmation, installer`, async (t) => {
    const { updater, calls, state } = await setup(t, { platform, arch });
    assert.equal(updater.getState().status, 'idle');
    assert.deepEqual(calls, []);
    assert.equal((await updater.check()).status, 'available');
    assert.equal((await updater.download()).status, 'ready');
    assert.equal((await updater.install()).status, 'opened');
    await updater.install();
    assert.deepEqual(calls, ['download', 'mark', 'confirm', 'open', 'installed']);
    assert.deepEqual(state, [
      'checking',
      'available',
      'downloading',
      'downloading',
      'ready',
      'installing',
      'opened',
    ]);
  });

test('development build disables network and installation', async (t) => {
  const { updater, calls } = await setup(t, { packaged: false });
  await updater.check();
  await updater.download();
  await updater.install();
  assert.equal(updater.getState().status, 'disabled');
  assert.deepEqual(calls, []);
});

test('missing or untrusted signing keys cannot offer or download updates', async (t) => {
  for (const keys of [[], fixture().keys]) {
    const { updater, calls } = await setup(t, { keys });
    assert.equal((await updater.check()).status, 'error');
    await updater.download();
    await updater.install();
    assert.deepEqual(calls, []);
  }
});

test('current version and mismatched release tag are never offered', async (t) => {
  const current = await setup(t, {}, fixture('0.4.0'));
  assert.equal((await current.updater.check()).status, 'current');
  const data = fixture();
  const { updater } = await setup(
    t,
    {
      readJson: async (_url, kind) =>
        kind === 'api' ? { draft: false, prerelease: false, tag_name: 'v0.6.0' } : data.envelope,
    },
    data,
  );
  assert.equal((await updater.check()).status, 'error');
});

test('persisted signed watermark blocks older releases after restart', async (t) => {
  const data = fixture('0.6.0');
  const { updater } = await setup(t, {}, data);
  await updater.check();
  const replay = structuredClone(data.manifest);
  replay.version = '0.5.0';
  for (const artifact of replay.artifacts) artifact.file = artifact.file.replace('0.6.0', '0.5.0');
  const restarted = new DesktopUpdater({
    ...updater,
    readJson: async (_url, kind) =>
      kind === 'api'
        ? { draft: false, prerelease: false, tag_name: 'v0.5.0' }
        : data.signed(replay),
  });
  assert.equal((await restarted.check()).status, 'error');
  assert.match(restarted.getState().message, /anterior/);
  await writeFile(path.join(updater.cacheRoot, 'verified-release.json'), '{}');
  assert.equal((await updater.check()).status, 'error');
});

test('modified disk installer is rejected, cleaned and can be downloaded again', async (t) => {
  const { updater, calls } = await setup(t);
  await updater.check();
  await updater.download();
  await writeFile(updater.ready.file, Buffer.alloc(bytes.length));
  assert.equal((await updater.install()).status, 'error');
  assert.equal(calls.includes('open'), false);
  assert.deepEqual(await readdir(updater.cacheRoot), ['verified-release.json']);
  assert.equal((await updater.check()).status, 'available');
  assert.equal((await updater.download()).status, 'ready');
});

test('declining native confirmation keeps verified download ready', async (t) => {
  const { updater, calls } = await setup(t, { confirmInstall: async () => false });
  await updater.check();
  await updater.download();
  assert.equal((await updater.install()).status, 'ready');
  assert.equal(calls.includes('open'), false);
});

test('closing or navigating sender during confirmation revokes installation', async (t) => {
  let authorized = true;
  const { updater, calls } = await setup(t, {
    confirmInstall: async () => {
      authorized = false;
      return true;
    },
  });
  await updater.check();
  await updater.download();
  assert.equal((await updater.install(() => authorized)).status, 'error');
  assert.equal(calls.includes('open'), false);
});

test('tampering during confirmation and native installer launch errors fail closed', async (t) => {
  const { updater, calls } = await setup(t);
  await updater.check();
  await updater.download();
  updater.confirmInstall = async () => {
    await writeFile(updater.ready.file, 'tampered');
    return true;
  };
  assert.equal((await updater.install()).status, 'error');
  assert.equal(calls.includes('open'), false);
  await updater.check();
  await updater.download();
  updater.confirmInstall = async () => true;
  updater.openInstaller = async () => 'OS failed';
  assert.equal((await updater.install()).status, 'error');
  assert.equal(calls.includes('installed'), false);
});

test('cancelled downloads remove bytes and allow a new check', async (t) => {
  const { updater } = await setup(t);
  await updater.check();
  updater.downloadVerified = async (_url, _artifact, file, signal) => {
    await writeFile(file, bytes);
    updater.cancel();
    signal.throwIfAborted();
  };
  assert.equal((await updater.download()).status, 'idle');
  assert.deepEqual(await readdir(updater.cacheRoot), ['verified-release.json']);
  assert.equal((await updater.check()).status, 'available');
});

test('symlinked cache directories are rejected', async (t) => {
  const { updater, directory } = await setup(t);
  await symlink(directory, updater.cacheRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await updater.check()).status, 'error');
});

test(
  'Windows installer retains its Internet download mark',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { directory } = await setup(t);
    const file = path.join(directory, 'installer.exe');
    await writeFile(file, bytes);
    await markDownloadedFile(
      file,
      'https://github.com/ArthurLins/cuescord-desktop/releases/download/v0.5.0/Cuescord-0.5.0-win-x64.exe',
      'win32',
    );
    assert.match(await readFile(`${file}:Zone.Identifier`, 'utf8'), /ZoneId=3/);
    assert.deepEqual(await readFile(file), bytes);
  },
);
