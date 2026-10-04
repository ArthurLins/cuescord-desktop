import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
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
  const argumentsList = [
    'swift',
    'build',
    '--configuration',
    'release',
    '--product',
    'CuescordAudioCapture',
    '--scratch-path',
    '.cache/mac/build',
    '--arch',
    architecture === 'x64' ? 'x86_64' : architecture,
  ];
  execute('xcrun', argumentsList);
  const binaryDirectory = execute('xcrun', [...argumentsList, '--show-bin-path']).trim();
  await copyFile(
    path.join(binaryDirectory, 'CuescordAudioCapture'),
    path.join(root, '.cache/mac/CuescordAudioCapture'),
  );
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
