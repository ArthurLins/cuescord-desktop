import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { screenQualities, defaultScreenQuality } = require('../electron/capture/quality.cjs');
const source = readFileSync(
  new URL('../customizations/capture/capture-modal.js', import.meta.url),
  'utf8',
);
const css = readFileSync(
  new URL('../customizations/capture/capture-modal.css', import.meta.url),
  'utf8',
);

test('desktop capture picker keeps the chosen quality across source tabs and submits it', async ({
  page,
}, testInfo) => {
  await page.setContent(
    '<!doctype html><html lang="pt-BR"><body style="background:#17181c"><button>Compartilhar tela</button></body></html>',
  );
  await page.evaluate(
    ({ source, css, profiles, defaultQuality }) => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) {
        return attach.call(this, { ...options, mode: 'open' });
      };
      const handlers = new Map();
      let submitted;
      const ipc = {
        on: (name, callback) => handlers.set(name, callback),
        invoke: async (name, id, value, options) => {
          if (name === 'cuescord:capture:sources')
            return {
              audioApps: [],
              sources: [
                {
                  id: `${value}:1`,
                  name: value === 'window' ? 'Editor de texto' : 'Tela 1',
                  thumbnail:
                    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="360" height="202"><rect width="360" height="202" fill="%23373b52"/></svg>',
                },
              ],
            };
          if (name === 'cuescord:capture:select') {
            submitted = { source: value, ...options };
            handlers.get('cuescord:capture:close')({}, id);
          }
        },
      };
      Object.assign(window, { captureSubmission: () => submitted });
      new Function(`return (${source})`)()(ipc, css);
      handlers.get('cuescord:capture:open')(
        {},
        { id: 'test', platform: 'win32', portal: false, qualityProfiles: profiles, defaultQuality },
      );
    },
    { source, css, profiles: screenQualities, defaultQuality: defaultScreenQuality },
  );
  const quality = page.getByLabel('Qualidade da transmissão');
  await expect(quality).toHaveValue('1080p30');
  await quality.selectOption('1440p60');
  await page.getByRole('tab', { name: 'Telas', exact: true }).click();
  await page.getByRole('button', { name: 'Tela 1', exact: true }).click();
  await expect(quality).toHaveValue('1440p60');
  await page.screenshot({ path: testInfo.outputPath('screen-quality-picker.png') });
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  const submitted = await page.evaluate(() =>
    (
      window as Window & { captureSubmission: () => { source: string; quality: string } }
    ).captureSubmission(),
  );
  expect(submitted.source).toBe('screen:1');
  expect(submitted.quality).toBe('1440p60');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
