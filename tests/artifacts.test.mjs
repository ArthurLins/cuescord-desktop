import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectInstaller } from '../scripts/artifacts.mjs';
import { signUpdate } from '../scripts/sign-update.mjs';
import { bytes, fixture, policy } from './update-fixture.mjs';
const require = createRequire(import.meta.url);
const { createInstallerZip } = require('../electron/update/archive.cjs');
const { DesktopUpdater } = require('../electron/update/updater.cjs');
const legacy = require('./fixtures/update-policy-v1.cjs');

test('matrix packaging -> provenance -> signing -> old/new clients, including skipped releases', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cuescord-artifacts-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = fixture('0.6.0');
  await mkdir(path.join(root, 'release'));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      version: '0.6.0',
      devDependencies: { electron: 'fixture', 'electron-builder': 'fixture' },
      packageManager: 'pnpm@10.32.1',
    }),
  );
  for (const a of data.manifest.artifacts) {
    await writeFile(path.join(root, 'release', a.file), bytes);
    const info = await collectInstaller({
      root,
      platform: a.platform,
      arch: a.arch,
      env: { GITHUB_SHA: 'expected' },
    });
    const sums = await readFile(
      path.join(root, 'artifacts', `sha256sums-${a.platform}-${a.arch}.txt`),
      'utf8',
    );
    for (const file of [a.file, info.archive.file]) {
      const content = await readFile(path.join(root, 'artifacts', file));
      assert.ok(sums.includes(`${createHash('sha256').update(content).digest('hex')}  ${file}\n`));
    }
  }
  const options = {
    directory: path.join(root, 'artifacts'),
    version: '0.6.0',
    tag: 'v0.6.0',
    commit: 'expected',
    privateKey: data.privateKey,
    keys: data.keys,
  };
  const envelope = await signUpdate(options);
  const manifest = policy.verifyManifest(envelope, data.keys);
  assert.equal(legacy.verifyManifest(envelope, data.keys).version, '0.6.0');
  for (const a of manifest.artifacts) {
    const selected = legacy.selectArtifact(manifest, '0.4.2', '0.4.2', a.platform, a.arch);
    assert.deepEqual(await readFile(path.join(root, 'artifacts', selected.file)), bytes);
    const requested = [];
    const updater = new DesktopUpdater({
      version: '0.4.3',
      platform: a.platform,
      arch: a.arch,
      cacheRoot: path.join(root, `updates-${a.platform}`),
      keys: data.keys,
      packaged: true,
      readJson: async (_url, kind) =>
        kind === 'api' ? { draft: false, prerelease: false, tag_name: 'v0.6.0' } : envelope,
      downloadVerified: async (url, artifact, file, _signal, progress) => {
        requested.push(url);
        await writeFile(file, await readFile(path.join(root, 'artifacts', artifact.file)));
        progress(99);
      },
      markFile: async () => {},
      confirmInstall: async () => true,
      openInstaller: async (file) => {
        assert.deepEqual(await readFile(file), bytes);
        return '';
      },
    });
    assert.equal((await updater.check()).status, 'available');
    assert.equal((await updater.download()).status, 'ready');
    assert.equal((await updater.install()).status, 'opened');
    assert.deepEqual(requested, [policy.releaseUrl('0.6.0', a.archive.file)]);
  }
  // A self-consistent ZIP hash/provenance cannot authorize the wrong inner binary.
  const a = manifest.artifacts[0];
  const zipFile = path.join(root, 'artifacts', a.archive.file);
  await unlink(zipFile);
  const evil = path.join(root, 'evil.exe');
  await writeFile(evil, Buffer.alloc(bytes.length, 1));
  await createInstallerZip(evil, zipFile, a.file);
  const infoFile = path.join(root, 'artifacts', 'build-info-win32-x64.json');
  const info = JSON.parse(await readFile(infoFile, 'utf8'));
  info.archive.sha256 = createHash('sha256')
    .update(await readFile(zipFile))
    .digest('hex');
  await writeFile(infoFile, JSON.stringify(info));
  await assert.rejects(signUpdate(options), /integridade/);
  await unlink(zipFile);
  await assert.rejects(signUpdate(options), { code: 'ENOENT' });
});
