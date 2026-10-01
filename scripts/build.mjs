import { readFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [source, css, titlebarCss, manifest, audioBridge, captureModal, captureCss] =
  await Promise.all(
    [
      'customizations/titlebar/desktop.js',
      'customizations/titlebar/desktop.css',
      'customizations/titlebar/titlebar.css',
      'package.json',
      'customizations/audio/audio.js',
      'customizations/capture/capture-modal.js',
      'customizations/capture/capture-modal.css',
    ].map((file) => readFile(new URL(file, root), 'utf8')),
  );
const { version } = JSON.parse(manifest);
// A sandboxed preload cannot load arbitrary modules. Embed only our local styles
// and initializer; the remote page never receives Node or an unrestricted IPC API.
const preload = `const { contextBridge, ipcRenderer } = require('electron');
const originArg = process.argv.find(arg => arg.startsWith('--cuescord-origin='));
if (process.isMainFrame && originArg) {
  const origin = decodeURIComponent(originArg.slice('--cuescord-origin='.length));
  if (window.location.origin === origin) {
    const platform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
    contextBridge.exposeInMainWorld('__CUESCORD_DESKTOP__', { version: ${JSON.stringify(version)}, platform, engine: 'electron', screenAudio: (${audioBridge})(ipcRenderer) });
    const controls = {
      setImageAnimationPolicy: policy => ipcRenderer.invoke('cuescord:window', policy === 'noAnimation' ? 'pause-image-animations' : 'resume-image-animations'),
      minimize: () => ipcRenderer.invoke('cuescord:window', 'minimize'),
      toggleMaximize: () => ipcRenderer.invoke('cuescord:window', 'toggle-maximize'),
      isMaximized: () => ipcRenderer.invoke('cuescord:window', 'is-maximized'),
      close: () => ipcRenderer.invoke('cuescord:window', 'close'),
    };
    (${source})({ origin, version: ${JSON.stringify(version)}, platform, css: ${JSON.stringify(css)}, titlebarCss: ${JSON.stringify(titlebarCss)} }, controls);
    (${captureModal})(ipcRenderer, ${JSON.stringify(captureCss)});
  }
}
`;
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/preload.cjs', root), preload);
console.log(`Cuescord Desktop ${version}: preload gerado.`);
