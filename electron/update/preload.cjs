const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('cuescordUpdates', {
    state: () => ipcRenderer.invoke('cuescord:updates:action', 'state'),
    check: () => ipcRenderer.invoke('cuescord:updates:action', 'check'),
    download: () => ipcRenderer.invoke('cuescord:updates:action', 'download'),
    install: () => ipcRenderer.invoke('cuescord:updates:action', 'install'),
    cancel: () => ipcRenderer.invoke('cuescord:updates:action', 'cancel'),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('cuescord:updates:state', listener);
      return () => ipcRenderer.removeListener('cuescord:updates:state', listener);
    },
  });
}
