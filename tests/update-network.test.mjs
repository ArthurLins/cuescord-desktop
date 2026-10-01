import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fixture, bytes, policy } from './update-fixture.mjs';
const require = createRequire(import.meta.url);
const { downloadVerified, readJson } = require('../electron/update/network.cjs');

function requestFor(responses, visited = []) {
  return (url, _options, callback) => {
    visited.push(url.href);
    const next = responses.shift();
    assert.ok(next, 'unexpected request');
    const response = Readable.from(next.chunks || [bytes]);
    response.statusCode = next.status || 200;
    response.headers = next.headers || {};
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = (error) => request.emit('error', error);
    queueMicrotask(() => callback(response));
    return request;
  };
}

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cuescord-update-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('HTTPS download follows permitted CDN redirect and saves only exact signed bytes', async (t) => {
  const directory = await temporary(t);
  const artifact = fixture().manifest.artifacts[0];
  const destination = path.join(directory, artifact.file);
  const visited = [],
    progress = [];
  await downloadVerified(
    policy.releaseUrl('0.5.0', artifact.file),
    artifact,
    destination,
    new AbortController().signal,
    (value) => progress.push(value),
    requestFor(
      [
        {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/a?token=b' },
        },
        {
          chunks: [bytes.subarray(0, 3), bytes.subarray(3)],
          headers: { 'content-length': String(bytes.length) },
        },
      ],
      visited,
    ),
  );
  assert.deepEqual(await readFile(destination), bytes);
  assert.equal(visited.length, 2);
  assert.deepEqual(progress, [Math.floor((3 * 100) / bytes.length), 99]);
  assert.deepEqual(await readdir(directory), [artifact.file]);
});

for (const [label, response] of [
  ['wrong hash', { chunks: [Buffer.alloc(bytes.length)] }],
  ['truncated stream', { chunks: [bytes.subarray(0, 3)] }],
  ['oversized stream', { chunks: [bytes, bytes] }],
  ['wrong length header', { headers: { 'content-length': '1' } }],
  ['compressed body', { headers: { 'content-encoding': 'gzip' } }],
  ['HTTP failure', { status: 500 }],
  [
    'untrusted redirect',
    { status: 302, headers: { location: 'https://evil.example/installer.exe' } },
  ],
])
  test(`download rejects ${label} and removes partial file`, async (t) => {
    const directory = await temporary(t),
      artifact = fixture().manifest.artifacts[0];
    await assert.rejects(
      downloadVerified(
        policy.releaseUrl('0.5.0', artifact.file),
        artifact,
        path.join(directory, artifact.file),
        new AbortController().signal,
        () => {},
        requestFor([response]),
      ),
    );
    assert.deepEqual(await readdir(directory), []);
  });

test('cancellation removes partial download and exclusive creation preserves existing files', async (t) => {
  const directory = await temporary(t),
    artifact = fixture().manifest.artifacts[0];
  const destination = path.join(directory, artifact.file),
    operation = new AbortController();
  await assert.rejects(
    downloadVerified(
      policy.releaseUrl('0.5.0', artifact.file),
      artifact,
      destination,
      operation.signal,
      () => operation.abort(),
      requestFor([{ chunks: [bytes.subarray(0, 3), bytes.subarray(3)] }]),
    ),
  );
  assert.deepEqual(await readdir(directory), []);
  await writeFile(`${destination}.part`, 'keep this file');
  await assert.rejects(
    downloadVerified(
      policy.releaseUrl('0.5.0', artifact.file),
      artifact,
      destination,
      new AbortController().signal,
      () => {},
      requestFor([]),
    ),
    { code: 'EEXIST' },
  );
  assert.equal(await readFile(`${destination}.part`, 'utf8'), 'keep this file');
});

test('JSON responses are bounded, must parse and cannot redirect the API', async () => {
  assert.deepEqual(
    await readJson(
      policy.API_URL,
      'api',
      new AbortController().signal,
      requestFor([{ chunks: [Buffer.from('{"ok":true}')] }]),
    ),
    { ok: true },
  );
  await assert.rejects(
    readJson(
      policy.API_URL,
      'api',
      new AbortController().signal,
      requestFor([{ chunks: [Buffer.alloc(131073)] }]),
    ),
    /limite/,
  );
  await assert.rejects(
    readJson(
      policy.API_URL,
      'api',
      new AbortController().signal,
      requestFor([{ chunks: [Buffer.from('not JSON')] }]),
    ),
  );
  await assert.rejects(
    readJson(
      policy.API_URL,
      'api',
      new AbortController().signal,
      requestFor([{ status: 302, headers: { location: 'https://evil.example/api' } }]),
    ),
  );
});
