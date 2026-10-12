import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const { ScreenAudioGrant } = createRequire(import.meta.url)('../electron/audio/grant.cjs');

test('audio permission belongs to one owner, can be claimed once and snapshots its configuration', () => {
  const owner = {};
  const config = { enabled: true, sourceId: 'window:12:0' };
  const grant = new ScreenAudioGrant({ id: 'selected', owner, config, expiresAt: 100 });
  config.enabled = false;
  assert.equal(grant.config.enabled, true);
  assert.equal(grant.claim({}, 50), false);
  assert.equal(grant.claim(owner, 50), true);
  assert.equal(grant.claim(owner, 51), false);
});

test('audio permission expires even when a delayed event-loop timer has not revoked it yet', () => {
  const owner = {};
  const grant = new ScreenAudioGrant({ id: 'selected', owner, config: {}, expiresAt: 100 });
  assert.equal(grant.claim(owner, 100), false);
  assert.equal(grant.claim(owner, 101), false);
});
