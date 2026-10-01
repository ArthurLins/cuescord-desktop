const { createPublicKey, createHash, verify } = require('node:crypto');

const REPOSITORY = 'ArthurLins/cuescord-desktop';
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const SIGNING_CONTEXT = Buffer.from('Cuescord desktop updates v1\n');
const MAX_INSTALLER_SIZE = 1024 * 1024 * 1024;
const targets = {
  'win32-x64': 'win-x64.exe',
  'linux-x64': 'linux-amd64.deb',
  'darwin-arm64': 'mac-arm64.dmg',
};

function versionParts(version) {
  if (
    typeof version !== 'string' ||
    version.trim() !== version ||
    !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version)
  )
    throw new Error('Versão de atualização inválida.');
  return version.split('.').map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left),
    b = versionParts(right);
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

function installerName(version, platform, arch) {
  versionParts(version);
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error('Atualização indisponível para este sistema.');
  return `Cuescord-${version}-${target}`;
}

function publicKeyId(key) {
  const publicKey = createPublicKey(key);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Chave de atualização inválida.');
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

function decodeBase64(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 || !value.length)
    throw new Error('Assinatura ou manifesto inválido.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== value)
    throw new Error('Codificação de atualização inválida.');
  return bytes;
}

function verifyManifest(envelope, trustedKeys) {
  if (!Array.isArray(trustedKeys) || !trustedKeys.length)
    throw new Error('Chave de atualização não configurada.');
  const payload = decodeBase64(envelope?.payload, 32768);
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length > 8)
    throw new Error('Manifesto sem assinatura válida.');
  const signed = Buffer.concat([SIGNING_CONTEXT, payload]);
  const valid = trustedKeys.some((key) => {
    if (publicKeyId(key.publicKey) !== key.id) throw new Error('Chave de atualização inválida.');
    return envelope.signatures.some((entry) => {
      if (entry?.keyId !== key.id) return false;
      const signature = decodeBase64(entry.signature, 64);
      return signature.length === 64 && verify(null, signed, key.publicKey, signature);
    });
  });
  if (!valid) throw new Error('A assinatura da atualização não é confiável.');
  const manifest = JSON.parse(payload.toString('utf8'));
  versionParts(manifest.version);
  if (
    manifest.schema !== 1 ||
    manifest.repository !== REPOSITORY ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== 3
  )
    throw new Error('Manifesto de atualização inválido.');
  const platforms = new Set();
  for (const artifact of manifest.artifacts) {
    const target = `${artifact.platform}-${artifact.arch}`;
    if (
      platforms.has(target) ||
      artifact.file !== installerName(manifest.version, artifact.platform, artifact.arch) ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size <= 0 ||
      artifact.size > MAX_INSTALLER_SIZE ||
      typeof artifact.sha512 !== 'string' ||
      artifact.sha512.length !== 128 ||
      !/^[a-f0-9]{128}$/.test(artifact.sha512)
    )
      throw new Error('Arquivo de atualização inválido.');
    platforms.add(target);
  }
  return manifest;
}

function selectArtifact(manifest, currentVersion, highestVersion, platform, arch) {
  if (
    compareVersions(manifest.version, currentVersion) <= 0 ||
    compareVersions(manifest.version, highestVersion) < 0
  )
    throw new Error('Uma versão anterior de atualização foi recusada.');
  const file = installerName(manifest.version, platform, arch);
  return manifest.artifacts.find((artifact) => artifact.file === file);
}

function releaseUrl(version, file) {
  versionParts(version);
  if (typeof file !== 'string' || file.trim() !== file || !/^[A-Za-z0-9._-]+$/.test(file))
    throw new Error('Nome de atualização inválido.');
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${file}`;
}

function validateNetworkUrl(value, kind) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('Destino de atualização recusado.');
  if (kind === 'api') {
    if (url.href !== API_URL) throw new Error('Servidor de atualização recusado.');
  } else if (
    !(
      url.hostname === 'github.com' &&
      !url.search &&
      url.pathname.startsWith(`/${REPOSITORY}/releases/download/`)
    ) &&
    !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
      url.hostname,
    )
  ) {
    throw new Error('Download fora do servidor autorizado.');
  }
  return url;
}

module.exports = {
  REPOSITORY,
  API_URL,
  SIGNING_CONTEXT,
  MAX_INSTALLER_SIZE,
  compareVersions,
  installerName,
  publicKeyId,
  verifyManifest,
  selectArtifact,
  releaseUrl,
  validateNetworkUrl,
};
