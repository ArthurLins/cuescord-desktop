const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { utilityProcess } = require('electron');
const { sameOrigin } = require('../security/policy.cjs');

function installAudio({ ipcMain, getWindow, trustedUrl }) {
  let grant;
  let worker;
  let timeout;
  let cleanupOwner;
  const trusted = (event) => {
    try {
      const win = getWindow();
      return (
        win &&
        !win.isDestroyed() &&
        event.sender === win.webContents &&
        !event.sender.isDestroyed() &&
        event.senderFrame === win.webContents.mainFrame &&
        !event.senderFrame.isDestroyed() &&
        sameOrigin(event.senderFrame.url, trustedUrl)
      );
    } catch {
      return false;
    }
  };
  function revoke() {
    clearTimeout(timeout);
    cleanupOwner?.();
    cleanupOwner = undefined;
    const old = worker;
    worker = undefined;
    grant = undefined;
    if (old) {
      try {
        old.postMessage({ type: 'stop' });
      } catch {
        /* Already exited. */
      }
      const kill = setTimeout(() => {
        try {
          old.kill();
        } catch {
          /* Already exited. */
        }
      }, 1500);
      kill.unref();
      old.once('exit', () => clearTimeout(kill));
    }
  }
  function authorize(owner, config) {
    revoke();
    const contents = owner.webContents;
    const frame = contents.mainFrame;
    const id = randomUUID();
    grant = { id, config: { ...config, ownPid: process.pid }, frame, claimed: false };
    const navigation = (_event, _url, inPlace, main) => {
      if (main && !inPlace) revoke();
    };
    contents.on('did-start-navigation', navigation);
    contents.once('render-process-gone', revoke);
    contents.once('destroyed', revoke);
    cleanupOwner = () => {
      contents.removeListener('did-start-navigation', navigation);
      contents.removeListener('render-process-gone', revoke);
      contents.removeListener('destroyed', revoke);
    };
    timeout = setTimeout(revoke, 30_000);
  }
  ipcMain.handle('cuescord:audio:start', async (event) => {
    if (!trusted(event) || !grant || grant.frame !== event.senderFrame || grant.claimed)
      return null;
    const current = grant;
    current.claimed = true;
    if (!current.config.enabled) {
      revoke();
      return null;
    }
    clearTimeout(timeout);
    const child = utilityProcess.fork(path.join(__dirname, 'audio-worker.cjs'), [], {
      serviceName: 'Cuescord — Áudio do compartilhamento',
      stdio: 'pipe',
    });
    worker = child;
    child.stderr?.on('data', (data) => console.error(data.toString().trim()));
    child.stdout?.on('data', (data) => console.log(data.toString().trim()));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(startup);
          resolve(result);
        }
      };
      const startup = setTimeout(() => {
        finish(null);
        if (grant === current) revoke();
      }, 10_000);
      child.on('message', (message) => {
        if (worker !== child || grant !== current || !trusted(event)) return;
        if (message.type === 'ready') finish({ id: current.id });
        if (message.type === 'error') {
          finish(null);
          event.sender.send('cuescord:audio:ended', current.id);
          revoke();
        }
        if (message.type === 'pcm')
          event.sender.send('cuescord:audio:pcm', {
            id: current.id,
            lane: message.lane,
            data: message.data,
          });
      });
      child.once('exit', () => {
        finish(null);
        if (grant === current) {
          if (trusted(event)) event.sender.send('cuescord:audio:ended', current.id);
          revoke();
        }
      });
      child.once('spawn', () => child.postMessage({ type: 'start', config: current.config }));
    });
  });
  ipcMain.on('cuescord:audio:credit', (event, id) => {
    if (trusted(event) && grant?.id === id) worker?.postMessage({ type: 'credit' });
  });
  ipcMain.handle('cuescord:audio:stop', (event, id) => {
    if (trusted(event) && grant?.id === id) revoke();
  });
  return { authorize, revoke };
}

module.exports = { installAudio };
