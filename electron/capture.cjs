const { randomUUID } = require('node:crypto');
const { sameOrigin } = require('./policy.cjs');

function installCapture({ session, desktopCapturer, ipcMain, getWindow, trustedUrl, audio }) {
  let pending;
  function authorized(event, id) {
    try {
      return pending && pending.id === id && pending.valid()
        && event.sender === pending.contents && event.senderFrame === pending.frame;
    } catch { return false; }
  }
  async function audioApps(entry) {
    if (process.platform !== 'linux') return;
    try { entry.audioApps = await require('./audio-linux.cjs').listAudioApps(process.pid); }
    catch (error) { console.error('Listagem de aplicativos de áudio:', error); }
  }
  ipcMain.handle('cuescord:capture:sources', async (event, id, kind) => {
    if (!authorized(event, id) || !['window', 'screen'].includes(kind)) throw new Error('Seletor não autorizado.');
    const entry = pending;
    // Serialize portal requests when the user changes tabs while a request is pending.
    entry.loading = (entry.loading || Promise.resolve()).catch(() => {}).then(async () => {
      if (!authorized(event, id)) throw new Error('Seletor encerrado.');
      if (!entry.sources.has(kind)) {
        const sources = await desktopCapturer.getSources({ types: [kind], thumbnailSize: { width: 360, height: 202 } });
        entry.sources.set(kind, entry.portal ? sources : sources.filter(source => source.id.startsWith(`${kind}:`)));
      }
      await audioApps(entry);
    });
    await entry.loading;
    if (!authorized(event, id)) throw new Error('Seletor encerrado.');
    return {
      audioApps: entry.audioApps.map(({ id, name }) => ({ id, name })),
      sources: entry.sources.get(kind).map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() })),
    };
  });
  ipcMain.handle('cuescord:capture:audio-apps', async (event, id) => {
    if (!authorized(event, id)) throw new Error('Seletor não autorizado.');
    const entry = pending;
    await audioApps(entry);
    if (!authorized(event, id)) throw new Error('Seletor encerrado.');
    return entry.audioApps.map(({ id, name }) => ({ id, name }));
  });
  ipcMain.handle('cuescord:capture:select', (event, id, sourceId, options = {}) => {
    if (!authorized(event, id)) throw new Error('Seletor não autorizado.');
    const kind = options.kind;
    const source = pending.sources.get(kind)?.find(item => item.id === sourceId);
    if (!['window', 'screen'].includes(kind) || !source) throw new Error('Fonte de captura inválida.');
    const audioApp = kind === 'window' && options.audioApp ? pending.audioApps.find(item => item.id === options.audioApp) : undefined;
    if (options.audioApp && !audioApp) throw new Error('Aplicativo de áudio inválido.');
    if (pending.portal && kind === 'window' && !audioApp) throw new Error('Selecione o aplicativo de áudio.');
    pending.finish(source, { kind, audioApp, enabled: kind === 'window' || options.audio === true });
  });
  ipcMain.handle('cuescord:capture:cancel', (event, id) => {
    if (authorized(event, id)) pending.finish();
  });

  session.setDisplayMediaRequestHandler((request, callback) => {
    const owner = getWindow();
    const frame = request.frame;
    const valid = () => owner && !owner.isDestroyed() && frame && !frame.isDestroyed()
      && frame === owner.webContents.mainFrame && sameOrigin(frame.url, trustedUrl);
    if (pending || !request.videoRequested || !request.userGesture || !valid()) return callback({});
    const contents = owner.webContents;
    const entry = {
      id: randomUUID(), sources: new Map(), audioApps: [], contents, frame, valid,
      portal: process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY)),
      finish: null,
    };
    let finished = false;
    entry.finish = (source, selection) => {
      if (finished) return;
      finished = true;
      const permitted = valid();
      pending = undefined;
      owner.removeListener('closed', cancel);
      contents.removeListener('did-start-navigation', cancelOnNavigation);
      contents.removeListener('render-process-gone', cancel);
      if (!contents.isDestroyed()) contents.send('cuescord:capture:close', entry.id);
      if (source && permitted) audio.authorize(owner, {
        ...selection, sourceId: source.id,
        enabled: Boolean(request.audioRequested && selection?.enabled && ['win32', 'linux'].includes(process.platform)),
      });
      try { callback(source && permitted ? { video: source } : {}); }
      catch (error) { console.error('A solicitação de captura foi encerrada:', error); }
    };
    const cancel = () => entry.finish();
    const cancelOnNavigation = (_event, _url, inPlace, main) => { if (main && !inPlace) cancel(); };
    pending = entry;
    owner.once('closed', cancel);
    contents.on('did-start-navigation', cancelOnNavigation);
    contents.once('render-process-gone', cancel);
    contents.send('cuescord:capture:open', { id: entry.id, platform: process.platform, portal: entry.portal });
  });
}

module.exports = { installCapture };
