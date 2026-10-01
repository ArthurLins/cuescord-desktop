const screenQualities = Object.freeze(
  [
    {
      id: '720p30',
      label: '720p · 30 FPS',
      width: 1280,
      height: 720,
      frameRate: 30,
      maxBitrate: 1_500_000,
    },
    {
      id: '1080p30',
      label: '1080p · 30 FPS',
      width: 1920,
      height: 1080,
      frameRate: 30,
      maxBitrate: 3_000_000,
    },
    {
      id: '1080p60',
      label: '1080p · 60 FPS',
      width: 1920,
      height: 1080,
      frameRate: 60,
      maxBitrate: 5_000_000,
    },
    {
      id: '1440p60',
      label: '1440p · 60 FPS',
      width: 2560,
      height: 1440,
      frameRate: 60,
      maxBitrate: 8_000_000,
    },
    {
      id: '2160p30',
      label: '4K · 30 FPS',
      width: 3840,
      height: 2160,
      frameRate: 30,
      maxBitrate: 12_000_000,
    },
  ].map(Object.freeze),
);

const defaultScreenQuality = '1080p30';
function screenQuality(id = defaultScreenQuality) {
  const profile = screenQualities.find((item) => item.id === id);
  if (!profile) throw new Error('Qualidade de compartilhamento inválida.');
  return profile;
}

module.exports = { screenQualities, screenQuality, defaultScreenQuality };
