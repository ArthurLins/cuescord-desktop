import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
const { installPageRecovery } = createRequire(import.meta.url)('../electron/recovery/recovery.cjs');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const trustedUrl = 'https://cuescord.cuesc.net';
const recoveryUrl = 'file:///app/electron/recovery/ui/index.html';
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.isDestroyed = () => false;
  win.isVisible = () => true;
  win.isMinimized = () => false;
  win.show = () => {};
  const loads = [],
    probes = [];
  let healthy = false;
  win.loadURL = async (url) => {
    loads.push(url);
    win.webContents.emit('did-navigate', {}, url, 200);
  };
  const recovery = installPageRecovery({
    window: win,
    trustedUrl,
    recoveryUrl,
    random: () => 0.5,
    fetcher: async (url, options) => {
      probes.push(url);
      assert.equal(options.redirect, 'error');
      return Response.json({ status: 'ok' }, { status: healthy ? 200 : 503 });
    },
  });
  t.after(() => recovery.dispose());
  return {
    win,
    loads,
    probes,
    recovery,
    healthy: () => {
      healthy = true;
    },
  };
}
test('desktop falls back on main-frame failure and restores the exact route after readiness', async (t) => {
  const { win, loads, probes, healthy } = setup(t);
  const target = `${trustedUrl}/channels/room?view=chat#latest`;
  win.webContents.emit('did-navigate-in-page', {}, target, true);
  win.webContents.emit('did-fail-load', {}, -105, 'DNS', target, true);
  assert.deepEqual(loads, [recoveryUrl]);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(loads.length, 1);
  healthy();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(loads.length, 1);
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(loads, [recoveryUrl, target]);
  assert.deepEqual(
    [...new Set(probes)],
    [`${trustedUrl}/health`, `${trustedUrl}/api/health/ready`],
  );
});
test('subframe, cancelled and foreign-origin failures cannot hijack recovery', async (t) => {
  const { win, loads } = setup(t);
  for (const [code, url, main] of [
    [-105, trustedUrl, false],
    [-3, trustedUrl, true],
    [-105, 'https://evil.example', true],
  ]) {
    win.webContents.emit('did-fail-load', {}, code, 'failure', url, main);
  }
  assert.deepEqual(loads, []);
  win.webContents.emit('did-navigate', {}, `${trustedUrl}/friends`, 502);
  assert.deepEqual(loads, [recoveryUrl]);
  win.emit('closed');
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(loads.length, 1);
});
test('reload on the fallback keeps the last trusted route', async (t) => {
  const { win, loads, recovery, healthy } = setup(t);
  const target = `${trustedUrl}/voice/room`;
  win.webContents.emit('did-navigate', {}, target, 200);
  recovery.failed(target);
  healthy();
  await recovery.reload();
  assert.deepEqual(loads, [recoveryUrl]);
  await recovery.reload();
  assert.deepEqual(loads, [recoveryUrl, target]);
});
