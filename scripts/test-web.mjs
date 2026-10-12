import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The installed host runs the base app's journeys; the web app never locates
// this checkout or resolves its dependencies on its own.
const root = fileURLToPath(new URL('../', import.meta.url));
const web = process.env.CUESCORD_WEB_ROOT || fileURLToPath(new URL('../../web/', import.meta.url));
const requireHost = createRequire(path.join(root, 'package.json'));
const requireWeb = createRequire(path.join(web, 'package.json'));
const playwrightPackage = requireWeb.resolve('playwright/package.json');
const cli = path.join(
  path.dirname(playwrightPackage),
  requireWeb('playwright/package.json').bin.playwright,
);
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [cli, 'test', ...args], {
  cwd: web,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    PLAYWRIGHT_VOICE_DESKTOP: '1',
    CHAT_SCROLL_DESKTOP: 'true',
    PLAYWRIGHT_ELECTRON_EXECUTABLE: requireHost('electron'),
    PLAYWRIGHT_ELECTRON_ENTRY: root,
    PLAYWRIGHT_ELECTRON_RECOVERY_ENTRY: path.join(root, 'tests/fixtures/recovery-native.cjs'),
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
