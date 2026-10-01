import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../customizations/titlebar/desktop.js', import.meta.url),
  'utf8',
);
const options = {
  origin: 'https://cuescord.test',
  version: '0.1.0',
  platform: 'windows',
  css: readFileSync(new URL('../customizations/titlebar/desktop.css', import.meta.url), 'utf8'),
  titlebarCss: readFileSync(
    new URL('../customizations/titlebar/titlebar.css', import.meta.url),
    'utf8',
  ),
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      maximized: false,
      calls: [] as string[],
      policies: [] as string[],
      fail: false,
    };
    Object.assign(window, {
      desktopTest: state,
      desktopWindowControls: {
        setImageAnimationPolicy: async (policy: string) => {
          state.policies.push(policy);
        },
        isMaximized: async () => state.maximized,
        minimize: async () => {
          if (state.fail) throw new Error('Denied');
          state.calls.push('minimize');
        },
        toggleMaximize: async () => {
          state.maximized = !state.maximized;
          state.calls.push('maximize');
        },
        updates: async () => {
          state.calls.push('updates');
        },
        close: async () => {
          state.calls.push('close');
        },
      },
    });
  });
  await page.addInitScript({
    content: `(${source})(${JSON.stringify(options)}, window.desktopWindowControls);`,
  });
  await page.route('https://cuescord.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><style>
      * { box-sizing: border-box; } html { height:100%; }
      body { margin:0; min-height:100%; display:flex; flex-direction:column; }
      .h-dvh { height:100dvh; display:flex; flex-direction:column; }
      .h-8 { height:32px; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
      .min-h-dvh { min-height:100dvh; } .min-h-screen { min-height:100vh; }
      .content { flex:1; display:flex; flex-direction:column; } footer { margin-top:auto; }
      :root { --guild-rail:#16161a; --muted-foreground:#a4a4b0; --foreground:#f2f3f5; }
      dialog { padding:24px; } dialog::backdrop { background:#0008; }
      </style></head><body>${
        route.request().url().endsWith('/app')
          ? '<div class="h-dvh"><div class="h-8"><button id="search">Buscar · Ctrl K</button></div><main class="content">Canal<footer>Mensagem</footer></main></div>'
          : '<main class="min-h-screen"><div class="min-h-dvh">Entrar</div></main>'
      }
      <dialog id="modal"><button onclick="this.closest(\'dialog\').close()">Voltar</button></dialog>
      </body></html>`,
    }),
  );
});

test('login keeps the original light DOM and fits below the custom bar', async ({ page }) => {
  await page.goto('https://cuescord.test/');
  await expect(page.getByRole('button', { name: 'Minimizar', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => Array.from(document.body.children).map((el) => el.tagName)),
  ).toEqual(['MAIN', 'DIALOG']);
  const main = await page.locator('main').boundingBox();
  expect(main?.y).toBe(32);
  expect(main?.height).toBe(768);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
});

test('hidden windows pause motion and restore only animations that were playing', async ({
  page,
}) => {
  await page.goto('https://cuescord.test/app');
  await page.evaluate(() => {
    const target = document.querySelector('main')!;
    const running = target.animate([{ opacity: 0.5 }, { opacity: 1 }], {
      duration: 1000,
      iterations: Infinity,
    });
    const paused = target.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(1px)' }],
      { duration: 1000, iterations: Infinity },
    );
    paused.pause();
    Object.assign(window, { motionTest: { running, paused } });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(
    await page.evaluate(() => document.getAnimations().map((animation) => animation.playState)),
  ).toEqual(['paused', 'paused']);
  expect(await page.locator('main').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
    '0s',
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(
    await page.evaluate(() => document.getAnimations().map((animation) => animation.playState)),
  ).toEqual(['running', 'paused']);
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopTest: { policies: string[] } }).desktopTest.policies,
    ),
  ).toEqual(['animate', 'noAnimation', 'animate']);
});

test('window controls dispatch native actions and update maximize/restore state', async ({
  page,
}) => {
  await page.goto('https://cuescord.test/');
  await page.getByRole('button', { name: 'Maximizar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restaurar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Maximizar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Minimizar', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopTest: { calls: string[] } }).desktopTest.calls,
    ),
  ).toEqual(['maximize', 'maximize', 'minimize', 'close']);
});

test('background mode pauses silent video while keeping audible media untouched', async ({
  page,
}) => {
  await page.goto('https://cuescord.test/app');
  const result = await page.evaluate(async () => {
    const makeMedia = (tag: 'audio' | 'video', muted: boolean) => {
      const media = document.createElement(tag);
      const state = { paused: false, pauses: 0, plays: 0 };
      media.muted = muted;
      Object.defineProperty(media, 'paused', { get: () => state.paused });
      media.pause = () => {
        state.paused = true;
        state.pauses++;
      };
      media.play = async () => {
        state.paused = false;
        state.plays++;
      };
      document.body.append(media);
      return state;
    };
    const silent = makeMedia('video', true);
    const videoWithAudio = makeMedia('video', false);
    const callAudio = makeMedia('audio', false);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hidden = {
      silent: { ...silent },
      videoWithAudio: { ...videoWithAudio },
      callAudio: { ...callAudio },
    };
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    return { hidden, restored: silent };
  });
  expect(result.hidden.silent.pauses).toBe(1);
  expect(result.hidden.videoWithAudio.pauses).toBe(0);
  expect(result.hidden.callAudio.pauses).toBe(0);
  expect(result.restored.plays).toBe(1);
});

test('authenticated shell shares the existing row and keeps search clickable', async ({ page }) => {
  await page.goto('https://cuescord.test/app');
  await page.locator('#search').click();
  await expect(page.locator('#search')).toBeFocused();
  expect((await page.locator('.h-dvh').boundingBox())?.y).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator('#search').click();
  await expect(page.getByRole('button', { name: 'Fechar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(600);
});

test('window buttons remain outside the native drag regions', async ({ page }) => {
  await page.goto('https://cuescord.test/');
  expect(
    await page
      .locator('.desktop-drag-left')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')),
  ).toBe('drag');
  expect(
    await page
      .locator('.desktop-window-controls')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')),
  ).toBe('no-drag');
  await page.getByRole('button', { name: 'Minimizar', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopTest: { calls: string[] } }).desktopTest.calls,
    ),
  ).toEqual(['minimize']);
});

test('native failures are handled and reported accessibly', async ({ page }) => {
  await page.goto('https://cuescord.test/');
  await page.evaluate(() => {
    (window as unknown as { desktopTest: { fail: boolean } }).desktopTest.fail = true;
  });
  await page.getByRole('button', { name: 'Minimizar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Não foi possível controlar a janela');
});

test('window controls remain usable above a modal and return when it closes', async ({ page }) => {
  await page.goto('https://cuescord.test/app');
  await page.locator('#modal').evaluate((dialog: HTMLDialogElement) => dialog.showModal());
  await page.getByRole('button', { name: 'Minimizar', exact: true }).click();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.getByRole('button', { name: 'Maximizar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restaurar', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopTest: { calls: string[] } }).desktopTest.calls,
    ),
  ).toEqual(['minimize', 'maximize']);
  expect(await page.locator('#modal').evaluate((dialog) => dialog.children.length)).toBe(1);
});

test('update button opens native updates above a modal', async ({ page }) => {
  await page.goto('https://cuescord.test/app');
  await page.locator('#modal').evaluate((dialog: HTMLDialogElement) => dialog.showModal());
  await page.getByRole('button', { name: 'Atualizações do Cuescord', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopTest: { calls: string[] } }).desktopTest.calls,
    ),
  ).toEqual(['updates']);
});
