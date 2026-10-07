import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { NativeVoiceBridge } from '../renderer/native-voice';

test('real sandbox selects native voice automatically and revokes a helper on navigation', async ({}, testInfo) => {
  test.setTimeout(30000);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      `<!doctype html><html><body>Voice test${request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>'}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = await _electron.launch({
    args: [
      fileURLToPath(new URL('./fixtures/media-native.cjs', import.meta.url)),
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
    env: { ...process.env, CUESCORD_DESKTOP_URL: origin },
  });
  try {
    const page = await client.firstWindow();
    const read = () =>
      page.evaluate(async () => {
        const bridge = (
          window as Window & { __CUESCORD_DESKTOP__: { nativeVoice: NativeVoiceBridge } }
        ).__CUESCORD_DESKTOP__.nativeVoice;
        return bridge.status();
      });
    await expect
      .poll(async () => {
        const status = await read();
        return status.enabled === status.available;
      })
      .toBe(true);
    await expect(page.frames()[1].evaluate(() => '__CUESCORD_DESKTOP__' in window)).resolves.toBe(
      false,
    );
    if (!(await read()).available) {
      await expect(
        page.evaluate(async () => {
          const bridge = (window as any).__CUESCORD_DESKTOP__.nativeVoice as NativeVoiceBridge;
          try {
            await bridge.open();
            return false;
          } catch {
            return true;
          }
        }),
      ).resolves.toBe(true);
      return;
    }
    const id = await page.evaluate(async () => {
      const bridge = (window as any).__CUESCORD_DESKTOP__.nativeVoice as NativeVoiceBridge;
      return (await bridge.open()).sessionId;
    });
    expect((await read()).active).toBe(true);
    expect(
      await client.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
      ),
    ).toBe(false);
    await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    // Enumeration initializes WASAPI but never starts recording or playback.
    const devices = await page.evaluate(async (sessionId) => {
      const bridge = (window as any).__CUESCORD_DESKTOP__.nativeVoice as NativeVoiceBridge;
      const rows = await bridge.request<Array<{ kind: string }>>(sessionId, 'devices');
      return rows.every((row) => row.kind === 'audioinput' || row.kind === 'audiooutput');
    }, id);
    expect(devices).toBe(true);
    await page.reload();
    await expect.poll(async () => (await read()).active).toBe(false);
    expect(
      await client.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
      ),
    ).toBe(true);
    expect((await read()).enabled).toBe(true);
    const staleDenied = await page.evaluate(async (sessionId) => {
      const bridge = (window as any).__CUESCORD_DESKTOP__.nativeVoice as NativeVoiceBridge;
      try {
        await bridge.request(sessionId, 'stats');
        return false;
      } catch {
        return true;
      }
    }, id);
    expect(staleDenied).toBe(true);
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
