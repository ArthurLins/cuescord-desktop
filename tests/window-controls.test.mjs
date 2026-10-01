import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { installWindowControls } = require('../electron/window/window-controls.cjs');

function setup() {
  const actions = [];
  const frame = { url: 'https://cuescord.cuesc.net/channels/1' };
  const contents = { mainFrame: frame, setImageAnimationPolicy: (policy) => actions.push(policy) };
  const window = {
    webContents: contents,
    minimize: () => actions.push('minimize'),
    isMaximized: () => false,
    maximize: () => actions.push('maximize'),
    close: () => actions.push('close'),
  };
  let handle;
  installWindowControls({
    ipcMain: {
      handle: (_channel, callback) => {
        handle = callback;
      },
    },
    getWindow: () => window,
    ownsContents: (sender) => sender === contents,
    trustedUrl: 'https://cuescord.cuesc.net',
    openUpdates: () => actions.push('updates'),
  });
  return { handle, actions, event: { sender: contents, senderFrame: frame } };
}

test('window actions retain their behavior for the trusted main frame', () => {
  const { handle, actions, event } = setup();
  handle(event, 'minimize');
  handle(event, 'toggle-maximize');
  handle(event, 'pause-image-animations');
  handle(event, 'resume-image-animations');
  handle(event, 'close');
  assert.deepEqual(actions, ['minimize', 'maximize', 'noAnimation', 'animate', 'close']);
  assert.equal(handle(event, 'is-maximized'), false);
  assert.throws(() => handle(event, 'unknown'), /Ação de janela inválida/);
});

test('other windows, subframes and origins cannot control the app', () => {
  const { handle, actions, event } = setup();
  assert.throws(() => handle({ ...event, sender: {} }, 'close'), /não autorizada/);
  assert.throws(
    () => handle({ ...event, senderFrame: { ...event.senderFrame } }, 'close'),
    /não autorizada/,
  );
  event.senderFrame.url = 'https://untrusted.example';
  assert.throws(() => handle(event, 'close'), /não autorizada/);
  assert.deepEqual(actions, []);
});

test('trusted window can only open the local update window', () => {
  const { handle, actions, event } = setup();
  handle(event, 'updates');
  assert.deepEqual(actions, ['updates']);
  assert.throws(() => handle({ ...event, sender: {} }, 'updates'), /não autorizada/);
});
