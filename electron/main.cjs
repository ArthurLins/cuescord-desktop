const { installWindowControls } = require('./window/window-controls.cjs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  session,
  ipcMain,
  shell,
  systemPreferences,
  desktopCapturer,
} = require('electron');
const { PRODUCTION_URL, appUrl, sameOrigin, externalUrl } = require('./security/policy.cjs');
const { installPermissions } = require('./security/permissions.cjs');
const { installCapture } = require('./capture/capture.cjs');
const { installAudio } = require('./audio/audio.cjs');

app.setName('Cuescord');
app.setAppUserModelId('net.cuesc.cuescord');
const trustedUrl = appUrl(
  app.isPackaged ? PRODUCTION_URL : process.env.CUESCORD_DESKTOP_URL || PRODUCTION_URL,
  !app.isPackaged,
);
let mainWindow;

function openExternal(url) {
  if (externalUrl(url))
    void shell.openExternal(url).catch((error) => console.error('Falha ao abrir link:', error));
}

function createWindow(appSession) {
  const win = new BrowserWindow({
    title: 'Cuescord Desktop',
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#16161a',
    frame: process.platform !== 'win32',
    icon: path.join(__dirname, '../assets/icons/128x128@2x.png'),
    autoHideMenuBar: true,
    webPreferences: {
      session: appSession,
      preload: path.join(__dirname, '../dist/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
      backgroundThrottling: true,
      additionalArguments: [`--cuescord-origin=${encodeURIComponent(new URL(trustedUrl).origin)}`],
    },
  });
  mainWindow = win;
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, trustedUrl)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && !sameOrigin(url, trustedUrl)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, trustedUrl)) void win.loadURL(url).catch(console.error);
    else openExternal(url);
    return { action: 'deny' };
  });
  win.once('ready-to-show', () => win.show());
  win.once('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  // Keep reload available even while the initial page cannot be reached.
  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      (((input.control || input.meta) && input.key.toLowerCase() === 'r') || input.key === 'F5')
    ) {
      event.preventDefault();
      void win
        .loadURL(
          sameOrigin(win.webContents.getURL(), trustedUrl) ? win.webContents.getURL() : trustedUrl,
        )
        .catch(console.error);
    }
  });
  void win.loadURL(trustedUrl).catch((error) => {
    console.error('Falha ao carregar o Cuescord:', error);
    if (!win.isDestroyed()) win.show();
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app
    .whenReady()
    .then(() => {
      const appSession = session.fromPartition('persist:cuescord');
      const ownsContents = (contents) =>
        mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
      installPermissions(appSession, trustedUrl, ownsContents, systemPreferences);
      // Local utility windows have no reason to access devices or privileged web APIs.
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      const audio = installAudio({ ipcMain, getWindow: () => mainWindow, trustedUrl });
      installCapture({
        session: appSession,
        desktopCapturer,
        ipcMain,
        getWindow: () => mainWindow,
        trustedUrl,
        audio,
      });
      app.on('before-quit', audio.revoke);
      installWindowControls({ ipcMain, getWindow: () => mainWindow, ownsContents, trustedUrl });
      Menu.setApplicationMenu(
        process.platform === 'darwin'
          ? Menu.buildFromTemplate([
              { role: 'appMenu' },
              { role: 'editMenu' },
              { role: 'viewMenu' },
              { role: 'windowMenu' },
            ])
          : null,
      );
      createWindow(appSession);
      app.on('activate', () => {
        if (!mainWindow) createWindow(appSession);
      });
    })
    .catch((error) => {
      console.error(error);
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
