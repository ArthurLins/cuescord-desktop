const VERSION = 1;
const MAX_MESSAGE = 1024 * 1024;
const METHODS = new Set([
  'devices',
  'load',
  'configure',
  'transport',
  'produce',
  'consume',
  'close-consumer',
  'stats',
  'restart-ice',
  'ice-servers',
  'set-bitrate',
  'reply',
]);
const CONFIG_KEYS = new Set([
  'audioInputId',
  'audioOutputId',
  'inputMode',
  'activationMode',
  'activationThreshold',
  'inputVolume',
  'outputVolume',
  'echoCancellation',
  'autoGainControl',
  'noiseSuppression',
  'noiseSuppressionMode',
  'voiceBoost',
  'muted',
  'deafened',
  'ptt',
  'volumes',
]);
function validCommand(method, data) {
  if (!METHODS.has(method) || !data || typeof data !== 'object' || Array.isArray(data))
    return false;
  try {
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_MESSAGE - 1024) return false;
  } catch {
    return false;
  }
  if (method === 'configure') {
    for (const [key, value] of Object.entries(data)) {
      if (!CONFIG_KEYS.has(key)) return false;
      if (
        [
          'muted',
          'deafened',
          'ptt',
          'echoCancellation',
          'autoGainControl',
          'noiseSuppression',
          'voiceBoost',
        ].includes(key) &&
        typeof value !== 'boolean'
      )
        return false;
      if (
        ['audioInputId', 'audioOutputId'].includes(key) &&
        (typeof value !== 'string' || value.length > 512)
      )
        return false;
      if (key === 'inputMode' && !['voice-activity', 'push-to-talk'].includes(value)) return false;
      if (key === 'activationMode' && !['automatic', 'manual'].includes(value)) return false;
      if (key === 'noiseSuppressionMode' && !['native', 'rnnoise'].includes(value)) return false;
      if (
        ['activationThreshold', 'inputVolume', 'outputVolume'].includes(key) &&
        (!Number.isFinite(value) ||
          value < 0 ||
          value > (key === 'activationThreshold' ? 100 : 200))
      )
        return false;
      if (
        key === 'volumes' &&
        (!value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).length > 256 ||
          Object.entries(value).some(
            ([id, volume]) =>
              id.length > 128 || !Number.isFinite(volume) || volume < 0 || volume > 2,
          ))
      )
        return false;
    }
  }
  if (method === 'set-bitrate' && ![32000, 64000, 96000, 128000, 256000].includes(data.bitrate))
    return false;
  return true;
}
module.exports = { VERSION, MAX_MESSAGE, validCommand };
