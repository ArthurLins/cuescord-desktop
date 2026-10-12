import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureViolations } from '../scripts/check-architecture.mjs';

test('policies and browser adapters cannot acquire privileged dependencies indirectly', () => {
  const sources = new Map([
    ['electron/capture/selection.cjs', "require('../audio/audio-linux.cjs');"],
    ['electron/audio/audio-linux.cjs', "require('node:child_process');"],
    ['renderer/native-voice.ts', "import privileged from '../electron/audio/audio-linux.cjs';"],
    ['electron/update/updater.cjs', "require('./package-store.cjs');"],
    ['electron/update/package-store.cjs', "require('node:fs');"],
  ]);
  const issues = architectureViolations(sources);
  assert.ok(issues.some((issue) => issue.includes('pure policy cannot import')));
  assert.ok(issues.some((issue) => issue.includes('context internals are private')));
  assert.ok(issues.some((issue) => issue.includes('browser code cannot import')));
  assert.ok(issues.some((issue) => issue.includes('through a port')));
});

test('composition and public pure policies are allowed, but cycles and concealed loaders fail', () => {
  const sources = new Map([
    ['electron/main.cjs', "require('./audio/audio.cjs');"],
    ['electron/audio/audio.cjs', "require('../security/policy.cjs');"],
    ['electron/security/policy.cjs', ''],
  ]);
  assert.deepEqual(architectureViolations(sources), []);
  sources.set('electron/audio/audio.cjs', "require('./worker.cjs'); require(workerPath);");
  sources.set('electron/audio/worker.cjs', "require('./audio.cjs');");
  const issues = architectureViolations(sources);
  assert.ok(issues.some((issue) => issue.includes('cyclic')));
  assert.ok(issues.some((issue) => issue.includes('explicit literal')));
});
