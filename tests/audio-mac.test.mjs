import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const {
  supportsMacAudio,
  captureArguments,
  createPacketParser,
  startMacAudio,
} = require('../electron/audio/audio-mac.cjs');

function packet(type, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header.writeUInt32LE(data.length + 1);
  header[4] = type;
  return Buffer.concat([header, data]);
}

test('macOS audio requires Ventura and source identifiers from a validated grant', () => {
  assert.equal(supportsMacAudio('darwin', '22.0.0'), true);
  assert.equal(supportsMacAudio('darwin', '21.6.0'), false);
  assert.equal(supportsMacAudio('win32', '23.0.0'), false);
  const grant = { kind: 'window', sourceId: 'window:12:0', ownPid: 123 };
  assert.deepEqual(captureArguments(grant), [
    '--capture',
    'window',
    'window:12:0',
    '123',
    '',
    'net.cuesc.cuescord',
  ]);
  for (const changed of [
    { ownPid: 0 },
    { sourceId: 'screen:12:0' },
    { sourceId: '--self-test' },
    { displayId: '12;echo' },
    { kind: 'process' },
  ])
    assert.throws(() => captureArguments({ ...grant, ...changed }), /inválida/);
});

test('native framing preserves quiet stereo PCM across every possible pipe boundary', () => {
  const pcm = Buffer.from([1, 0, 0xff, 0xff, 2, 0, 0xfe, 0xff]);
  const encoded = Buffer.concat([packet(0), packet(1, pcm), packet(1, pcm)]);
  for (let boundary = 1; boundary < encoded.length; boundary++) {
    const received = [];
    const parse = createPacketParser((type, data) => received.push([type, Buffer.from(data)]));
    parse(encoded.subarray(0, boundary));
    parse(encoded.subarray(boundary));
    assert.deepEqual(received, [
      [0, Buffer.alloc(0)],
      [1, pcm],
      [1, pcm],
    ]);
  }
  for (const invalid of [
    packet(1, Buffer.alloc(3)),
    packet(3),
    packet(0, Buffer.alloc(1)),
    packet(1, Buffer.alloc(8196)),
  ])
    assert.throws(() => createPacketParser(() => {})(invalid), /inválido/);
});

function nativeProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => child.emit('exit', 0);
  child.kill = () => child.emit('exit', 0);
  return child;
}

test('capture waits for native permission, stops on revocation and never leaks data after stop', async () => {
  const child = nativeProcess();
  const received = [],
    failures = [];
  let options;
  const capture = startMacAudio(
    { kind: 'window', sourceId: 'window:12:0', ownPid: 123 },
    (_lane, data) => received.push(Buffer.from(data)),
    (error) => failures.push(error),
    (_path, _args, settings) => {
      options = settings;
      return child;
    },
  );
  assert.equal(options.shell, false);
  child.stdout.emit('data', packet(1, Buffer.alloc(4)));
  assert.equal(received.length, 0);
  child.stdout.emit('data', packet(0));
  await capture.ready;
  const pcm = Buffer.from([1, 0, 2, 0]);
  child.stdout.emit('data', packet(1, pcm));
  assert.deepEqual(received, [pcm]);
  capture.stop();
  child.stdout.emit('data', packet(1, pcm));
  assert.deepEqual(received, [pcm]);
  assert.deepEqual(failures, []);
});

test('permission failure rejects startup and an unexpected native exit terminates live capture', async () => {
  for (const live of [false, true]) {
    const child = nativeProcess();
    const failures = [];
    const capture = startMacAudio(
      { kind: 'screen', sourceId: 'screen:1:0', displayId: '1', ownPid: 123 },
      () => assert.fail('No PCM expected'),
      (error) => failures.push(error),
      () => child,
    );
    if (live) {
      child.stdout.emit('data', packet(0));
      await capture.ready;
    }
    child.stdout.emit('data', packet(2, Buffer.from([2])));
    if (!live) await assert.rejects(capture.ready, /permissão/);
    assert.equal(failures.length, live ? 1 : 0);
  }
});
