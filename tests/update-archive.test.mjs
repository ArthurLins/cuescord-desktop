import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { bytes, zipFixture } from './update-fixture.mjs';
const require = createRequire(import.meta.url);
const { createInstallerZip, extractInstallerZip } = require('../electron/update/archive.cjs');

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cuescord-archive-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = await zipFixture();
  const artifact = data.manifest.artifacts[0];
  const source = path.join(directory, artifact.archive.file);
  const destination = path.join(directory, artifact.file);
  const zip = data.files.get(artifact.archive.file);
  await writeFile(source, zip);
  return { directory, source, destination, zip, artifact };
}

test('ZIP is deterministic, contains the exact installer, and never overwrites a file', async (t) => {
  const { directory, source, destination, zip, artifact } = await setup(t);
  await extractInstallerZip(source, destination, artifact);
  assert.deepEqual(await readFile(destination), bytes);
  await assert.rejects(extractInstallerZip(source, destination, artifact), { code: 'EEXIST' });
  const duplicate = path.join(directory, 'duplicate.zip');
  await createInstallerZip(destination, duplicate, artifact.file);
  assert.deepEqual(await readFile(duplicate), zip);
  await assert.rejects(createInstallerZip(destination, duplicate, artifact.file), {
    code: 'EEXIST',
  });
});

test('ZIP rejects paths, compression, encryption, links, extra entries, ZIP64 and inconsistent headers', async (t) => {
  const { directory, source, destination, zip, artifact } = await setup(t);
  const central = 30 + Buffer.byteLength(artifact.file) + artifact.size;
  const edits = [
    (b) => {
      b[30] = 47;
    }, // absolute path
    (b) => {
      b.write('../', 30);
    }, // traversal
    (b) => {
      b[6] |= 1;
    }, // encryption
    (b) => {
      b[6] |= 8;
    }, // data descriptor
    (b) => {
      b.writeUInt16LE(8, 8);
    }, // deflate / expansion bomb
    (b) => {
      b.writeUInt32LE(0xffffffff, 22);
    }, // ZIP64 / unbounded size
    (b) => {
      b.writeUInt16LE(1, 28);
    }, // extra field
    (b) => {
      b.writeUInt32LE((0o120777 * 65536) >>> 0, central + 38);
    }, // symlink
    (b) => {
      b.writeUInt16LE(2, b.length - 12);
    }, // multiple entries
    (b) => {
      b.writeUInt32LE(1, central + 42);
    }, // different local offset
    (b) => {
      b.writeUInt16LE(1, b.length - 18);
    }, // multi-disk
    (b) => {
      b.writeUInt16LE(1, b.length - 2);
    }, // comment
    (b) => {
      b[central + 46] ^= 1;
    }, // different central filename
    (b) => {
      b[14] ^= 1;
      b[central + 16] ^= 1;
    }, // matched but incorrect CRC
  ];
  for (const edit of edits) {
    const altered = Buffer.from(zip);
    edit(altered);
    await writeFile(source, altered);
    await assert.rejects(extractInstallerZip(source, destination, artifact));
    assert.deepEqual(await readdir(directory), [artifact.archive.file]);
  }
  for (const altered of [
    zip.subarray(0, 15),
    zip.subarray(0, -1),
    Buffer.concat([zip, Buffer.from('trailing')]),
  ]) {
    await writeFile(source, altered);
    await assert.rejects(extractInstallerZip(source, destination, artifact));
  }
});

test('valid ZIP with the wrong inner SHA-512 fails and removes the extracted file', async (t) => {
  const { source, destination, artifact } = await setup(t);
  await assert.rejects(
    extractInstallerZip(source, destination, {
      ...artifact,
      sha512: createHash('sha512').update('wrong').digest('hex'),
    }),
    /integridade/,
  );
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
});

test('cancellation during extraction removes partial output', async (t) => {
  const { source, destination, artifact } = await setup(t);
  let checks = 0;
  const controller = new AbortController();
  const signal = {
    throwIfAborted() {
      if (++checks === 4) controller.abort();
      controller.signal.throwIfAborted();
    },
  };
  await assert.rejects(extractInstallerZip(source, destination, artifact, signal), {
    name: 'AbortError',
  });
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
});

test('multi-chunk installer streams through ZIP creation and extraction with exact integrity', async (t) => {
  const { directory, artifact } = await setup(t);
  const content = Buffer.alloc(1024 * 1024 + 37);
  for (let index = 0; index < content.length; index++) content[index] = index % 251;
  const source = path.join(directory, 'source.exe');
  const zip = path.join(directory, 'large.zip');
  const destination = path.join(directory, 'output.exe');
  await writeFile(source, content);
  await createInstallerZip(source, zip, artifact.file);
  await extractInstallerZip(zip, destination, {
    ...artifact,
    size: content.length,
    sha512: createHash('sha512').update(content).digest('hex'),
  });
  assert.deepEqual(await readFile(destination), content);
});
