import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { signUpdate } from '../scripts/sign-update.mjs';
import { fixture, bytes, policy } from './update-fixture.mjs';

test('release signer binds all three installers to version, commit and trusted public key', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cuescord-signer-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = fixture();
  for (const artifact of data.manifest.artifacts) {
    await writeFile(path.join(directory, artifact.file), bytes);
    await writeFile(
      path.join(directory, `build-info-${artifact.platform}-${artifact.arch}.json`),
      JSON.stringify({
        version: '0.5.0',
        platform: artifact.platform,
        architecture: artifact.arch,
        installer: artifact.file,
        commit: 'expected',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
  }
  const options = {
    directory,
    version: '0.5.0',
    tag: 'v0.5.0',
    commit: 'expected',
    privateKey: data.privateKey,
    keys: data.keys,
  };
  assert.deepEqual(policy.verifyManifest(await signUpdate(options), data.keys), data.manifest);
  await assert.rejects(signUpdate({ ...options, privateKey: '' }), /UPDATE_SIGNING_PRIVATE_KEY/);
  await assert.rejects(signUpdate({ ...options, keys: fixture().keys }), /does not match/);
  await assert.rejects(signUpdate({ ...options, tag: 'v0.6.0' }), /tag/);
  await assert.rejects(signUpdate({ ...options, commit: 'wrong' }), /provenance/);
  await writeFile(path.join(directory, data.manifest.artifacts[0].file), 'tampered');
  await assert.rejects(signUpdate(options), /differs/);
});
