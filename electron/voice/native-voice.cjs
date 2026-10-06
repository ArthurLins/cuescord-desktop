const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } = require('node:fs');
const path = require('node:path');
const { sameOrigin } = require('../security/policy.cjs');
const { VERSION, MAX_MESSAGE, validCommand } = require('./protocol.cjs');

// One trusted main frame owns one helper. No audio crosses IPC and no executable
// path, environment, shell, server URL or auth cookie comes from the renderer.
function installNativeVoice({
  app,
  ipcMain,
  window,
  trustedUrl,
  spawnHelper = spawn,
  filesExist = existsSync,
  requestTimeoutMs = 12000,
}) {
  const contents = window.webContents;
  const folder = app.isPackaged
    ? path.join(process.resourcesPath, 'native-voice')
    : path.join(__dirname, '../../.cache/native-voice/bin');
  const executable = path.join(folder, 'cuescord-voice.exe');
  const preferenceFile = path.join(app.getPath('userData'), 'native-voice.json');
  const available =
    process.platform === 'win32' &&
    process.arch === 'x64' &&
    filesExist(executable) &&
    filesExist(path.join(folder, 'CuescordVoiceBackend.dll'));
  let enabled = false,
    session,
    nextId = 0;
  let noiseSuppressionModes = filesExist(path.join(folder, 'RNNOISE_NOTICES.txt'))
    ? ['native', 'rnnoise']
    : ['native'];
  let voiceQualityProtocol = filesExist(path.join(folder, 'capabilities.json')) ? 1 : 0;
  try {
    enabled = JSON.parse(readFileSync(preferenceFile, 'utf8')).enabled === true;
  } catch {
    /* Default is opt-out, including corrupt preferences. */
  }
  const trusted = (event) =>
    !window.isDestroyed() &&
    event.sender === contents &&
    !event.sender.isDestroyed() &&
    event.senderFrame === event.sender.mainFrame &&
    !event.senderFrame.isDestroyed() &&
    sameOrigin(event.senderFrame.url, trustedUrl);
  const status = () => ({
    protocol: VERSION,
    available,
    enabled,
    active: Boolean(session),
    engine: 'libwebrtc-m140',
    noiseSuppressionModes,
    voiceQualityProtocol,
  });
  function stop(reason = 'closed') {
    const previous = session;
    if (!previous) return;
    session = undefined;
    clearTimeout(previous.readyTimer);
    previous.readyReject(new Error('Native voice closed'));
    for (const pending of previous.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Native voice closed'));
    }
    previous.pending.clear();
    previous.child.stdin.destroy();
    previous.child.kill(); // OS releases microphone even if the native worker hung.
    if (!contents.isDestroyed())
      contents.send('cuescord:voice:event', { sessionId: previous.id, type: 'stopped', reason });
  }
  async function open() {
    if (!available || !enabled) throw new Error('Native voice is disabled or unavailable');
    if (session) throw new Error('Native voice session already active');
    const child = spawnHelper(executable, [], {
      cwd: folder,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const current = {
      id: randomUUID(),
      child,
      pending: new Map(),
      readyReject,
      readyTimer: undefined,
      ready: false,
      buffer: Buffer.alloc(0),
    };
    session = current;
    current.readyTimer = setTimeout(() => stop('startup-timeout'), 10000);
    child.on('error', () => {
      if (session === current) stop('helper-error');
    });
    child.on('exit', () => {
      if (session === current) stop('helper-exited');
    });
    child.stdin.on('error', () => {
      if (session === current) stop('input-error');
    });
    child.stdout.on('data', (chunk) => {
      if (session !== current) return;
      current.buffer = Buffer.concat([current.buffer, chunk]);
      let end;
      while ((end = current.buffer.indexOf(10)) >= 0) {
        if (end > MAX_MESSAGE) {
          stop('protocol-error');
          return;
        }
        const line = current.buffer.subarray(0, end);
        current.buffer = current.buffer.subarray(end + 1);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          stop('protocol-error');
          return;
        }
        if (event.type === 'ready') {
          if (
            current.ready ||
            event.protocol !== VERSION ||
            event.media?.length !== 1 ||
            event.media[0] !== 'voice'
          ) {
            stop('protocol-error');
            return;
          }
          current.ready = true;
          voiceQualityProtocol = event.voiceQualityProtocol === 1 ? 1 : 0;
          noiseSuppressionModes =
            Array.isArray(event.noiseSuppressionModes) &&
            event.noiseSuppressionModes.includes('rnnoise')
              ? ['native', 'rnnoise']
              : ['native'];
          clearTimeout(current.readyTimer);
          readyResolve({ sessionId: current.id, ...status() });
        } else if (!current.ready || event.type === 'fatal') {
          stop('backend-error');
          return;
        } else if (event.type === 'response') {
          const pending = current.pending.get(event.id);
          if (!pending) continue;
          current.pending.delete(event.id);
          clearTimeout(pending.timer);
          if (event.error) pending.reject(new Error('Native voice operation failed'));
          else pending.resolve(event.data);
        } else if (
          ['meter', 'signal', 'transport-state', 'health', 'processing-state', 'quality'].includes(
            event.type,
          )
        ) {
          contents.send('cuescord:voice:event', { ...event, sessionId: current.id });
        } else {
          stop('protocol-error');
          return;
        }
      }
      if (current.buffer.length > MAX_MESSAGE) stop('protocol-error');
    });
    return ready;
  }
  function request(sessionId, method, data) {
    const current = session;
    if (
      !current?.ready ||
      current.id !== sessionId ||
      !validCommand(method, data) ||
      current.pending.size >= 64
    )
      return Promise.reject(new Error('Invalid native voice request'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (session === current) stop('command-timeout');
      }, requestTimeoutMs);
      current.pending.set(id, { resolve, reject, timer });
      if (current.child.stdin.writableLength > 2 * MAX_MESSAGE) {
        stop('input-overflow');
        return;
      }
      current.child.stdin.write(JSON.stringify({ id, method, data }) + '\n');
    });
  }
  const channels = {
    'cuescord:voice:status': () => status(),
    'cuescord:voice:enabled': (_event, value) => {
      if (typeof value !== 'boolean' || (value && !available) || session)
        throw new Error('Leave the call before changing the voice engine');
      mkdirSync(path.dirname(preferenceFile), { recursive: true });
      writeFileSync(preferenceFile + '.tmp', JSON.stringify({ enabled: value }), { mode: 0o600 });
      renameSync(preferenceFile + '.tmp', preferenceFile);
      enabled = value;
      return status();
    },
    'cuescord:voice:open': () => open(),
    'cuescord:voice:request': (_event, value) =>
      request(value?.sessionId, value?.method, value?.data),
    'cuescord:voice:close': (_event, id) => {
      if (session?.id === id) stop();
    },
  };
  for (const [channel, handler] of Object.entries(channels))
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted native voice caller');
      return handler(event, ...args);
    });
  const navigation = (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) stop('navigation');
  };
  contents.on('did-start-navigation', navigation);
  contents.on('render-process-gone', () => stop('renderer-gone'));
  const quitting = () => stop('quit');
  contents.once('destroyed', () => {
    stop('window-closed');
    for (const channel of Object.keys(channels)) ipcMain.removeHandler(channel);
    app.removeListener('before-quit', quitting);
  });
  app.on('before-quit', quitting);
  return { stop };
}
module.exports = { installNativeVoice };
