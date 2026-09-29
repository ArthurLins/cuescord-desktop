// Native code lives in a utility process, never in the remote renderer.
let stopCapture;
let credits = 0;
let started = false;
let stopping = false;
const port = process.parentPort;
function sendAudio(lane, data) {
  if (stopping || credits <= 0) return;
  // Bound each message and the number of outstanding PCM chunks.
  for (let offset = 0; offset < data.length && credits > 0; offset += 8192) {
    credits--;
    port.postMessage({ type: 'pcm', lane, data: data.subarray(offset, offset + 8192) });
  }
}
function fail(error) {
  console.error('[screen audio]', error);
  port.postMessage({ type: 'error' });
  stop();
}
function stop() {
  if (stopping) return;
  stopping = true;
  try { stopCapture?.(); } catch (error) { console.error(error); }
  process.exit(0);
}
function windowsPid(sourceId) {
  const match = /^window:(\d+):/.exec(sourceId);
  if (!match) throw new Error('Identificador de janela inválido.');
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const getPid = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)');
  const getClass = user32.func('int __stdcall GetClassNameW(uintptr_t hwnd, _Out_ uint16_t *name, int size)');
  const findChild = user32.func('uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, str16 className, str16 title)');
  const hwnd = Number(match[1]);
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) throw new Error('Janela inválida.');
  const pid = [0];
  getPid(hwnd, pid);
  const name = Buffer.alloc(512);
  getClass(hwnd, name, 256);
  // Legacy UWP windows are owned by ApplicationFrameHost, which has no audio.
  if (name.toString('utf16le').split('\0')[0] === 'ApplicationFrameWindow') {
    let child = findChild(hwnd, 0, null, null);
    for (let count = 0; child && count < 128; count++) {
      const childPid = [0];
      getPid(child, childPid);
      if (childPid[0] && childPid[0] !== pid[0]) return childPid[0];
      child = findChild(hwnd, child, null, null);
    }
    throw new Error('Processo UWP indisponível.');
  }
  if (!pid[0]) throw new Error('A janela foi encerrada.');
  return pid[0];
}
port.on('message', async ({ data: message }) => {
  if (message.type === 'stop') return stop();
  if (message.type === 'credit') { credits = Math.min(32, credits + 1); return; }
  if (message.type !== 'start' || started) return;
  started = true;
  credits = 16;
  try {
    if (process.platform === 'win32') {
      const { LoopbackCapture } = require('loopback-capture');
      const capture = new LoopbackCapture();
      stopCapture = () => capture.stop();
      const window = message.config.kind === 'window';
      // Include only the selected app, or exclude the entire Cuescord process tree.
      capture.start(window ? windowsPid(message.config.sourceId) : message.config.ownPid, window, bytes => sendAudio('app', bytes));
    } else if (process.platform === 'linux') {
      const capture = require('./audio-linux.cjs').startLinuxAudio(message.config, sendAudio, fail);
      stopCapture = capture.stop;
      await capture.ready;
    } else throw new Error('Captura nativa de áudio indisponível nesta plataforma.');
    if (!stopping) port.postMessage({ type: 'ready' });
  } catch (error) { fail(error); }
});
process.on('SIGTERM', stop);
process.on('disconnect', stop);
