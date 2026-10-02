const { sameOrigin } = require('../security/policy.cjs');

function installWindowControls({
  ipcMain,
  getWindow,
  ownsContents,
  trustedUrl,
  openUpdates,
  recoveryUrl,
}) {
  ipcMain.handle('cuescord:window', (event, action) => {
    if (
      !ownsContents(event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      (!sameOrigin(event.senderFrame.url, trustedUrl) &&
        !(typeof recoveryUrl === 'string' && event.senderFrame.url === recoveryUrl))
    ) {
      throw new Error('Janela não autorizada.');
    }
    const window = getWindow();
    switch (action) {
      case 'updates':
        return openUpdates?.();
      case 'minimize':
        return window.minimize();
      case 'pause-image-animations':
        return window.webContents.setImageAnimationPolicy('noAnimation');
      case 'resume-image-animations':
        return window.webContents.setImageAnimationPolicy('animate');
      case 'toggle-maximize':
        return window.isMaximized() ? window.unmaximize() : window.maximize();
      case 'is-maximized':
        return window.isMaximized();
      case 'close':
        return window.close();
      default:
        throw new Error('Ação de janela inválida.');
    }
  });
}

module.exports = { installWindowControls };
