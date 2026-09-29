const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { readFile } = require('node:fs/promises');
const exec = promisify(execFile);
const options = { timeout: 3000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } };
const list = async kind => JSON.parse((await exec('pactl', ['--format=json', 'list', kind], options)).stdout);

async function belongsTo(pid, root) {
  const visited = new Set();
  while (pid > 1 && !visited.has(pid)) {
    if (pid === root) return true;
    visited.add(pid);
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch { return false; }
  }
  return false;
}

async function processIdentity(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}

async function listAudioApps(ownPid) {
  const apps = new Map();
  for (const input of await list('sink-inputs')) {
    const pid = Number(input.properties?.['application.process.id']);
    if (!Number.isInteger(pid) || pid <= 1 || await belongsTo(pid, ownPid)) continue;
    try {
      const identity = await processIdentity(pid);
      apps.set(pid, { id: `${pid}:${identity}`, pid, identity, name: input.properties['application.name'] || input.properties['application.process.binary'] || String(pid) });
    } catch { /* The process may have ended while listing. */ }
  }
  return [...apps.values()];
}

async function windowPid(sourceId) {
  const match = /^window:(\d+):/.exec(sourceId);
  if (!match || match[1] === '0') return 0;
  const { stdout } = await exec('xprop', ['-id', match[1], '_NET_WM_PID'], options);
  return Number(/=\s*(\d+)/.exec(stdout)?.[1] || 0);
}

function startLinuxAudio(config, onData, onError) {
  let stopped = false;
  let timer;
  const captures = new Map();
  let target = 0;
  let identity;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    for (const entry of captures.values()) entry.child.kill();
    captures.clear();
  };
  async function refresh() {
    try {
      if (target && await processIdentity(target) !== identity) throw new Error('O aplicativo de áudio foi encerrado.');
      const [inputs, sinks] = await Promise.all([list('sink-inputs'), list('sinks')]);
      if (stopped) return;
      const wanted = new Set();
      for (const input of inputs) {
        const pid = Number(input.properties?.['application.process.id']);
        if (!Number.isInteger(pid) || pid <= 1) continue;
        const selected = target ? await belongsTo(pid, target) : !await belongsTo(pid, config.ownPid);
        if (!selected || stopped) continue;
        const sink = sinks.find(item => item.index === input.sink);
        const monitor = sink?.monitor_source_name || sink?.monitor_source;
        if (typeof monitor !== 'string' || !monitor) continue;
        const key = `${input.index}:${pid}:${input.sink}`;
        wanted.add(key);
        if (captures.has(key)) continue;
        // Monitor this playback stream without moving it to a virtual output.
        const child = spawn('parec', [
          `--monitor-stream=${input.index}`, `--device=${monitor}`,
          '--raw', '--format=s16le', '--rate=48000', '--channels=2', '--latency-msec=20',
          '--client-name=Cuescord Screen Audio',
        ], { stdio: ['ignore', 'pipe', 'pipe'], env: options.env });
        const entry = { child, remainder: Buffer.alloc(0) };
        captures.set(key, entry);
        child.stdout.on('data', data => {
          if (stopped || captures.get(key) !== entry) return;
          const bytes = Buffer.concat([entry.remainder, data]);
          const size = bytes.length - bytes.length % 4;
          entry.remainder = bytes.subarray(size);
          if (size) onData(key, bytes.subarray(0, size));
        });
        child.stderr.on('data', data => console.error('[screen audio]', data.toString().trim()));
        child.on('error', onError);
        child.once('exit', () => { if (captures.get(key) === entry) captures.delete(key); });
      }
      for (const [key, entry] of captures) {
        if (!wanted.has(key)) { captures.delete(key); entry.child.kill(); }
      }
    } catch (error) { stop(); onError(error); }
    if (!stopped) timer = setTimeout(refresh, 1000);
  }
  const ready = (async () => {
    target = config.kind === 'window' ? config.audioApp?.pid || await windowPid(config.sourceId) : 0;
    if (config.kind === 'window' && !target) throw new Error('O portal não forneceu o processo da janela.');
    identity = target ? config.audioApp?.identity || await processIdentity(target) : null;
    if (!stopped) await refresh();
  })();
  return { stop, ready };
}

module.exports = { listAudioApps, startLinuxAudio };
