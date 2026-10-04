import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('macOS policy opens the real desktop screen picker without camera or microphone consent', async ({}, testInfo) => {
  test.setTimeout(30000);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><html><body><button id="share">Share test screen</button>
      ${request.url === '/frame' ? '' : '<iframe src="/frame" allow="display-capture"></iframe>'}
      <script>
        document.querySelector('#share').onclick = async () => {
          try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            stream.getTracks().forEach(track => track.stop());
            window.captureResult = 'granted';
          } catch (error) { window.captureResult = error.name; }
        };
      </script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = await _electron.launch({
    args: [
      fileURLToPath(new URL('./fixtures/capture-native.cjs', import.meta.url)),
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
    env: { ...process.env, CUESCORD_DESKTOP_URL: origin },
  });
  const child = client.process();
  try {
    const page = await client.firstWindow();
    await page.getByRole('button', { name: 'Share test screen' }).click();
    const picker = page.getByRole('dialog', { name: 'Compartilhar tela', exact: true });
    const permissions = await client.evaluate(() => (globalThis as any).mediaPermissions);
    await expect(picker, JSON.stringify(permissions)).toBeVisible();
    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'request',
          permission: 'media',
          allowed: true,
          details: expect.objectContaining({
            mediaTypes: [],
            securityOrigin: `${origin}/`,
            isMainFrame: true,
          }),
        }),
      ]),
    );
    expect(await client.evaluate(() => (globalThis as any).devicePrompts)).toEqual([]);
    await picker.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).captureResult)).toBe('AbortError');
    const frame = page.frames()[1];
    await frame.getByRole('button', { name: 'Share test screen' }).click();
    await expect
      .poll(() => frame.evaluate(() => (window as any).captureResult))
      .toBe('NotAllowedError');
    await expect(picker).toHaveCount(0);
  } finally {
    await client.close().catch(() => {});
    if (child.exitCode === null) {
      if (process.platform === 'win32')
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      else child.kill('SIGKILL');
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
