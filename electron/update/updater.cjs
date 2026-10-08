const { EventEmitter } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('./filesystem.cjs').promises;
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const network = require('./network.cjs');
const { extractInstallerZip } = require('./archive.cjs');
const { extractApplicationBundle, verifyApplicationDirectory } = require('./application.cjs');
const {
  API_URL,
  compareVersions,
  verifyManifest,
  selectArtifact,
  releaseUrl,
} = require('./policy.cjs');

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
  // Preserve OS warnings for Internet downloads, including unsigned installers.
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

async function cleanup(directory, files) {
  for (const file of new Set(files.filter(Boolean))) {
    await fs.unlink(`${file}:Zone.Identifier`).catch(() => {});
    await fs.unlink(file).catch(() => {});
  }
  if (directory) await fs.rmdir(directory).catch(() => {});
}

class DesktopUpdater extends EventEmitter {
  constructor({
    version,
    platform,
    arch,
    cacheRoot,
    keys,
    packaged,
    readJson = network.readJson,
    downloadVerified = network.downloadVerified,
    markFile = markDownloadedFile,
    confirmInstall,
    openInstaller,
    applyApplication,
    onInstalled = () => {},
  }) {
    super();
    Object.assign(this, {
      version,
      platform,
      arch,
      cacheRoot,
      keys,
      packaged,
      readJson,
      downloadVerified,
      markFile,
      confirmInstall,
      openInstaller,
      applyApplication,
      onInstalled,
    });
    this.state = { status: packaged ? 'idle' : 'disabled', currentVersion: version };
    this.busy = false;
  }

  getState() {
    return { ...this.state };
  }
  downloadArtifact(artifact) {
    return this.platform === 'win32' && this.applyApplication && artifact.application
      ? artifact.application
      : artifact.archive || artifact;
  }
  publish(status, details = {}) {
    this.state = { status, currentVersion: this.version, ...details };
    this.emit('state', this.getState());
    return this.getState();
  }

