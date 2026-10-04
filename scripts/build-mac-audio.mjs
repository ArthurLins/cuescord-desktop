import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin') {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await mkdir(new URL('../.cache/mac/', import.meta.url), { recursive: true });
  const execute = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
    return result.stdout;
  };
  const architecture = process.env.CUESCORD_MAC_ARCH || process.arch;
  assert.ok(['arm64', 'x64'].includes(architecture), 'Unsupported macOS architecture');
  const target = `${architecture === 'x64' ? 'x86_64' : architecture}-apple-macos13.0`;
  execute('xcrun', [
    'clang',
    '-O2',
    '-target',
    target,
    '-c',
    'native/macos/process.c',
    '-o',
    '.cache/mac/process.o',
  ]);
  execute('xcrun', [
    'swiftc',
    '-O',
    '-swift-version',
    '5',
    '-parse-as-library',
    '-target',
    target,
    '-import-objc-header',
    'native/macos/process.h',
    'native/macos/ScreenAudio.swift',
    '.cache/mac/process.o',
    '-framework',
    'ScreenCaptureKit',
    '-framework',
    'AVFoundation',
    '-framework',
    'CoreMedia',
    '-o',
    '.cache/mac/CuescordAudioCapture',
  ]);
  const tested = JSON.parse(execute('./.cache/mac/CuescordAudioCapture', ['--self-test']));
  assert.deepEqual(tested, {
    stereoPCM: true,
    quietAudioPreserved: true,
    ownProcessExcluded: true,
  });
  console.log(
    'Capturador macOS compilado; PCM estéreo, áudio baixo e exclusão do próprio processo verificados.',
  );
}
