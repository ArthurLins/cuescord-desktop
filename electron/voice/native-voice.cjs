const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
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
  onActiveChanged,
}) {
  const contents = window.webContents;
  const folder = app.isPackaged
    ? path.join(process.resourcesPath, 'native-voice')
    : path.join(__dirname, '../../.cache/native-voice/bin');
  const executable = path.join(folder, 'cuescord-voice.exe');
  const available =
    process.platform === 'win32' &&
    process.arch === 'x64' &&
    filesExist(executable) &&
    filesExist(path.join(folder, 'CuescordVoiceBackend.dll'));
  let session, idleDevices, lastStopReason;
  let nextId = 0;
  let noiseSuppressionModes = filesExist(path.join(folder, 'RNNOISE_NOTICES.txt'))
    ? ['native', 'rnnoise']
    : ['native'];
  let voiceQualityProtocol = filesExist(path.join(folder, 'capabilities.json')) ? 1 : 0;
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
    enabled: available,
    active: Boolean(session),
    engine: 'libwebrtc-m140',
    noiseSuppressionModes,
    voiceQualityProtocol,
    lastStopReason,
  });
  function stop(reason = 'closed') {
    const previous = session;
    if (!previous) return;
    session = undefined;
    lastStopReason = reason;
    clearTimeout(previous.readyTimer);
    previous.readyReject(new Error(`Native voice closed (${reason})`));
    for (const pending of previous.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Native voice closed (${reason})`));
    }
    previous.pending.clear();
    previous.child.stdin.destroy();
    previous.child.kill(); // OS releases microphone even if the native worker hung.
    if (onActiveChanged) onActiveChanged(false);
    else if (!contents.isDestroyed())
      contents.setBackgroundThrottling(previous.backgroundThrottling);
    if (!contents.isDestroyed()) {
      contents.send('cuescord:voice:event', { sessionId: previous.id, type: 'stopped', reason });
    }
  }
  async function start() {
    if (!available) throw new Error('Native voice unavailable');
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
      readyPromise: ready,
      backgroundThrottling: contents.getBackgroundThrottling(),
    };
    session = current;
    // Native audio does not make Chromium audible. Keep authenticated signaling
    // and recovery timers running while the window is minimized.
    if (onActiveChanged) onActiveChanged(true);
    else contents.setBackgroundThrottling(false);
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
    child.stdout.on('error', () => {
      if (session === current) stop('output-error');
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
        if (session !== current) return;
        // A late diagnostic must never terminate capture. Media/control
        // operations still revoke a hung worker within the bounded deadline.
        if (method === 'stats' || method === 'devices') {
          current.pending.delete(id);
          reject(new Error('Native voice diagnostic timed out'));
        } else stop('command-timeout');
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
      // Retain the old enable call for web/desktop compatibility, without a
      // persisted opt-out that can silently override the Windows default.
      if (value !== true || !available) throw new Error('Native voice is selected automatically');
      return status();
    },
    'cuescord:voice:open': async (event) => {
      // Device enumeration can start during account load, just before a join.
      // Finish its temporary session instead of failing the call as "active".
      if (idleDevices) await idleDevices.catch(() => undefined);
      if (!trusted(event)) throw new Error('Untrusted native voice caller');
      return start();
    },
    'cuescord:voice:devices': () => {
      if (idleDevices) return idleDevices;
      if (session) {
        const current = session;
        return current.readyPromise.then(() => request(current.id, 'devices', {}));
      }
      idleDevices = (async () => {
        const ready = await start();
        try {
          return await request(ready.sessionId, 'devices', {});
        } finally {
          if (session?.id === ready.sessionId) stop();
        }
      })().finally(() => {
        idleDevices = undefined;
      });
      return idleDevices;
    },
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
