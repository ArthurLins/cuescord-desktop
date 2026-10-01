import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const target = {
  win32: ['win-x64', 'exe'],
  linux: ['linux-amd64', 'deb'],
  darwin: ['mac-arm64', 'dmg'],
}[process.platform];
if (!target) throw new Error('Unsupported installer platform');
const name = `Cuescord-${manifest.version}-${target[0]}.${target[1]}`;
const installer = new URL(`release/${name}`, root);
const sha256 = createHash('sha256')
  .update(await readFile(installer))
  .digest('hex');
const output = new URL('artifacts/', root);
await mkdir(output, { recursive: true });
await copyFile(installer, new URL(name, output));
const label = `${process.platform}-${process.arch}`;
await writeFile(new URL(`sha256sums-${label}.txt`, output), `${sha256}  ${name}\n`);
const info = {
  version: manifest.version,
  commit: process.env.GITHUB_SHA || null,
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  electron: manifest.devDependencies.electron,
  builder: manifest.devDependencies['electron-builder'],
  packageManager: manifest.packageManager,
  installer: name,
  sha256,
  workflow: process.env.GITHUB_RUN_ID
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
};
await writeFile(new URL(`build-info-${label}.json`, output), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Collected ${name}`);
