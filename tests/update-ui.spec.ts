import { expect, test } from '@playwright/test';
import { pathToFileURL, fileURLToPath } from 'node:url';
const location = pathToFileURL(
  fileURLToPath(new URL('../electron/update/ui/index.html', import.meta.url)),
).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 440 });
  await page.addInitScript(() => {
    let listener = (_state: unknown) => {};
    let resolveDownload: (state: unknown) => void;
    const calls: string[] = [];
    const state = (status: string, details = {}) => ({
      status,
      currentVersion: '0.4.0',
      ...details,
    });
    Object.assign(window, {
      updateTest: { calls, emit: (value: unknown) => listener(value) },
      cuescordUpdates: {
        state: async () => state('idle'),
        onState: (callback: typeof listener) => {
          listener = callback;
          return () => {};
        },
        check: async () => {
          calls.push('check');
          const value = state('available', { availableVersion: '0.5.0', size: 10 * 1024 * 1024 });
          listener(value);
          return value;
        },
        download: () => {
          calls.push('download');
          listener(state('downloading', { progress: 50, availableVersion: '0.5.0' }));
          return new Promise((resolve) => {
            resolveDownload = resolve;
          });
        },
        cancel: async () => {
          calls.push('cancel');
          const value = state('idle', { message: 'Operação cancelada.' });
          listener(value);
          resolveDownload(value);
          return value;
        },
        install: async () => {
          calls.push('install');
          return state('opened');
        },
      },
    });
  });
  await page.goto(location);
});

test('updates require explicit check and support cancellable download with progress', async ({
  page,
}) => {
  await expect(page.getByText('Versão instalada: 0.4.0')).toBeVisible();
  expect(await page.evaluate(() => (window as any).updateTest.calls)).toEqual([]);
  await page.getByRole('button', { name: 'Verificar atualização', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Versão 0.5.0 disponível' })).toBeVisible();
  await expect(page.getByText(/Download de 10 MB/)).toBeVisible();
  await page.getByRole('button', { name: 'Baixar atualização' }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '50');
  await expect(page.getByRole('button', { name: 'Verificar atualização' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancelar download' }).click();
  await expect(page.getByRole('button', { name: 'Verificar atualização' })).toBeEnabled();
  await expect(page.getByRole('progressbar')).toBeHidden();
  expect(await page.evaluate(() => (window as any).updateTest.calls)).toEqual([
    'check',
    'download',
    'cancel',
  ]);
});

test('verified installer has an explicit install action and fits minimum window size', async ({
  page,
}) => {
  await page.evaluate(() =>
    (window as any).updateTest.emit({
      status: 'ready',
      currentVersion: '0.4.0',
      availableVersion: '0.5.0',
      progress: 100,
    }),
  );
  await expect(page.getByRole('heading', { name: 'Download verificado' })).toBeVisible();
  await expect(page.getByText(/Encerre suas chamadas/)).toBeVisible();
  await page.setViewportSize({ width: 420, height: 400 });
  const button = page.getByRole('button', { name: 'Instalar atualização' });
  const bounds = await button.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(420);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400);
  await button.click();
  await expect(page.getByRole('heading', { name: 'Instalador aberto' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).updateTest.calls)).toEqual(['install']);
});

test('verification failures render as text and permit retry', async ({ page }) => {
  await page.evaluate(() =>
    (window as any).updateTest.emit({
      status: 'error',
      currentVersion: '0.4.0',
      message: '<img src=x onerror="window.compromised=true">',
    }),
  );
  await expect(page.locator('#message')).toHaveText(
    '<img src=x onerror="window.compromised=true">',
  );
  await expect(page.locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('button', { name: 'Baixar atualização' })).toBeVisible();
});
