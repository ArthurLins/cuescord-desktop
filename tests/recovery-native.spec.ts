import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
test.use({ trace: 'retain-on-failure' });

test('real desktop loads local recovery, retains controls and returns to its route', async ({}, testInfo) => {
  test.setTimeout(60000);
  let healthy = false;
  const server = createServer((request, response) => {
    response.writeHead(healthy ? 200 : 503, {
      'Content-Type': request.url?.includes('health') ? 'application/json' : 'text/html',
    });
    response.end(
      request.url?.includes('health')
        ? JSON.stringify({ status: healthy ? 'ok' : 'starting' })
        : '<html><h1>Remote client</h1></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const client = await _electron.launch({
    args: [
      fileURLToPath(new URL('./fixtures/recovery-native.cjs', import.meta.url)),
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
    env: { ...process.env, CUESCORD_DESKTOP_URL: origin },
  });
  try {
    const page = await client.firstWindow();
    await expect(
      page.getByRole('heading', { name: 'Perdemos a conexão com o servidor' }),
    ).toBeVisible();
    expect(page.url()).toContain('/recovery/ui/index.html');
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (window as any).cuescordDesktopAudio)).toBe(
      'undefined',
    );
    if (process.platform === 'win32') {
      await expect(page.getByRole('button', { name: 'Fechar', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Maximizar', exact: true }).click();
      expect(
        await client.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isMaximized(),
        ),
      ).toBe(true);
      await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
    }
    healthy = true;
    await expect(page.getByRole('heading', { name: 'Remote client' })).toBeVisible({
      timeout: 20000,
    });
    const target = `${origin}/channels/room?view=chat#latest`;
    await page.goto(target);
    healthy = false;
    await page.reload().catch(() => {});
    await expect(
      page.getByRole('heading', { name: 'Perdemos a conexão com o servidor' }),
    ).toBeVisible();
    healthy = true;
    await expect(page.getByRole('heading', { name: 'Remote client' })).toBeVisible({
      timeout: 20000,
    });
    expect(page.url()).toBe(target);
    healthy = false;
    await page.reload().catch(() => {});
    await expect(
      page.getByRole('heading', { name: 'Perdemos a conexão com o servidor' }),
    ).toBeVisible();
    if (process.platform === 'win32') {
      await page.getByRole('button', { name: 'Fechar', exact: true }).click();
      await expect
        .poll(() =>
          client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
        )
        .toBe(false);
      expect(page.isClosed()).toBe(false);
    }
  } finally {
    // The Windows Electron launcher can keep its shell alive after window close.
    const process = client.process();
    if (process.exitCode === null) {
      if (globalThis.process.platform === 'win32')
        spawnSync('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      else process.kill('SIGKILL');
    }
    await client.close().catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
