const { createHash, randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('./filesystem.cjs').promises;
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { extractInstallerZip } = require('./archive.cjs');
const { extractApplicationBundle, verifyApplicationDirectory } = require('./application.cjs');

async function verifyFile(file, artifact) {
  const entry = await fs.lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== artifact.size)
    throw new Error('O instalador salvo foi alterado.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const hash = createHash('sha512');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== artifact.sha512) throw new Error('O instalador salvo foi alterado.');
  } finally {
    await handle.close();
  }
}

async function markDownloadedFile(file, url, platform) {
  // Keep operating-system warnings attached to verified Internet downloads.
  if (platform === 'win32')
    await fs.writeFile(
      `${file}:Zone.Identifier`,
      `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${url}\r\n`,
    );
  if (platform === 'darwin')
    await promisify(execFile)(
      '/usr/bin/xattr',
      [
        '-w',
        'com.apple.quarantine',
        `0081;${Math.floor(Date.now() / 1000).toString(16)};Cuescord;`,
        file,
      ],
      { timeout: 10000 },
    );
}

// Filesystem adapter. The updater decides which signed package to use; this
// store owns staging, disk integrity, quarantine and extraction, never network.
class UpdatePackageStore {
  constructor({ cacheRoot, platform, markFile = markDownloadedFile }) {
    Object.assign(this, { cacheRoot, platform, markFile });
  }

  async ensure() {
    await fs.mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
    const entry = await fs.lstat(this.cacheRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('Armazenamento de atualização inválido.');
  }

  async readWatermark() {
    const file = path.join(this.cacheRoot, 'verified-release.json');
    try {
      const entry = await fs.lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 65536)
        throw new Error('Histórico de atualização inválido.');
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async remember(envelope) {
    const temporary = path.join(this.cacheRoot, `${randomUUID()}.json.part`);
    try {
      await fs.writeFile(temporary, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, path.join(this.cacheRoot, 'verified-release.json'));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async createDownload(artifact, download) {
    const directory = await fs.mkdtemp(path.join(this.cacheRoot, 'download-'));
    const application = download === artifact.application;
    const file = application ? undefined : path.join(directory, artifact.file);
    const archive =
      application || artifact.archive ? path.join(directory, download.file) : undefined;
    return {
      directory,
      file,
      archive,
      destination: archive || file,
      applicationDirectory: application ? path.join(directory, 'application') : undefined,
    };
  }

  async prepare(staged, { artifact, download, version, url }, signal) {
    // Re-read disk even when the network adapter verified the incoming stream.
    await verifyFile(staged.destination, download);
    await this.markFile(staged.destination, url, this.platform);
    if (staged.applicationDirectory) {
      staged.files = await extractApplicationBundle(
        staged.archive,
        staged.applicationDirectory,
        version,
        signal,
        (location) => this.markFile(location, url, this.platform),
      );
    } else {
      if (staged.archive) {
        await extractInstallerZip(staged.archive, staged.file, artifact, signal);
        await this.markFile(staged.file, url, this.platform);
      }
      await verifyFile(staged.file, artifact);
    }
  }

  async verifyReady(ready, artifact) {
    if (ready.applicationDirectory) {
      await verifyFile(ready.archive, artifact.application);
      await verifyApplicationDirectory(ready.applicationDirectory, ready.files);
    } else {
      if (artifact.archive) await verifyFile(ready.archive, artifact.archive);
      await verifyFile(ready.file, artifact);
    }
  }

  async discard(staged) {
    if (!staged) return;
    if (staged.applicationDirectory)
      await fs.rm(staged.applicationDirectory, { recursive: true, force: true });
    for (const file of new Set([staged.file, staged.archive, staged.destination].filter(Boolean))) {
      await fs.unlink(`${file}:Zone.Identifier`).catch(() => {});
      await fs.unlink(file).catch(() => {});
    }
    if (staged.directory) await fs.rmdir(staged.directory).catch(() => {});
  }
}

module.exports = { UpdatePackageStore, markDownloadedFile };
