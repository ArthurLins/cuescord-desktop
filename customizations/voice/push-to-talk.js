function createPushToTalkBridge(ipcRenderer) {
  return {
    status: () => ipcRenderer.invoke('cuescord:ptt:status'),
    configure: (value) => ipcRenderer.invoke('cuescord:ptt:configure', value),
    release: (id) => ipcRenderer.invoke('cuescord:ptt:release', id),
    subscribe: (listener) => {
      const receive = (_event, value) => listener(value);
      ipcRenderer.on('cuescord:ptt:event', receive);
      return () => ipcRenderer.removeListener('cuescord:ptt:event', receive);
    },
  };
}
