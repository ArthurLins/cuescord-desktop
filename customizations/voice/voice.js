function createNativeVoiceBridge(ipcRenderer) {
  return {
    status: () => ipcRenderer.invoke('cuescord:voice:status'),
    setEnabled: (enabled) => ipcRenderer.invoke('cuescord:voice:enabled', enabled),
    open: () => ipcRenderer.invoke('cuescord:voice:open'),
    request: (sessionId, method, data = {}) =>
      ipcRenderer.invoke('cuescord:voice:request', { sessionId, method, data }),
    close: (sessionId) => ipcRenderer.invoke('cuescord:voice:close', sessionId),
    subscribe: (listener) => {
      const receive = (_event, value) => listener(value);
      ipcRenderer.on('cuescord:voice:event', receive);
      return () => ipcRenderer.removeListener('cuescord:voice:event', receive);
    },
  };
}