  async storage() {
    await fs.mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
    const entry = await fs.lstat(this.cacheRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('Armazenamento de atualização inválido.');
  }

  async highestVersion() {
    const file = path.join(this.cacheRoot, 'verified-release.json');
    try {
      const entry = await fs.lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 65536)
        throw new Error('Histórico de atualização inválido.');
      const manifest = verifyManifest(JSON.parse(await fs.readFile(file, 'utf8')), this.keys);
      return compareVersions(manifest.version, this.version) > 0 ? manifest.version : this.version;
    } catch (error) {
      if (error.code === 'ENOENT') return this.version;
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

  async check() {
    if (!this.packaged || this.busy || this.ready) return this.getState();
    this.busy = true;
    const operation = (this.operation = new AbortController());
    const timer = setTimeout(() => operation.abort(), 60000);
    this.available = undefined;
    this.publish('checking');
    try {
      if (!this.keys.length) throw new Error('Chave de atualização não configurada.');
      await this.storage();
      const highest = await this.highestVersion();
      const release = await this.readJson(API_URL, 'api', operation.signal);
      if (
        release?.draft !== false ||
        release.prerelease !== false ||
        typeof release.tag_name !== 'string' ||
        !release.tag_name.startsWith('v')
      )
        throw new Error('Release de atualização inválida.');
      const version = release.tag_name.slice(1);
      const envelope = await this.readJson(
        releaseUrl(version, 'update-manifest.json'),
        'asset',
        operation.signal,
      );
      operation.signal.throwIfAborted();
      const manifest = verifyManifest(envelope, this.keys);
      if (manifest.version !== version)
        throw new Error('A versão publicada não corresponde ao manifesto.');
      if (compareVersions(version, highest) < 0)
        throw new Error('Uma versão anterior de atualização foi recusada.');
      if (compareVersions(version, this.version) <= 0) return this.publish('current');
      const artifact = selectArtifact(manifest, this.version, highest, this.platform, this.arch);
      await this.remember(envelope);
      operation.signal.throwIfAborted();
      this.available = { envelope, artifact, version };
      return this.publish('available', {
        availableVersion: version,
        size: this.downloadArtifact(artifact).size,
        applicationUpdate: this.downloadArtifact(artifact) === artifact.application,
      });
    } catch (error) {
      return this.failure(error, operation.signal);
    } finally {
      clearTimeout(timer);
      this.operation = undefined;
      this.busy = false;
    }
  }

  async download() {
    if (!this.packaged || this.busy || !this.available || this.ready) return this.getState();
    this.busy = true;
    const operation = (this.operation = new AbortController());
    const timer = setTimeout(() => operation.abort(), 15 * 60000);
    let directory, file, archive, applicationDirectory;
    const { envelope, version } = this.available;
    this.publish('downloading', { availableVersion: version, progress: 0 });
    try {
      const manifest = verifyManifest(envelope, this.keys);
      const artifact = selectArtifact(
        manifest,
        this.version,
        await this.highestVersion(),
        this.platform,
        this.arch,
      );
      directory = await fs.mkdtemp(path.join(this.cacheRoot, 'download-'));
      file = path.join(directory, artifact.file);
      const download = this.downloadArtifact(artifact);
      const application = download === artifact.application;
      const destination =
        application || artifact.archive ? (archive = path.join(directory, download.file)) : file;
      const url = releaseUrl(version, download.file);
      let previous = -1;
      await this.downloadVerified(url, download, destination, operation.signal, (progress) => {
        if (progress !== previous) {
          previous = progress;
          this.publish('downloading', { availableVersion: version, progress });
        }
      });
      // Re-read disk even when the network helper has already verified its stream.
      await verifyFile(destination, download);
      await this.markFile(destination, url, this.platform);
      let files;
      if (application) {
        applicationDirectory = path.join(directory, 'application');
        files = await extractApplicationBundle(
          archive,
          applicationDirectory,
          version,
          operation.signal,
          (location) => this.markFile(location, url, this.platform),
        );
      } else if (archive) {
        await extractInstallerZip(archive, file, artifact, operation.signal);
        await this.markFile(file, url, this.platform);
      }
      if (!application) await verifyFile(file, artifact);
      operation.signal.throwIfAborted();
      this.ready = {
        file: application ? undefined : file,
        archive,
        directory,
        envelope,
        artifact,
        version,
        applicationDirectory,
        files,
      };
      return this.publish('ready', {
        availableVersion: version,
        progress: 100,
        applicationUpdate: application,
      });
    } catch (error) {
      if (applicationDirectory) await fs.rm(applicationDirectory, { recursive: true, force: true });
      await cleanup(directory, [file, archive]);
      return this.failure(error, operation.signal);
    } finally {
      clearTimeout(timer);
      this.operation = undefined;
      this.busy = false;
    }
  }

  async install(canInstall = () => true) {
    if (
      !this.packaged ||
      this.busy ||
      !this.ready ||
      this.state.status !== 'ready' ||
      this.launched
    )
      return this.getState();
    this.busy = true;
    const ready = this.ready;
    this.publish('installing', { availableVersion: ready.version });
    try {
      const applicationUpdate = Boolean(ready.applicationDirectory);
      if (!(await this.confirmInstall(ready.version, this.platform, applicationUpdate)))
        return this.publish('ready', {
          availableVersion: ready.version,
          progress: 100,
          applicationUpdate,
        });
      if (!canInstall()) throw new Error('A janela de atualização foi encerrada.');
      const manifest = verifyManifest(ready.envelope, this.keys);
      const artifact = selectArtifact(
        manifest,
        this.version,
        await this.highestVersion(),
        this.platform,
        this.arch,
      );
      if (applicationUpdate) {
        await verifyFile(ready.archive, artifact.application);
        await verifyApplicationDirectory(ready.applicationDirectory, ready.files);
      } else {
        if (artifact.archive) await verifyFile(ready.archive, artifact.archive);
        await verifyFile(ready.file, artifact);
      }
      if (!canInstall()) throw new Error('A janela de atualização foi encerrada.');
      const result = applicationUpdate
        ? await this.applyApplication(ready, canInstall)
        : await this.openInstaller(ready.file);
      if (result) throw new Error('Não foi possível abrir o instalador.');
      this.launched = true;
      this.publish(applicationUpdate ? 'restarting' : 'opened', {
        availableVersion: ready.version,
      });
      this.onInstalled(this.platform);
      return this.getState();
    } catch (error) {
      this.ready = undefined;
      if (ready.applicationDirectory)
        await fs.rm(ready.applicationDirectory, { recursive: true, force: true });
      await cleanup(ready.directory, [ready.file, ready.archive]);
      return this.failure(error);
    } finally {
      this.busy = false;
    }
  }

  cancel() {
    this.operation?.abort();
    return this.getState();
  }

  failure(error, signal) {
    if (signal?.aborted)
      return this.publish('idle', { message: 'Operação cancelada ou tempo limite atingido.' });
    // Avoid returning local paths or arbitrary server responses to the UI.
    const message =
      error.code === 'ENOSPC'
        ? 'Não há espaço para baixar a atualização.'
        : error.code
          ? 'Não foi possível concluir a atualização. Verifique a conexão e tente novamente.'
          : error.message;
    return this.publish('error', { message });
  }
}

module.exports = { DesktopUpdater, verifyFile, markDownloadedFile };
