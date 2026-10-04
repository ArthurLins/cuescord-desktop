import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkMacMedia } from '../scripts/check-mac-media.mjs';
const require = createRequire(import.meta.url);
const config = require('../electron-builder.cjs');
const audio = 'com.apple.security.device.audio-input';
const camera = 'com.apple.security.device.camera';

test('macOS app and capture helpers are signed with audio/camera entitlements and Hardened Runtime', async () => {
  assert.equal(config.mac.hardenedRuntime, true);
  for (const option of ['entitlements', 'entitlementsInherit']) {
    const source = await readFile(new URL(`../${config.mac[option]}`, import.meta.url), 'utf8');
    for (const key of [audio, camera])
      assert.ok(source.includes(`<key>${key}</key>\n    <true/>`), `${option} lacks ${key}`);
    assert.ok(!source.includes('com.apple.security.get-task-allow'));
  }
  for (const key of ['NSMicrophoneUsageDescription', 'NSCameraUsageDescription'])
    assert.ok(config.mac.extendInfo[key]?.trim());
});

test('bundle inspection refuses missing signed permissions, usage text or Hardened Runtime', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cuescord-mac-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helpers = path.join(root, 'Contents/Frameworks');
  await mkdir(path.join(helpers, 'Cuescord Helper.app'), { recursive: true });
  await mkdir(path.join(helpers, 'Cuescord Helper (Renderer).app'));
  const inspect = (failure) => (command, args, input) => {
    const target = args.at(-1);
    const isHelper = target.includes('Helper');
    const usage = {
      NSMicrophoneUsageDescription: 'Microphone for calls',
      NSCameraUsageDescription: 'Camera for calls',
    };
    if (command === 'plutil') {
      if (input) return { stdout: input };
      if (failure === 'usage') delete usage.NSMicrophoneUsageDescription;
      return { stdout: JSON.stringify(usage) };
    }
    if (args.includes('--entitlements'))
      return {
        stdout: JSON.stringify({
          [audio]: !(failure === 'audio' || (failure === 'helper' && isHelper)),
          [camera]: failure !== 'camera',
        }),
      };
    return { stderr: failure === 'runtime' ? 'flags=0x0(none)' : 'flags=0x10000(runtime)' };
  };
  assert.equal(await checkMacMedia(root, inspect()), 3);
  for (const failure of ['audio', 'helper', 'camera', 'usage', 'runtime'])
    await assert.rejects(checkMacMedia(root, inspect(failure)), /Missing|Hardened Runtime/);
});
