const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, dialog, shell } = require('electron');
const { DesktopUpdater } = require('./updater.cjs');
const { keys } = require('./trusted-keys.json');
const {
  prepareApplication,
  launchApplication,
  discardApplication,
} = require('./windows-application.cjs');

function installUpdates({ app, ipcMain, getWindow }) {
  let window;
  const uiPath = path.join(__dirname, 'ui/index.html');
  const uiUrl = pathToFileURL(uiPath).href;
  const authorized = (event) => {
    try {
      return (
        window &&
        !window.isDestroyed() &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame &&
        !event.senderFrame.isDestroyed() &&
        event.senderFrame.url === uiUrl
      );
    } catch {
      return false;
    }
  };
  const updater = new DesktopUpdater({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    cacheRoot: path.join(app.getPath('userData'), 'updates'),
    keys,
    packaged: app.isPackaged,
    confirmInstall: async (version, platform, applicationUpdate) => {
      if (!window || window.isDestroyed()) return false;
      const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Atualizar Cuescord',
        message: applicationUpdate
          ? `Atualizar e reiniciar para a versão ${version}?`
          : `Abrir a atualização ${version}?`,
        detail: applicationUpdate
          ? 'O Cuescord aplicará a atualização e reiniciará automaticamente. Encerre suas chamadas antes de continuar.'
          : platform === 'win32'
            ? 'O download foi verificado. O Cuescord será fechado para abrir o instalador; encerre suas chamadas antes de continuar. O Windows pode mostrar “publicador desconhecido”.'
            : 'O download foi verificado. Conclua a instalação no sistema e reinicie o Cuescord. Encerre suas chamadas antes de substituir o aplicativo.',
        buttons: [
          'Cancelar',
          applicationUpdate
            ? 'Atualizar e reiniciar'
            : platform === 'win32'
              ? 'Instalar atualização'
              : 'Abrir instalador',
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return response === 1;
    },
    openInstaller: (file) => shell.openPath(file),
    applyApplication:
      process.platform === 'win32' && app.isPackaged
        ? async (ready, canInstall) => {
            const prepared = await prepareApplication({
              ready,
              executable: process.execPath,
              cacheRoot: path.join(app.getPath('userData'), 'updates'),
            });
            let child;
            try {
              if (!canInstall()) throw new Error('A janela de atualização foi encerrada.');
              child = await launchApplication(prepared);
              if (!canInstall()) throw new Error('A janela de atualização foi encerrada.');
            } catch (error) {
              child?.kill();
              await discardApplication(prepared);
              throw error;
            }
          }
        : undefined,
    onInstalled: (platform) => {
      if (platform === 'win32') app.quit();
    },
  });
  updater.on('state', (state) => {
    if (window && !window.isDestroyed()) window.webContents.send('cuescord:updates:state', state);
  });
  ipcMain.handle('cuescord:updates:action', (event, action, ...extra) => {
    if (!authorized(event) || extra.length) throw new Error('Atualização não autorizada.');
    switch (action) {
      case 'state':
        return updater.getState();
      case 'check':
        return updater.check();
      case 'download':
        return updater.download();
      case 'cancel':
        return updater.cancel();
      case 'install':
        return updater.install(() => authorized(event));
      default:
        throw new Error('Ação de atualização inválida.');
    }
  });

  function show() {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return;
    }
    const owner = getWindow();
    window = new BrowserWindow({
      title: 'Atualizações do Cuescord',
      width: 520,
      height: 440,
      minWidth: 420,
      minHeight: 400,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#202126',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        preload: path.join(__dirname, '../../dist/updater-preload.cjs'),
      },
    });
    const current = window;
    current.removeMenu();
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    current.webContents.on('will-navigate', (event) => event.preventDefault());
    current.webContents.on('will-redirect', (event) => event.preventDefault());
    current.webContents.on('will-attach-webview', (event) => event.preventDefault());
    current.once('ready-to-show', () => current.show());
    current.once('closed', () => {
      if (window === current) window = undefined;
      updater.cancel();
    });
    void current.loadFile(uiPath).catch(() => current.close());
  }
  app.on('before-quit', () => updater.cancel());
  return { show };
}

module.exports = { installUpdates };
