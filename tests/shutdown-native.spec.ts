import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

for (const state of ['connected', 'recovering', 'probing']) {
  test(`real desktop quits cleanly while ${state}`, async ({}, testInfo) => {
    test.setTimeout(30000);
    let probes = 0;
    const server = createServer((request, response) => {
      if (request.url?.includes('health')) {
        probes++;
        if (state === 'probing') return;
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'starting' }));
        return;
      }
      response.writeHead(state === 'connected' ? 200 : 503, { 'Content-Type': 'text/html' });
      response.end('<html><h1>Remote client</h1></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const client = await _electron.launch({
      args: [
        fileURLToPath(new URL('./fixtures/shutdown-native.cjs', import.meta.url)),
        `--user-data-dir=${testInfo.outputPath('profile')}`,
      ],
      env: { ...process.env, CUESCORD_DESKTOP_URL: `http://127.0.0.1:${port}` },
    });
    const child = client.process();
    try {
      const page = await client.firstWindow();
      await expect(
        page.getByRole('heading', {
          name: state === 'connected' ? 'Remote client' : 'Perdemos a conexão com o servidor',
        }),
      ).toBeVisible();
      if (state === 'probing') await expect.poll(() => probes).toBe(2);
      await client.close();
      await expect.poll(() => child.exitCode).toBe(0);
      const errors = await readFile(
        testInfo.outputPath('profile', 'shutdown-errors.log'),
        'utf8',
      ).catch((error) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      expect(errors).toBe('');
    } finally {
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
}
