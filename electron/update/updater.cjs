const { EventEmitter } = require('node:events');
const { publishedVersion, assertReleaseVersion, selectDownload } = require('./selection.cjs');
const {
  API_URL,
  compareVersions,
  verifyManifest,
  selectArtifact,
  releaseUrl,
} = require('./policy.cjs');

// Application service: signed-update decisions and lifecycle orchestration.
// Network, package storage, OS installation and confirmation are injected ports.
class DesktopUpdater extends EventEmitter {
  constructor({
    version,
    platform,
    arch,
    keys,
    packaged,
    readJson,
    downloadVerified,
    storage,
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
      keys,
      packaged,
      readJson,
      downloadVerified,
      storage,
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
    return selectDownload(artifact, this.platform, Boolean(this.applyApplication));
  }
  publish(status, details = {}) {
    this.state = { status, currentVersion: this.version, ...details };
    this.emit('state', this.getState());
    return this.getState();
  }

  async highestVersion() {
    const envelope = await this.storage.readWatermark();
    if (!envelope) return this.version;
    const manifest = verifyManifest(envelope, this.keys);
    return compareVersions(manifest.version, this.version) > 0 ? manifest.version : this.version;
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
      await this.storage.ensure();
      const highest = await this.highestVersion();
      const release = await this.readJson(API_URL, 'api', operation.signal);
      const version = publishedVersion(release);
      const envelope = await this.readJson(
        releaseUrl(version, 'update-manifest.json'),
        'asset',
        operation.signal,
      );
      operation.signal.throwIfAborted();
      const manifest = verifyManifest(envelope, this.keys);
      assertReleaseVersion(manifest.version, version, highest);
      if (compareVersions(version, this.version) <= 0) return this.publish('current');
      const artifact = selectArtifact(manifest, this.version, highest, this.platform, this.arch);
      await this.storage.remember(envelope);
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
    let staged;
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
      const download = this.downloadArtifact(artifact);
      const application = download === artifact.application;
      staged = await this.storage.createDownload(artifact, download);
      const url = releaseUrl(version, download.file);
      let previous = -1;
      await this.downloadVerified(
        url,
        download,
        staged.destination,
        operation.signal,
        (progress) => {
          if (progress !== previous) {
            previous = progress;
            this.publish('downloading', { availableVersion: version, progress });
          }
        },
      );
      await this.storage.prepare(staged, { artifact, download, version, url }, operation.signal);
      operation.signal.throwIfAborted();
      this.ready = {
        ...staged,
        envelope,
        artifact,
        version,
      };
      return this.publish('ready', {
        availableVersion: version,
        progress: 100,
        applicationUpdate: application,
      });
    } catch (error) {
      await this.storage.discard(staged);
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
      await this.storage.verifyReady(ready, artifact);
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
      await this.storage.discard(ready);
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

module.exports = { DesktopUpdater };
