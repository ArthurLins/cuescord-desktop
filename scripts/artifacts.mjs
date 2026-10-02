import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import policy from '../electron/update/policy.cjs';
import archive from '../electron/update/archive.cjs';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function collectInstaller({
  root,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const name = policy.installerName(manifest.version, platform, arch);
  const zipName = policy.archiveName(manifest.version, platform, arch);
  const installer = path.join(root, 'release', name);
  const output = path.join(root, 'artifacts');
  await mkdir(output, { recursive: true });
  // Direct installers remain available for pre-ZIP clients, including skipped releases.
  await copyFile(installer, path.join(output, name));
  await archive.createInstallerZip(path.join(output, name), path.join(output, zipName), name);
  const installerHash = await sha256(path.join(output, name));
  const archiveHash = await sha256(path.join(output, zipName));
  const label = `${platform}-${arch}`;
  await writeFile(
    path.join(output, `sha256sums-${label}.txt`),
    `${installerHash}  ${name}\n${archiveHash}  ${zipName}\n`,
  );
  const info = {
    version: manifest.version,
    commit: env.GITHUB_SHA || null,
    platform,
    architecture: arch,
    node: process.version,
    electron: manifest.devDependencies.electron,
    builder: manifest.devDependencies['electron-builder'],
    packageManager: manifest.packageManager,
    installer: name,
    sha256: installerHash,
    archive: { format: 'zip-store-v1', file: zipName, sha256: archiveHash },
    workflow: env.GITHUB_RUN_ID
      ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null,
  };
  await writeFile(
    path.join(output, `build-info-${label}.json`),
    `${JSON.stringify(info, null, 2)}\n`,
  );
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const info = await collectInstaller({ root: fileURLToPath(new URL('../', import.meta.url)) });
  console.log(`Collected ${info.archive.file} and legacy installer ${info.installer}`);
}
