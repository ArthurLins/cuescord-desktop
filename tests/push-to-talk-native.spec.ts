import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { PushToTalkBridge } from '../renderer/push-to-talk';
type PttWindow = Window & {
  __CUESCORD_DESKTOP__: {
    pushToTalk: PushToTalkBridge;
    presence: { update(value: object): Promise<void> };
  };
  presses: boolean[];
};

test('Windows sandbox delivers global mouse and keyboard transitions while minimized and hidden', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows global input');
  test.setTimeout(45000);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      '<html><body>PTT fixture' +
        (request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>') +
        '</body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = await _electron.launch({
    args: [
      fileURLToPath(new URL('./fixtures/push-to-talk-native.cjs', import.meta.url)),
      `--user-data-dir=${info.outputPath('profile')}`,
    ],
    env: { ...process.env, CUESCORD_DESKTOP_URL: origin },
  });
  try {
    const page = await client.firstWindow();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean((window as PttWindow).__CUESCORD_DESKTOP__?.pushToTalk)),
      )
      .toBe(true);
    const state = () =>
      page.evaluate(() => (window as PttWindow).__CUESCORD_DESKTOP__.pushToTalk.status());
    expect((await state()).available).toBe(true);
    expect(await page.frames()[1].evaluate(() => '__CUESCORD_DESKTOP__' in window)).toBe(false);
    expect(
      await page.evaluate(() => typeof (window as Window & { require?: unknown }).require),
    ).toBe('undefined');
    // Exercise Koffi inside Electron as well as plain Node, without synthesized OS input.
    expect(
      await client.evaluate(
        () =>
          typeof (
            globalThis as unknown as { pttFixture: { read(code: string): boolean } }
          ).pttFixture.read('KeyV'),
      ),
    ).toBe('boolean');
    await page.evaluate(async () => {
      const desktop = (window as PttWindow).__CUESCORD_DESKTOP__;
      (window as PttWindow).presses = [];
      desktop.pushToTalk.subscribe((value) => (window as PttWindow).presses.push(value.pressed));
      await desktop.presence.update({ unreadCount: 0, inCall: true, microphoneMuted: false });
    });
    for (const shortcut of ['KeyV', 'Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4']) {
      await page.evaluate(async (shortcut) => {
        await (window as PttWindow).__CUESCORD_DESKTOP__.pushToTalk.configure({
          id: shortcut,
          shortcut,
          enabled: true,
          suspended: false,
        });
      }, shortcut);
      await client.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].minimize();
        BrowserWindow.getAllWindows()[0].hide();
      });
      expect(
        await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
      ).toBe(false);
      await client.evaluate((_electron, shortcut) => {
        (
          globalThis as unknown as { pttFixture: { held: Record<string, boolean> } }
        ).pttFixture.held[shortcut] = true;
      }, shortcut);
      await expect.poll(async () => (await state()).pressed).toBe(true);
      await client.evaluate((_electron, shortcut) => {
        (
          globalThis as unknown as { pttFixture: { held: Record<string, boolean> } }
        ).pttFixture.held[shortcut] = false;
      }, shortcut);
      await expect.poll(async () => (await state()).pressed).toBe(false);
      expect(await page.evaluate(() => (window as PttWindow).presses.includes(true))).toBe(true);
    }
    await page.reload();
    await expect.poll(async () => (await state()).global).toBe(false);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
