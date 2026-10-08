import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('real Windows desktop badges, microphone icons and tray lifecycle', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Windows taskbar integration');
  test.setTimeout(60000);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      request.url === '/frame'
        ? '<html><body>Subframe</body></html>'
        : '<!doctype html><html><body><h1>Desktop presence</h1><iframe src="/frame"></iframe></body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = await _electron.launch({
    args: [
      fileURLToPath(new URL('./fixtures/presence-native.cjs', import.meta.url)),
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
    env: { ...process.env, CUESCORD_DESKTOP_URL: origin },
  });
  const child = client.process();
  try {
    const page = await client.firstWindow();
    await expect(page.getByRole('heading', { name: 'Desktop presence' })).toBeVisible();
    const update = (unreadCount: number, inCall: boolean, microphoneMuted: boolean) =>
      page.evaluate((state) => (window as any).__CUESCORD_DESKTOP__.presence.update(state), {
        unreadCount,
        inCall,
        microphoneMuted,
      });
    const state = () =>
      client.evaluate(() => {
        const { overlay, icon, tooltip, description } = (globalThis as any).presenceTest;
        return { overlay, icon, tooltip, description };
      });
    const throttling = () =>
      client.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
      );
    expect(await throttling()).toBe(true);
    expect(await page.frames()[1].evaluate(() => typeof (window as any).__CUESCORD_DESKTOP__)).toBe(
      'undefined',
    );
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    const normal = await state();
    await update(4, false, false);
    expect((await state()).overlay).not.toBeNull();
    expect((await state()).description).toBe('4 mensagens não lidas');
    await update(140, true, false);
    expect(await throttling()).toBe(false);
    const active = await state();
    expect(active.icon).not.toBe(normal.icon);
    expect(active.tooltip).toContain('microfone ativado');
    await update(140, true, true);
    expect(await throttling()).toBe(false);
    const muted = await state();
    expect(muted.icon).not.toBe(active.icon);
    expect(muted.overlay).toBe(active.overlay);
    expect(muted.tooltip).toContain('microfone desativado');
    for (const [name, data] of [
      ['call-active', active.icon],
      ['call-muted', muted.icon],
      ['unread-99-plus', muted.overlay],
    ])
      await writeFile(testInfo.outputPath(`${name}.png`), Buffer.from(data!, 'base64'));
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect
      .poll(() =>
        client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      )
      .toBe(false);
    expect(page.isClosed()).toBe(false);
    expect(await throttling()).toBe(false);
    // Exercise an outgoing-only audio clock while the native window is hidden,
    // without relying on audible playback to keep the renderer active.
    const hiddenClock = await page.evaluate(async () => {
      const context = new AudioContext({ sampleRate: 48000 });
      const source = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      try {
        await context.resume();
        const startWall = performance.now();
        const startAudio = context.currentTime;
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return (context.currentTime - startAudio) / ((performance.now() - startWall) / 1000);
      } finally {
        source.stop();
        destination.stream.getTracks().forEach((track) => track.stop());
        await context.close();
      }
    });
    expect(hiddenClock).toBeGreaterThan(0.9);
    expect(hiddenClock).toBeLessThan(1.1);
    // Presence updates continue in the same renderer while hidden in the tray.
    await update(3, true, false);
    expect((await state()).tooltip).toContain('3 mensagens não lidas');
    await client.evaluate(() => {
      const tray = (globalThis as any).presenceTest;
      tray.menu.items.find((item: any) => item.label === 'Abrir Cuescord').click();
    });
    await expect
      .poll(() =>
        client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      )
      .toBe(true);
    await update(0, false, false);
    expect(await throttling()).toBe(true);
    expect(await state()).toMatchObject({ icon: normal.icon, overlay: null, tooltip: 'Cuescord' });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Desktop presence' })).toBeVisible();
    expect((await state()).tooltip).toBe('Cuescord');
    expect(await throttling()).toBe(true);
    await client.evaluate(() => {
      const tray = (globalThis as any).presenceTest;
      setImmediate(() =>
        tray.menu.items.find((item: any) => item.label === 'Fechar Cuescord').click(),
      );
    });
    await expect.poll(() => page.isClosed()).toBe(true);
    await expect.poll(() => child.exitCode).toBe(0);
  } finally {
    if (child.exitCode === null)
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    await client.close().catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
