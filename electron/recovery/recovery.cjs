const { sameOrigin } = require('../security/policy.cjs');

async function probeServer(fetcher, origin, signal) {
  await Promise.all(
    ['/health', '/api/health/ready'].map(async (pathname) => {
      const response = await fetcher(new URL(pathname, origin).href, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
      });
      if (!response.ok || (await response.json()).status !== 'ok')
        throw new Error('Server unavailable');
    }),
  );
}

// A local page remains usable even when no remote document can be loaded.
function installPageRecovery({
  window,
  trustedUrl,
  recoveryUrl,
  fetcher,
  retryMs = 1000,
  random = Math.random,
}) {
  // BrowserWindow.webContents cannot be read once the window emits 'closed'.
  const contents = window.webContents;
  fetcher ??= (...args) => contents.session.fetch(...args);
  let target = trustedUrl,
    mode = 'remote',
    stopped = false,
    busy = false;
  let attempts = 0,
    successes = 0,
    timer;
  const abort = new AbortController();
  const schedule = (delay) => {
    clearTimeout(timer);
    if (!stopped && mode === 'fallback')
      timer = setTimeout(() => {
        void check();
      }, delay);
  };
  function showFallback(url) {
    if (stopped || window.isDestroyed()) return;
    if (sameOrigin(url, trustedUrl)) target = url;
    if (mode === 'fallback') return;
    mode = 'fallback';
    successes = 0;
    void window.loadURL(recoveryUrl).catch(() => {});
    if (!window.isVisible() && !window.isMinimized()) window.show();
    schedule(retryMs);
  }
  async function check() {
    if (busy || stopped || mode !== 'fallback') return;
    busy = true;
    try {
      await probeServer(fetcher, trustedUrl, abort.signal);
      if (stopped || mode !== 'fallback') return;
      attempts = 0;
      if (++successes < 2) {
        schedule(retryMs);
        return;
      }
      mode = 'loading';
      // Electron keeps the local document visible until this navigation commits.
      await window.loadURL(target);
    } catch {
      if (stopped) return;
      successes = 0;
      attempts++;
      if (mode === 'loading') showFallback(target);
      schedule(Math.min(12000, retryMs * 2 ** Math.min(attempts, 4)) * (0.8 + random() * 0.4));
    } finally {
      busy = false;
    }
  }
  const failed = (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && sameOrigin(url, trustedUrl)) showFallback(url);
  };
  const navigated = (_event, url, status) => {
    if (!sameOrigin(url, trustedUrl)) return;
    target = url;
    if (status >= 500) {
      showFallback(url);
      return;
    }
    mode = 'remote';
    attempts = 0;
    successes = 0;
    clearTimeout(timer);
  };
  const inPage = (_event, url, isMainFrame) => {
    if (isMainFrame && sameOrigin(url, trustedUrl)) target = url;
  };
  contents.on('did-fail-load', failed);
  contents.on('did-navigate', navigated);
  contents.on('did-navigate-in-page', inPage);
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    clearTimeout(timer);
    contents.off('did-fail-load', failed);
    contents.off('did-navigate', navigated);
    contents.off('did-navigate-in-page', inPage);
    contents.off('destroyed', dispose);
    window.off('closed', dispose);
  };
  contents.once('destroyed', dispose);
  window.once('closed', dispose);
  return {
    failed: showFallback,
    dispose,
    async reload() {
      if (stopped) return;
      if (mode === 'fallback') return check();
      try {
        await window.loadURL(target);
      } catch {
        showFallback(target);
      }
    },
  };
}
module.exports = { installPageRecovery, probeServer };
