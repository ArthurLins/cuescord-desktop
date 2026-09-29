function createDesktopAudioBridge(ipcRenderer) {
  let active;
  function detach(current) {
    ipcRenderer.removeListener('cuescord:audio:pcm', current.pcm);
    ipcRenderer.removeListener('cuescord:audio:ended', current.ended);
    if (active === current) active = undefined;
  }
  return {
    async start(onData, onEnded) {
      if (active || typeof onData !== 'function' || typeof onEnded !== 'function') return null;
      const current = { id: null, pcm: null, ended: null };
      current.pcm = (_event, packet) => {
        if (current.id && packet.id !== current.id) return;
        try {
          // Pass only PCM and a lane identifier, never Electron's IPC event object.
          const data = new Uint8Array(packet.data).buffer;
          onData({ lane: packet.lane, data });
        } finally { ipcRenderer.send('cuescord:audio:credit', packet.id); }
      };
      current.ended = (_event, id) => {
        if (current.id && current.id !== id) return;
        detach(current);
        onEnded();
      };
      active = current;
      ipcRenderer.on('cuescord:audio:pcm', current.pcm);
      ipcRenderer.on('cuescord:audio:ended', current.ended);
      try {
        const result = await ipcRenderer.invoke('cuescord:audio:start');
        if (!result) { detach(current); return null; }
        current.id = result.id;
        return result;
      } catch (error) { detach(current); throw error; }
    },
    async stop(id) {
      if (active?.id === id) detach(active);
      await ipcRenderer.invoke('cuescord:audio:stop', id);
    },
  };
}
