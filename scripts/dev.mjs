import './build.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PRODUCTION_URL, appUrl } = require('../electron/policy.cjs');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const url = appUrl(process.env.CUESCORD_DESKTOP_URL ||
  (process.argv[2] === 'existing' ? 'http://localhost:3000' : PRODUCTION_URL), true);
const env = { ...process.env, CUESCORD_DESKTOP_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = spawn(require('electron'), [cwd], { cwd, env, stdio: 'inherit' });
desktop.on('error', error => { console.error(error); process.exitCode = 1; });
desktop.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (desktop.exitCode === null) desktop.kill(signal); });
}
