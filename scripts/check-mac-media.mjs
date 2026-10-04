import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function run(command, args, input) {
  const result = spawnSync(command, args, { encoding: 'utf8', input });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result;
}

export async function checkMacMedia(bundle, execute = run) {
  const info = JSON.parse(
    execute('plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')])
      .stdout,
  );
  for (const key of [
    'NSMicrophoneUsageDescription',
    'NSCameraUsageDescription',
    'NSAudioCaptureUsageDescription',
  ])
    assert.ok(typeof info[key] === 'string' && info[key].trim(), `Missing ${key} in ${bundle}`);
  const frameworks = path.join(bundle, 'Contents/Frameworks');
  const helpers = (await readdir(frameworks)).filter((name) =>
    / Helper(?: \([^)]+\))?\.app$/.test(name),
  );
  assert.ok(helpers.length, 'No Electron capture helpers found');
  for (const target of [bundle, ...helpers.map((name) => path.join(frameworks, name))]) {
    const signature = execute('codesign', ['-dv', '--verbose=4', target]);
    assert.match(signature.stderr, /flags=.*\bruntime\b/, `Hardened Runtime missing in ${target}`);
    const signed = execute('codesign', ['-d', '--entitlements', '-', '--xml', target]);
    const entitlements = JSON.parse(
      execute('plutil', ['-convert', 'json', '-o', '-', '-'], signed.stdout).stdout,
    );
    for (const key of ['com.apple.security.device.audio-input', 'com.apple.security.device.camera'])
      assert.equal(entitlements[key], true, `Missing signed ${key} in ${target}`);
  }
  const nativeAudio = path.join(bundle, 'Contents/Resources/mac/CuescordAudioCapture');
  execute('codesign', ['--verify', '--strict', nativeAudio]);
  const nativeSignature = execute('codesign', ['-dv', '--verbose=4', nativeAudio]);
  assert.match(
    nativeSignature.stderr,
    /flags=.*\bruntime\b/,
    'Native audio helper lacks Hardened Runtime',
  );
  const architecture = execute('lipo', ['-archs', nativeAudio]).stdout.trim();
  assert.equal(architecture, 'arm64', 'Native audio helper does not match the macOS package');
  return helpers.length + 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, 'darwin', 'Inspect macOS bundles on the native runner');
  const bundle = fileURLToPath(new URL('../release/mac-arm64/Cuescord.app', import.meta.url));
  const count = await checkMacMedia(bundle);
  console.log(
    `Permissões assinadas de microfone/câmera e Hardened Runtime verificados em ${count} bundles.`,
  );
}
