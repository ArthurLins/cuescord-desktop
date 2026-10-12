// Pure public capability policy; no host inspection or helper startup here.
function supportsMacAudio(platform, release) {
  return platform === 'darwin' && /^\d+\./.test(release) && Number(release.split('.')[0]) >= 22;
}

module.exports = { supportsMacAudio };
