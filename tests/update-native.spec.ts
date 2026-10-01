import { _electron, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
test('real Electron sandbox loads local updater and rejects a different renderer', async () => {
  const client = await _electron.launch({
    args: [fileURLToPath(new URL('./fixtures/update-native.cjs', import.meta.url))],
  });
  try {
    const page = await client.firstWindow();
    await expect(
      page.getByRole('heading', { name: 'Aplicativo em desenvolvimento' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verificar atualização' })).toBeDisabled();
    const state = await page.evaluate(() => (window as any).cuescordUpdates.state());
    expect(state.status).toBe('disabled');
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(
      await client.evaluate(
        async ({ BrowserWindow }, preload) => {
          const window = new BrowserWindow({
            show: false,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              preload,
            },
          });
          await window.loadURL('data:text/html,<html>Foreign renderer</html>');
          const result = await window.webContents.executeJavaScript(
            'window.cuescordUpdates.check().then(() => "unexpected", error => error.message)',
          );
          window.destroy();
          return result;
        },
        fileURLToPath(new URL('../dist/updater-preload.cjs', import.meta.url)),
      ),
    ).toContain('não autorizada');
  } finally {
    await client.close();
  }
});

test('packaged ASAR loads its own isolated UI and preload without a startup check', async () => {
  const archive = fileURLToPath(
    new URL('../release/win-unpacked/resources/app.asar', import.meta.url),
  );
  test.skip(
    process.platform !== 'win32' || !existsSync(archive),
    'Generate Windows installer first',
  );
  const client = await _electron.launch({
    args: [fileURLToPath(new URL('./fixtures/update-native.cjs', import.meta.url))],
    env: { ...process.env, CUESCORD_TEST_ASAR: archive },
  });
  try {
    const page = await client.firstWindow();
    await expect(page.getByRole('heading', { name: 'Pronto para verificar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verificar atualização' })).toBeEnabled();
    expect(page.url()).toContain('/app.asar/electron/update/ui/index.html');
    expect(await page.evaluate(() => (window as any).cuescordUpdates.state())).toEqual({
      status: 'idle',
      currentVersion: '0.4.0',
    });
  } finally {
    await client.close();
  }
});
