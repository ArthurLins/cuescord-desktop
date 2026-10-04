import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('desktop captures microphone without camera and refuses subframes and other windows', async ({}, testInfo) => {
  test.setTimeout(60000);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      '<!doctype html><html><body><h1>Media permissions</h1>' +
        (request.url === '/frame'
          ? ''
          : '<iframe src="/frame" allow="microphone; camera"></iframe>') +
        '</body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = await _electron.launch({
    args: [
      fileURLToPath(new URL('./fixtures/media-native.cjs', import.meta.url)),
      `--user-data-dir=${testInfo.outputPath('profile')}`,
      ...(process.env.CUESCORD_TEST_AUDIO_SERVER ? [] : ['--use-fake-device-for-media-stream']),
    ],
    env: { ...process.env, CUESCORD_DESKTOP_URL: origin },
  });
  try {
    const page = await client.firstWindow();
    await expect(page.getByRole('heading', { name: 'Media permissions' })).toBeVisible();
    const capture = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { noiseSuppression: false, echoCancellation: true, autoGainControl: true },
          video: false,
        });
        const kinds = stream.getTracks().map((track) => track.kind);
        stream.getTracks().forEach((track) => track.stop());
        return kinds;
      } catch (error) {
        return (error as Error).name;
      }
    };
    const result = await page.evaluate(capture);
    const permissions = await client.evaluate(() => (globalThis as any).mediaPermissions);
    expect(result, JSON.stringify(permissions)).toEqual(['audio']);
    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'request',
          permission: 'media',
          allowed: true,
          details: expect.objectContaining({ mediaTypes: ['audio'], isMainFrame: true }),
        }),
      ]),
    );
    expect(await page.frames()[1].evaluate(capture)).toBe('NotAllowedError');
    expect(
      await client.evaluate(async ({ BrowserWindow }, origin) => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: {
            partition: 'persist:cuescord',
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await window.loadURL(origin);
          return await window.webContents.executeJavaScript(
            'navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return "allowed"},e=>e.name)',
          );
        } finally {
          window.destroy();
        }
      }, origin),
    ).toBe('NotAllowedError');
  } finally {
    const child = client.process();
    if (child.exitCode === null) {
      if (process.platform === 'win32')
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      else child.kill('SIGKILL');
    }
    await client.close().catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
