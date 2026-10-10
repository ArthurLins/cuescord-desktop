const { sameOrigin } = require('../security/policy.cjs');
const { validPushToTalkShortcut } = require('../../renderer/push-to-talk-binding.cjs');
const { createWindowsInput } = require('./windows-input.cjs');

function installPushToTalk({
  app,
  ipcMain,
  powerMonitor,
  window,
  trustedUrl,
  platform = process.platform,
  createInput = createWindowsInput,
  onPressed = () => {},
  schedule = setInterval,
  cancel = clearInterval,
}) {
  const contents = window.webContents;
  let input,
    checked = false,
    timer,
    locked = false,
    sleeping = false,
    waitingForRelease = true;
  let config = { id: '', enabled: false, shortcut: 'KeyV', suspended: false };
  let pressed = false;
  let sequence = 0;
  function available() {
    if (!checked) {
      checked = true;
      if (platform === 'win32')
        try {
          input = createInput();
        } catch {
          /* Focused fallback. */
        }
    }
    return Boolean(input);
  }
  const snapshot = () => ({
    id: config.id,
    available: available(),
    global: Boolean(input && config.enabled),
    pressed,
    sequence,
  });
  function publish(value, force = false) {
    if (pressed === value && !force) return;
    pressed = value;
    sequence++;
    onPressed(value);
    if (!contents.isDestroyed()) contents.send('cuescord:ptt:event', snapshot());
  }
  function poll() {
    if (!config.enabled || config.suspended || locked || sleeping) return;
    let down;
    try {
      down = input.isDown(config.shortcut);
    } catch {
      down = false;
    }
    if (!down) waitingForRelease = false;
    publish(Boolean(down && !waitingForRelease));
  }
  function configure(value) {
    if (
      !value ||
      typeof value.id !== 'string' ||
      !value.id ||
      value.id.length > 128 ||
      typeof value.enabled !== 'boolean' ||
      typeof value.suspended !== 'boolean' ||
      !validPushToTalkShortcut(value.shortcut)
    )
      throw new Error('Invalid push to talk configuration');
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    config = {
      id: value.id,
      enabled: value.enabled,
      shortcut: value.shortcut,
      suspended: value.suspended,
    };
    waitingForRelease = true;
    publish(false, true);
    if (available() && config.enabled && !config.suspended && !locked && !sleeping) {
      poll();
      timer = schedule(poll, 8);
      timer?.unref?.();
    }
    return snapshot();
  }
  function release(id = config.id) {
    if (id !== config.id) return snapshot();
    return configure({ ...config, id: config.id || 'released', enabled: false });
  }
  const trusted = (event) =>
    !window.isDestroyed() &&
    event.sender === contents &&
    !contents.isDestroyed() &&
    event.senderFrame === contents.mainFrame &&
    !event.senderFrame.isDestroyed() &&
    sameOrigin(event.senderFrame.url, trustedUrl);
  const channels = {
    'cuescord:ptt:status': () => snapshot(),
    'cuescord:ptt:configure': (_event, value) => configure(value),
    'cuescord:ptt:release': (_event, id) => release(id),
  };
  for (const [channel, handler] of Object.entries(channels))
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted push to talk caller');
      return handler(event, ...args);
    });
  const pause = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    waitingForRelease = true;
    publish(false, true);
  };
  const restart = () => {
    configure(config.id ? config : { ...config, id: 'idle' });
  };
  const lock = () => {
    locked = true;
    pause();
  };
  const suspend = () => {
    sleeping = true;
    pause();
  };
  const unlock = () => {
    locked = false;
    restart();
  };
  const resume = () => {
    sleeping = false;
    restart();
  };
  const navigation = (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) release();
  };
  const reset = () => release();
  contents.on('did-start-navigation', navigation);
  contents.on('render-process-gone', reset);
  app.on('before-quit', reset);
  powerMonitor.on('lock-screen', lock);
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('unlock-screen', unlock);
  powerMonitor.on('resume', resume);
  contents.once('destroyed', () => {
    release();
    contents.removeListener('did-start-navigation', navigation);
    contents.removeListener('render-process-gone', reset);
    app.removeListener('before-quit', reset);
    powerMonitor.removeListener('lock-screen', lock);
    powerMonitor.removeListener('suspend', suspend);
    powerMonitor.removeListener('unlock-screen', unlock);
    powerMonitor.removeListener('resume', resume);
    for (const channel of Object.keys(channels)) ipcMain.removeHandler(channel);
  });
  return { snapshot, release };
}
module.exports = { installPushToTalk };
