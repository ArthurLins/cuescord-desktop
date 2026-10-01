import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';

const directory = fileURLToPath(new URL('../electron/update/', import.meta.url));
function setup() {
  let handler, updater;
  const windows = [],
    actions = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {
        url: pathToFileURL(path.join(directory, 'ui/index.html')).href,
        isDestroyed: () => false,
      };
      this.webContents.setWindowOpenHandler = (callback) => {
        this.openHandler = callback;
      };
      this.webContents.send = () => {};
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    show() {}
    focus() {}
    removeMenu() {}
    async loadFile(location) {
      assert.equal(location, path.join(directory, 'ui/index.html'));
    }
    close() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  class Updater extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      updater = this;
    }
    getState() {
      actions.push('state');
      return { status: 'idle' };
    }
    check() {
      actions.push('check');
    }
    download() {
      actions.push('download');
    }
    cancel() {
      actions.push('cancel');
    }
    install(authorized) {
      actions.push('install');
      this.authorized = authorized;
    }
  }
  const module = { exports: {} },
    app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true,
    getVersion: () => '0.4.0',
    getPath: () => '/user-data',
    quit: () => actions.push('quit'),
  });
  const electron = {
    BrowserWindow: Window,
    dialog: {
      showMessageBox: async (_parent, options) => {
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 0);
        return { response: 0 };
      },
    },
    shell: { openPath: async () => '' },
  };
  vm.runInNewContext(readFileSync(path.join(directory, 'window.cjs'), 'utf8'), {
    module,
    __dirname: directory,
    process,
    require: (name) =>
      name === 'node:path'
        ? path
        : name === 'node:url'
          ? { pathToFileURL }
          : name === 'electron'
            ? electron
            : name === './updater.cjs'
              ? { DesktopUpdater: Updater }
              : { keys: [] },
  });
  const control = module.exports.installUpdates({
    app,
    ipcMain: {
      handle: (channel, callback) => {
        assert.equal(channel, 'cuescord:updates:action');
        handler = callback;
      },
    },
    getWindow: () => undefined,
  });
  control.show();
  const window = windows[0],
    event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { handler, updater, control, window, windows, event, actions };
}

test('only exact local updater window/main frame has access to update IPC', () => {
  const { handler, window, event, actions } = setup();
  handler(event, 'state');
  handler(event, 'check');
  handler(event, 'download');
  handler(event, 'install');
  handler(event, 'cancel');
  assert.deepEqual(actions, ['state', 'check', 'download', 'install', 'cancel']);
  for (const action of ['state', 'check', 'download', 'install', 'cancel']) {
    assert.throws(() => handler({ ...event, sender: {} }, action), /não autorizada/);
    assert.throws(
      () => handler({ ...event, senderFrame: { ...event.senderFrame } }, action),
      /não autorizada/,
    );
    assert.throws(() => handler(event, action, '/tmp/evil.exe'), /não autorizada/);
  }
  window.webContents.mainFrame.url = 'https://cuescord.cuesc.net';
  assert.throws(() => handler(event, 'install'), /não autorizada/);
});

test('closed/replaced updater sender loses authorization; navigation and new windows are denied', () => {
  const { handler, updater, window, event, control, windows } = setup();
  handler(event, 'install');
  assert.equal(updater.authorized(), true);
  assert.equal(window.openHandler().action, 'deny');
  for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    window.webContents.emit(name, {
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  }
  const preferences = window.options.webPreferences;
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webviewTag, false);
  window.close();
  control.show();
  assert.equal(windows.length, 2);
  assert.equal(updater.authorized(), false);
  assert.throws(() => handler(event, 'check'), /não autorizada/);
});

test('unknown actions are rejected and native confirmation defaults to cancel', async () => {
  const { handler, updater, event } = setup();
  assert.throws(() => handler(event, 'execute'), /inválida/);
  assert.equal(await updater.options.confirmInstall('0.5.0', 'win32'), false);
});
