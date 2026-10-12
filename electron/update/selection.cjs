const { compareVersions } = require('./policy.cjs');

function publishedVersion(release) {
  if (
    release?.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== 'string' ||
    !release.tag_name.startsWith('v')
  )
    throw new Error('Release de atualização inválida.');
  return release.tag_name.slice(1);
}

function assertReleaseVersion(manifestVersion, published, highest) {
  if (manifestVersion !== published)
    throw new Error('A versão publicada não corresponde ao manifesto.');
  if (compareVersions(published, highest) < 0)
    throw new Error('Uma versão anterior de atualização foi recusada.');
}

function selectDownload(artifact, platform, canApplyApplication) {
  return platform === 'win32' && canApplyApplication && artifact.application
    ? artifact.application
    : artifact.archive || artifact;
}

module.exports = { publishedVersion, assertReleaseVersion, selectDownload };
