import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.platform === 'win32' && process.arch === 'x64') {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = path.join(root, '.cache/updater');
  const env = {
    ...process.env,
    CARGO_HOME: path.join(root, '.cache/cargo'),
    CARGO_TARGET_DIR: path.join(output, 'target'),
  };
  for (const command of ['test', 'build']) {
    const result = spawnSync(
      'cargo',
      [command, '--locked', '--release', '--manifest-path', 'native/updater/Cargo.toml'],
      { cwd: root, env, stdio: 'inherit' },
    );
    if (result.error || result.status !== 0)
      throw result.error || new Error('Windows updater build failed');
  }
  await mkdir(path.join(output, 'bin'), { recursive: true });
  await copyFile(
    path.join(output, 'target/release/cuescord-update.exe'),
    path.join(output, 'bin/cuescord-update.exe'),
  );
  const metadata = spawnSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--manifest-path',
      'native/updater/Cargo.toml',
    ],
    { cwd: root, env, encoding: 'utf8' },
  );
  if (metadata.error || metadata.status !== 0)
    throw metadata.error || new Error('Updater dependency notices failed');
  const notices = ['Cuescord Windows updater — dependency licenses\n'];
  for (const entry of JSON.parse(metadata.stdout).packages) {
    if (!entry.source) continue;
    const directory = path.dirname(entry.manifest_path);
    const licenses = (await readdir(directory)).filter((name) =>
      /^(LICENSE|NOTICE)([._-]|$)/i.test(name),
    );
    if (!licenses.length) throw new Error(`Missing upstream license for ${entry.name}`);
    notices.push(`${entry.name} ${entry.version} (${entry.license})`);
    for (const name of licenses.sort())
      notices.push(`${name}\n${await readFile(path.join(directory, name), 'utf8')}`);
  }
  await writeFile(path.join(output, 'bin/UPDATER_NOTICES.txt'), notices.join('\n\n'));
}
