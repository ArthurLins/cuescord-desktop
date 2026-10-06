import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { recoverVoiceTransport } from '../renderer/voice-transport-recovery.ts';

class Transport extends EventEmitter {
  closed = false;
  connectionState = 'connected';
  change(state) {
    this.connectionState = state;
    this.emit('connectionstatechange', state);
  }
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test('failed candidate rounds can recover later without extending the total deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = new Transport();
  const abort = new AbortController();
  let restarts = 0,
    rejoins = 0;
  recoverVoiceTransport(
    transport,
    abort.signal,
    async () => {
      restarts++;
      transport.change('connecting');
    },
    () => {
      rejoins++;
    },
  );
  t.after(() => abort.abort());
  transport.change('failed');
  t.mock.timers.tick(1);
  await flush();
  t.mock.timers.tick(15000);
  transport.change('failed');
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(restarts, 2);
  transport.change('connected');
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(rejoins, 0);
  transport.change('failed');
  t.mock.timers.tick(1);
  await flush();
  t.mock.timers.tick(15000);
  transport.change('failed');
  t.mock.timers.tick(1000);
  await flush();
  t.mock.timers.tick(14000);
  await flush();
  assert.equal(rejoins, 1, 'a retry must not reset the original 30 second deadline');
});

test('repeated disconnected events cannot delay recovery indefinitely', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = new Transport();
  const abort = new AbortController();
  let restarts = 0;
  recoverVoiceTransport(
    transport,
    abort.signal,
    async () => {
      restarts++;
    },
    () => {},
  );
  t.after(() => abort.abort());
  transport.change('disconnected');
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(1000);
    transport.change('disconnected');
    await flush();
  }
  assert.equal(restarts, 1);
});

test('a transport closed during the grace period cannot leave a silent call', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = new Transport();
  let rejoins = 0;
  recoverVoiceTransport(
    transport,
    new AbortController().signal,
    async () => assert.fail('closed transport'),
    () => {
      rejoins++;
    },
  );
  transport.change('disconnected');
  transport.closed = true;
  t.mock.timers.tick(4000);
  await flush();
  assert.equal(rejoins, 1);
});
