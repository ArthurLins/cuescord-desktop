const { sameOrigin } = require('../security/policy.cjs');
const { badgePng, callPng } = require('./status-icons.cjs');

function validPresence(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.unreadCount) ||
    value.unreadCount < 0 ||
    typeof value.inCall !== 'boolean' ||
    typeof value.microphoneMuted !== 'boolean'
  )
    throw new Error('Estado do desktop inválido.');
  return {
    unreadCount: value.unreadCount,
    inCall: value.inCall,
    microphoneMuted: value.inCall && value.microphoneMuted,
  };
}

function installDesktopPresence({
  app,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  getWindow,
  ownsContents,
  trustedUrl,
  iconPath,
  platform = process.platform,
}) {
  let quitting = false;
  let nativeVoiceActive = false;
  let state = { unreadCount: 0, inCall: false, microphoneMuted: false };
  const normalIcon = nativeImage.createFromPath(iconPath);
  const callIcons = [false, true].map((muted) => nativeImage.createFromBuffer(callPng(muted)));
  const badges = new Map();
  const tray = new Tray(normalIcon.resize({ width: 32, height: 32 }));

  function show() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  function apply() {
    const window = getWindow();
    const icon = state.inCall ? callIcons[Number(state.microphoneMuted)] : normalIcon;
    const callDescription = state.inCall
      ? ` — Em chamada · microfone ${state.microphoneMuted ? 'desativado' : 'ativado'}`
      : '';
    const description = `Cuescord${callDescription}${state.unreadCount ? ` — ${state.unreadCount} mensagens não lidas` : ''}`;
    tray.setImage(icon.resize({ width: 32, height: 32 }));
    tray.setToolTip(description);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Cuescord', click: show },
        ...(state.inCall
          ? [
              {
                label: `Em chamada · microfone ${state.microphoneMuted ? 'desativado' : 'ativado'}`,
                enabled: false,
              },
            ]
          : []),
        { type: 'separator' },
        { label: 'Fechar Cuescord', click: () => app.quit() },
      ]),
    );
    if (!window || window.isDestroyed()) return;
    // A running audio context can still fall behind while the renderer is in
    // the background, especially under game load. Disable renderer background
    // throttling for calls, including muted calls, and restore it when idle.
    const throttle = !state.inCall && !nativeVoiceActive;
    if (window.webContents.getBackgroundThrottling() !== throttle)
      window.webContents.setBackgroundThrottling(throttle);
    if (platform === 'win32' || platform === 'linux') window.setIcon(icon);
    if (platform === 'win32') {
      const key = Math.min(state.unreadCount, 100);
      if (key && !badges.has(key)) badges.set(key, nativeImage.createFromBuffer(badgePng(key)));
      window.setOverlayIcon(
        key ? badges.get(key) : null,
        state.unreadCount ? `${state.unreadCount} mensagens não lidas` : '',
      );
    }
    if (platform === 'darwin')
      app.dock?.setBadge(state.unreadCount ? String(state.unreadCount) : '');
  }
  function reset() {
    state = { unreadCount: 0, inCall: false, microphoneMuted: false };
    apply();
  }
  function attach(window) {
    window.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      window.hide();
    });
    // Windows shutdown and an explicit app quit must not be cancelled.
    window.on('session-end', () => {
      quitting = true;
    });
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) reset();
    });
    window.webContents.on('render-process-gone', reset);
    // Explorer may restart while the app stays alive.
    window.on('show', apply);
    apply();
  }
  ipcMain.handle('cuescord:desktop:presence', (event, value) => {
    if (
      !ownsContents(event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      !sameOrigin(event.senderFrame.url, trustedUrl)
    )
      throw new Error('Janela não autorizada.');
    const next = validPresence(value);
    if (
      next.unreadCount === state.unreadCount &&
      next.inCall === state.inCall &&
      next.microphoneMuted === state.microphoneMuted
    )
      return;
    state = next;
    apply();
  });
  tray.on('click', show);
  tray.on('double-click', show);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => tray.destroy());
  apply();
  return {
    attach,
    show,
    setNativeVoiceActive(active) {
      nativeVoiceActive = active;
      apply();
    },
  };
}

module.exports = { installDesktopPresence, validPresence };
