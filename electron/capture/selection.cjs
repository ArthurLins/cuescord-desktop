const { screenQuality } = require('./quality.cjs');

function resolveCaptureSelection({ sources, audioApps, portal, platform }, sourceId, options = {}) {
  const kind = options.kind;
  const source = sources.get(kind)?.find((item) => item.id === sourceId);
  if (!['window', 'screen'].includes(kind) || !source)
    throw new Error('Fonte de captura inválida.');
  const audioApp =
    kind === 'window' && options.audioApp
      ? audioApps.find((item) => item.id === options.audioApp)
      : undefined;
  if (options.audioApp && !audioApp) throw new Error('Aplicativo de áudio inválido.');
  if (portal && kind === 'window' && !audioApp) throw new Error('Selecione o aplicativo de áudio.');
  return {
    source,
    selection: {
      quality: screenQuality(options.quality),
      kind,
      audioApp,
      enabled: (kind === 'window' && platform !== 'darwin') || options.audio === true,
      displayId: source.display_id || undefined,
    },
  };
}

function captureAudioAllowed({ requested, enabled, platform, macAudio }) {
  return Boolean(requested && enabled && (['win32', 'linux'].includes(platform) || macAudio));
}

module.exports = { resolveCaptureSelection, captureAudioAllowed };
