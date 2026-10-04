const { dialog } = require('electron');
const { appendFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const argument = process.argv.find((value) => value.startsWith('--user-data-dir='));
if (!argument) throw new Error('Shutdown tests require an isolated profile');
const profile = argument.slice('--user-data-dir='.length);
mkdirSync(profile, { recursive: true });
const record = (message) =>
  appendFileSync(path.join(profile, 'shutdown-errors.log'), `${message}\n`);
// Observe real main-process errors and record Electron's error dialog without
// displaying a modal on the developer's desktop. Production handlers are unchanged.
process.on('uncaughtExceptionMonitor', (error) => record(error.stack));
dialog.showErrorBox = (title, content) => record(`${title}: ${content}`);
require('./recovery-native.cjs');
