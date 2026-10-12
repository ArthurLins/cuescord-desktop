import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

interface QualityProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
}
interface CapturePickerModel {
  id: string;
  platform: string;
  macAudio?: boolean;
  portal: boolean;
  qualityProfiles: QualityProfile[];
  defaultQuality: string;
}
interface CaptureSelectionOptions {
  kind: 'window' | 'screen';
  quality: string;
  audio: boolean;
  audioApp?: string;
}
interface CaptureSubmission extends CaptureSelectionOptions {
  source: string;
}
interface CaptureHandlers {
  'cuescord:capture:open': (event: object, model: CapturePickerModel) => void;
  'cuescord:capture:close': (event: object, id: string) => void;
}
interface CaptureTestWindow extends Window {
  captureSubmission?: () => CaptureSubmission | undefined;
}

const require = createRequire(import.meta.url);
const {
  screenQualities,
  defaultScreenQuality,
}: {
  screenQualities: QualityProfile[];
  defaultScreenQuality: string;
} = require('../electron/capture/quality.cjs');
const source = readFileSync(
  new URL('../customizations/capture/capture-modal.js', import.meta.url),
  'utf8',
);
const css = readFileSync(
  new URL('../customizations/capture/capture-modal.css', import.meta.url),
  'utf8',
);

async function openPicker(page: Page, model: { platform: string; macAudio?: boolean }) {
  await page.setContent(
    '<!doctype html><html lang="pt-BR"><body style="background:#17181c"><button>Compartilhar tela</button></body></html>',
  );
  await page.evaluate(
    ({ source, css, profiles, defaultQuality, model }) => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) {
        return attach.call(this, { ...options, mode: 'open' });
      };
      const handlers: Partial<CaptureHandlers> = {};
      let submitted: CaptureSubmission | undefined;
      const ipc = {
        on: <Channel extends keyof CaptureHandlers>(
          name: Channel,
          callback: CaptureHandlers[Channel],
        ) => {
          handlers[name] = callback;
        },
        invoke: async (
          name: string,
          id: string,
          value?: string,
          options?: CaptureSelectionOptions,
        ) => {
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
            if (!value || !options)
              throw new Error('Capture fixture requires a source and selection');
            submitted = { source: value, ...options };
            const close = handlers['cuescord:capture:close'];
            if (!close) throw new Error('Capture fixture did not register its close handler');
            close({}, id);
          }
        },
      };
      Object.assign(window, { captureSubmission: () => submitted });
      // eslint-disable-next-line sonarjs/code-eval -- Executes only the checked-in local capture modal source in the isolated test page; no page input or remote script enters this string.
      new Function(`return (${source})`)()(ipc, css);
      const open = handlers['cuescord:capture:open'];
      if (!open) throw new Error('Capture fixture did not register its open handler');
      open({}, { id: 'test', ...model, portal: false, qualityProfiles: profiles, defaultQuality });
    },
    { source, css, profiles: screenQualities, defaultQuality: defaultScreenQuality, model },
  );
}

function readSubmission(page: Page) {
  return page.evaluate(() => {
    const read = (window as CaptureTestWindow).captureSubmission;
    if (!read) throw new Error('Capture fixture has no submission reader');
    const submitted = read();
    if (!submitted) throw new Error('Capture fixture has not submitted a selection');
    return submitted;
  });
}

test('desktop capture picker keeps the chosen quality across source tabs and submits it', async ({
  page,
}, testInfo) => {
  await openPicker(page, { platform: 'win32' });
  const quality = page.getByLabel('Qualidade da transmissão');
  await expect(quality).toHaveValue('1080p30');
  await quality.selectOption('1440p60');
  await page.getByRole('tab', { name: 'Telas', exact: true }).click();
  await page.getByRole('button', { name: 'Tela 1', exact: true }).click();
  await expect(quality).toHaveValue('1440p60');
  await page.screenshot({ path: testInfo.outputPath('screen-quality-picker.png') });
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  const submitted = await readSubmission(page);
  expect(submitted.source).toBe('screen:1');
  expect(submitted.quality).toBe('1440p60');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('macOS picker offers opt-in application and system audio and resets consent on a source-tab change', async ({
  page,
}) => {
  await openPicker(page, { platform: 'darwin', macAudio: true });
  const applicationAudio = page.getByLabel('Compartilhar áudio do aplicativo', { exact: true });
  await expect(applicationAudio).toBeVisible();
  await expect(applicationAudio).not.toBeChecked();
  await applicationAudio.check();
  await page.getByRole('tab', { name: 'Telas', exact: true }).click();
  const systemAudio = page.getByLabel('Compartilhar áudio do sistema', { exact: true });
  await expect(systemAudio).toBeVisible();
  await expect(systemAudio).not.toBeChecked();
  await page.getByRole('tab', { name: 'Janelas', exact: true }).click();
  await applicationAudio.check();
  await page.getByRole('button', { name: 'Editor de texto', exact: true }).click();
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  expect(await readSubmission(page)).toMatchObject({
    source: 'window:1',
    kind: 'window',
    audio: true,
  });
});

test('older macOS versions keep video sharing without advertising unavailable audio', async ({
  page,
}) => {
  await openPicker(page, { platform: 'darwin', macAudio: false });
  await expect(page.getByRole('checkbox')).not.toBeVisible();
  await page.getByRole('tab', { name: 'Telas', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeVisible();
  await page.getByRole('button', { name: 'Tela 1', exact: true }).click();
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  expect(await readSubmission(page)).toMatchObject({
    audio: false,
  });
});
