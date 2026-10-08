import { _electron, expect, test } from '@playwright/test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createApplicationBundle } = require('../electron/update/application.cjs');

for (const packaged of [false, true]) {
  test(`real Electron ${packaged ? 'packaged' : 'source'} updater extracts, marks, verifies and stages ASAR bytes`, async ({}, testInfo) => {
    test.skip(process.platform !== 'win32', 'Windows application update and Internet marks');
    const archive = fileURLToPath(
      new URL('../release/win-unpacked/resources/app.asar', import.meta.url),
    );
    if (process.env.CUESCORD_REQUIRE_APPLICATION_TEST === '1')
      expect(existsSync(archive)).toBe(true);
    test.skip(!existsSync(archive), 'Generate Windows installer first');
    const payload = testInfo.outputPath('payload');
    await mkdir(path.join(payload, 'resources/updater'), { recursive: true });
    await mkdir(path.join(payload, 'resources/app.asar.unpacked'), { recursive: true });
    await copyFile(archive, path.join(payload, 'resources/app.asar'));
    await writeFile(
      path.join(payload, 'resources/app.asar.unpacked/fixture.node'),
      'native module bytes, not loaded',
    );
    await writeFile(
      path.join(payload, 'resources/updater/cuescord-update.exe'),
      'helper bytes, not launched',
    );
    await writeFile(path.join(payload, 'Cuescord.exe'), 'executable bytes, not launched');
    const source = testInfo.outputPath('application.cua');
    await createApplicationBundle(payload, source, '0.5.0');
    const install = testInfo.outputPath('installed');
    await mkdir(path.join(install, 'resources/updater'), { recursive: true });
    await copyFile(
      path.join(payload, 'resources/updater/cuescord-update.exe'),
      path.join(install, 'resources/updater/cuescord-update.exe'),
    );
    const cacheRoot = testInfo.outputPath('updates');
    await mkdir(cacheRoot);
    const client = await _electron.launch({
      args: [
        fileURLToPath(new URL('./fixtures/application-native.cjs', import.meta.url)),
        `--user-data-dir=${testInfo.outputPath('profile')}`,
      ],
      env: { ...process.env, CUESCORD_TEST_APPLICATION_ASAR: packaged ? archive : '' },
    });
    try {
      const result = await client.evaluate(
        async (_, options) => (globalThis as any).applicationTest(options),
        {
          source,
          destination: testInfo.outputPath('extracted'),
          version: '0.5.0',
          install,
          cacheRoot,
        },
      );
      expect(result.copied).toEqual({ size: result.original.size, sha512: result.original.sha512 });
      expect(result.marks).toHaveLength(2);
      for (const mark of result.marks) expect(mark).toContain('ZoneId=3');
      expect(result.packageVersion).toBe(result.ordinary);
      expect(result.noAsarUnchanged).toBe(true);
      expect(result.rejection).toContain('alterados');
    } finally {
      await client.close();
    }
  });
}
