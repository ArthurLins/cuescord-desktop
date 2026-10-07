import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const {
  prepareApplication,
  launchApplication,
} = require('../electron/update/windows-application.cjs');
const { metadata } = require('../electron/update/application.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const helper = path.join(root, '.cache/updater/bin/cuescord-update.exe');
const fixture = path.join(root, '.cache/updater/target/release/update-fixture.exe');
const available = process.platform === 'win32' && existsSync(helper) && existsSync(fixture);
if (process.env.CUESCORD_REQUIRE_UPDATE_TEST === '1' && !available)
  throw new Error('Build the Windows updater before integration acceptance');

async function waitFor(file, predicate) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (predicate(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Transaction did not finish');
}

for (const failStart of [false, true])
  test(
    `real Windows helper: ${failStart ? 'restores old app when new startup fails' : 'waits for app exit, replaces and restarts with profile preserved'}`,
    { skip: !available },
    async (t) => {
      const area = path.join(root, '.cache/updater-tests');
      await mkdir(area, { recursive: true });
      const directory = await mkdtemp(path.join(area, 'isolated-'));
      t.after(() =>
        rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
      );
      const install = path.join(directory, 'Cuescord');
      const applicationDirectory = path.join(directory, 'payload');
      const cacheRoot = path.join(directory, 'profile/updates');
      await mkdir(cacheRoot, { recursive: true });
      await writeFile(path.join(directory, 'profile/preferences.json'), 'profile must survive');
      for (const [location, version] of [
        [install, '0.4.9'],
        [applicationDirectory, '0.5.0'],
      ]) {
        await mkdir(path.join(location, 'resources/updater'), { recursive: true });
        await copyFile(fixture, path.join(location, 'Cuescord.exe'));
        await copyFile(helper, path.join(location, 'resources/updater/cuescord-update.exe'));
        await writeFile(path.join(location, 'resources/app.asar'), 'test application');
        await writeFile(path.join(location, 'version.txt'), version);
      }
      await writeFile(path.join(install, 'Uninstall Cuescord.exe'), 'uninstaller');
      await writeFile(path.join(install, 'old-only.txt'), 'preserved in backup');
      if (failStart) await writeFile(path.join(applicationDirectory, 'fail-start'), 'fail');
      const files = [];
      async function collect(prefix = '') {
        for (const name of (
          await readdir(path.join(applicationDirectory, prefix), { withFileTypes: true })
        ).sort((a, b) => a.name.localeCompare(b.name))) {
          const relative = prefix ? `${prefix}/${name.name}` : name.name;
          if (name.isDirectory()) await collect(relative);
          else
            files.push({
              path: relative,
              ...(await metadata(path.join(applicationDirectory, relative))),
            });
        }
      }
      await collect();
      // Use the same deterministic ordering as the production collector.
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const prepared = await prepareApplication({
        ready: { version: '0.5.0', files, applicationDirectory },
        executable: path.join(install, 'Cuescord.exe'),
        cacheRoot,
      });
      const plan = JSON.parse(await readFile(prepared.file));
      const parent = spawn(path.join(install, 'Cuescord.exe'), ['--wait'], {
        cwd: install,
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      t.after(() => parent.kill());
      const originalAck = process.env.CUESCORD_UPDATE_TEST_ACK;
      process.env.CUESCORD_UPDATE_TEST_ACK = plan.acknowledgement;
      try {
        const worker = await launchApplication(prepared, parent.pid);
        // Production detaches the helper; acceptance must wait for its exit event.
        worker.ref();
        t.after(() => worker.kill());
        const stopped = new Promise((resolve) => worker.once('exit', resolve));
        assert.equal(await readFile(path.join(install, 'version.txt'), 'utf8'), '0.4.9');
        assert.equal(JSON.parse(await readFile(plan.result, 'utf8')).status, 'prepared');
        parent.stdin.end();
        const result = await waitFor(plan.result, (value) =>
          ['complete', 'rolled-back', 'failed'].includes(value.status),
        );
        assert.equal(result.status, failStart ? 'rolled-back' : 'complete');
        await stopped;
        assert.equal(
          await readFile(path.join(install, 'version.txt'), 'utf8'),
          failStart ? '0.4.9' : '0.5.0',
        );
        assert.equal(
          await readFile(path.join(install, 'Uninstall Cuescord.exe'), 'utf8'),
          'uninstaller',
        );
        assert.equal(
          await readFile(path.join(directory, 'profile/preferences.json'), 'utf8'),
          'profile must survive',
        );
        if (!failStart)
          assert.equal(
            await readFile(path.join(plan.backup, 'old-only.txt'), 'utf8'),
            'preserved in backup',
          );
      } finally {
        if (originalAck === undefined) delete process.env.CUESCORD_UPDATE_TEST_ACK;
        else process.env.CUESCORD_UPDATE_TEST_ACK = originalAck;
      }
    },
  );

test(
  'real Windows helper refuses a modified plan before touching the installation',
  { skip: !available },
  async (t) => {
    const area = path.join(root, '.cache/updater-tests');
    await mkdir(area, { recursive: true });
    const directory = await mkdtemp(path.join(area, 'tamper-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const plan = path.join(directory, 'plan.json');
    await writeFile(plan, '{}');
    const digest = createHash('sha512').update('{}').digest('hex');
    await writeFile(plan, '{"tampered":true}');
    const child = spawn(helper, [plan, digest, String(process.pid)], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, 1);
  },
);
