const { spawn } = require('node:child_process');
const path = require('node:path');

function supportsMacAudio(platform = process.platform, release = require('node:os').release()) {
  return platform === 'darwin' && /^\d+\./.test(release) && Number(release.split('.')[0]) >= 22;
}

function captureArguments(config) {
  if (
    !['window', 'screen'].includes(config.kind) ||
    typeof config.sourceId !== 'string' ||
    !new RegExp(`^${config.kind}:\\d{1,10}:\\d{1,10}$`).test(config.sourceId) ||
    !Number.isInteger(config.ownPid) ||
    config.ownPid <= 1 ||
    config.ownPid > 2147483647 ||
    (config.displayId !== undefined && !/^\d{1,10}$/.test(config.displayId))
  )
    throw new Error('Fonte de áudio macOS inválida.');
  return [
    '--capture',
    config.kind,
    config.sourceId,
    String(config.ownPid),
    config.displayId ?? '',
    'net.cuesc.cuescord',
  ];
}

// Native pipe chunks may split headers or PCM frames. Only complete, bounded packets leave this parser.
function createPacketParser(onPacket) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    if (!Buffer.isBuffer(chunk) || chunk.length > 1024 * 1024)
      throw new Error('Pacote de áudio macOS inválido.');
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (length < 1 || length > 8193) throw new Error('Pacote de áudio macOS inválido.');
      if (buffered.length < length + 4) return;
      const type = buffered[4];
      const payload = buffered.subarray(5, length + 4);
      if (
        !(
          (type === 0 && payload.length === 0) ||
          (type === 1 && payload.length > 0 && payload.length % 4 === 0) ||
          (type === 2 && payload.length === 1 && payload[0] >= 1 && payload[0] <= 5)
        )
      )
        throw new Error('Pacote de áudio macOS inválido.');
      buffered = buffered.subarray(length + 4);
      onPacket(type, payload);
    }
  };
}

function startMacAudio(config, sendAudio, onError, launch = spawn) {
  const packaged = __dirname.split(path.sep).includes('app.asar');
  const executable = packaged
    ? path.join(process.resourcesPath, 'mac', 'CuescordAudioCapture')
    : path.resolve(__dirname, '../../.cache/mac/CuescordAudioCapture');
  const child = launch(executable, captureArguments(config), {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    shell: false,
  });
  let stopped = false;
  let started = false;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    rejectReady(new Error('Captura de áudio macOS encerrada.'));
    child.stdin.end('stop\n');
    const timeout = setTimeout(() => child.kill(), 1000);
    timeout.unref();
    child.once('exit', () => clearTimeout(timeout));
  };
  const fail = () => {
    if (stopped) return;
    const error = new Error(
      'Não foi possível capturar o áudio no macOS. Confira a permissão de gravação de tela e áudio.',
    );
    rejectReady(error);
    if (started) onError(error);
    stop();
  };
  const parse = createPacketParser((type, data) => {
    if (stopped) return;
    if (type === 0) {
      if (started) return fail();
      started = true;
      resolveReady();
    } else if (type === 1) {
      if (started) sendAudio('app', data);
    } else fail();
  });
  child.stdout.on('data', (data) => {
    try {
      parse(data);
    } catch {
      fail();
    }
  });
  child.stdin.on('error', () => {});
  child.on('error', fail);
  child.once('exit', fail);
  return { ready, stop };
}

module.exports = { supportsMacAudio, captureArguments, createPacketParser, startMacAudio };
