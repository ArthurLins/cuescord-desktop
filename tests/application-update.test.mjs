import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applicationFixture, policy, bytes } from './update-fixture.mjs';
const require = createRequire(import.meta.url);
const { DesktopUpdater, markDownloadedFile } = require('../electron/update/updater.cjs');
const {
  prepareApplication,
  discardApplication,
} = require('../electron/update/windows-application.cjs');
const { extractApplicationBundle, validateFiles } = require('../electron/update/application.cjs');

async function setup(t, options = {}) {
  const data = await applicationFixture();
  const root = await mkdtemp(path.join(tmpdir(), 'cuescord-application-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const updater = new DesktopUpdater({
    version: '0.4.9',
    platform: 'win32',
    arch: 'x64',
    cacheRoot: path.join(root, 'updates'),
    keys: data.keys,
    packaged: true,
    readJson: async (_url, kind) =>
      kind === 'api' ? { draft: false, prerelease: false, tag_name: 'v0.5.0' } : data.envelope,
    downloadVerified: async (_url, artifact, file) => {
      calls.push(artifact.file);
      await writeFile(file, data.files.get(artifact.file));
    },
    markFile: async (file) => calls.push(`mark:${path.basename(file)}`),
    confirmInstall: async (_version, _platform, application) => {
      assert.equal(application, true);
      return true;
    },
    openInstaller: async () => {
      throw new Error('Application updates must never open an installer');
    },
    applyApplication: async (ready, authorized) => {
      assert.equal(authorized(), true);
      assert.deepEqual(
        await readFile(path.join(ready.applicationDirectory, 'Cuescord.exe')),
        bytes,
      );
      calls.push('apply');
    },
    onInstalled: () => calls.push('quit'),
    ...options,
  });
  return { data, updater, calls, root };
}

test('Windows prefers the signed full application, confirms and hands off without an installer', async (t) => {
  const { data, updater, calls } = await setup(t);
  assert.equal((await updater.check()).applicationUpdate, true);
  assert.equal((await updater.download()).applicationUpdate, true);
  assert.equal((await updater.install()).status, 'restarting');
  assert.equal(calls[0], policy.applicationName('0.5.0'));
  assert.ok(calls.includes('mark:Cuescord.exe'));
  assert.ok(calls.includes('mark:app.asar'));
  assert.deepEqual(calls.slice(-2), ['apply', 'quit']);
  assert.equal(
    require('./fixtures/update-policy-v1.cjs').verifyManifest(data.envelope, data.keys).version,
    '0.5.0',
  );
});

test('application tampering never falls back to a legacy installer', async (t) => {
  for (const target of ['archive', 'executable', 'extra']) {
    const { updater, calls } = await setup(t);
    await updater.check();
    await updater.download();
    const file =
      target === 'archive'
        ? updater.ready.archive
        : path.join(
            updater.ready.applicationDirectory,
            target === 'extra' ? 'extra.dll' : 'Cuescord.exe',
          );
    await writeFile(file, 'changed');
    assert.equal((await updater.install()).status, 'error');
    assert.ok(!calls.includes('apply'));
    assert.deepEqual(await readdir(updater.cacheRoot), ['verified-release.json']);
  }
});

test('declining full application restart retains the verified package', async (t) => {
  const { updater, calls } = await setup(t, { confirmInstall: async () => false });
  await updater.check();
  await updater.download();
  const state = await updater.install();
  assert.equal(state.status, 'ready');
  assert.equal(state.applicationUpdate, true);
  assert.ok(!calls.includes('apply'));
});

test('application download cancellation removes all staged files', async (t) => {
  const { updater } = await setup(t);
  await updater.check();
  const download = updater.downloadVerified;
  updater.downloadVerified = async (...args) => {
    await download(...args);
    updater.cancel();
  };
  assert.equal((await updater.download()).status, 'idle');
  assert.deepEqual(await readdir(updater.cacheRoot), ['verified-release.json']);
});

test(
  'Windows Internet marks survive full package extraction and staging',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { updater, root } = await setup(t, { markFile: markDownloadedFile });
    await updater.check();
    await updater.download();
    const install = path.join(root, 'installed');
    await mkdir(path.join(install, 'resources/updater'), { recursive: true });
    await writeFile(
      path.join(install, 'resources/updater/cuescord-update.exe'),
      'installed helper',
    );
    const prepared = await prepareApplication({
      ready: updater.ready,
      executable: path.join(install, 'Cuescord.exe'),
      cacheRoot: updater.cacheRoot,
    });
    t.after(() => discardApplication(prepared));
    for (const file of [
      updater.ready.archive,
      path.join(updater.ready.applicationDirectory, 'Cuescord.exe'),
      path.join(prepared.stage, 'Cuescord.exe'),
    ])
      assert.match(await readFile(`${file}:Zone.Identifier`, 'utf8'), /ZoneId=3/);
  },
);

test('signed application metadata is constrained to Windows and its fixed format/name', async () => {
  const data = await applicationFixture();
  for (const change of [{ format: 'zip' }, { file: '../evil.exe' }, { size: 3 * 1024 ** 3 }]) {
    const manifest = structuredClone(data.manifest);
    Object.assign(manifest.artifacts[0].application, change);
    assert.throws(() => policy.verifyManifest(data.signed(manifest), data.keys), /inválido/);
  }
  const manifest = structuredClone(data.manifest);
  manifest.artifacts[1].application = manifest.artifacts[0].application;
  assert.throws(() => policy.verifyManifest(data.signed(manifest), data.keys), /inválido/);
});

test('bundle rejects traversal, Windows aliases, duplicate names, extra bytes and inner tampering', async (t) => {
  const { data, root } = await setup(t);
  const source = data.files.get(policy.applicationName('0.5.0'));
  const length = source.readUInt32LE(8);
  const index = JSON.parse(source.subarray(12, 12 + length));
  for (const name of [
    '../evil',
    'C:/evil',
    'a\\b',
    'a:stream',
    'CON.txt',
    'a./b',
    'a /b',
    '/evil',
  ]) {
    const files = structuredClone(index.files);
    files[0].path = name;
    assert.throws(() => validateFiles(files), /inválido/);
  }
  assert.throws(
    () => validateFiles([...index.files, { ...index.files[0], path: 'cuescord.exe' }]),
    /duplicado/,
  );
  for (const [i, input] of [
    Buffer.concat([source, Buffer.from('extra')]),
    Buffer.from(source),
  ].entries()) {
    if (i) input[input.length - 1] ^= 1;
    const bundle = path.join(root, `invalid-${i}.cua`);
    await writeFile(bundle, input);
    await assert.rejects(
      extractApplicationBundle(bundle, path.join(root, `output-${i}`), '0.5.0'),
      /inválido|integridade/,
    );
  }
});
