type AudioPacket = { lane: string; data: ArrayBuffer };
type AudioBridge = {
  start(onData: (packet: AudioPacket) => void, onEnded: () => void): Promise<{ id: string } | null>;
  stop(id: string): Promise<void>;
};

export function desktopEnvironment() {
  if (typeof window === 'undefined') return undefined;
  return (
    window as Window & {
      __CUESCORD_DESKTOP__?: { engine?: string; screenAudio?: AudioBridge };
    }
  ).__CUESCORD_DESKTOP__;
}

/** Client-only adapter: add audio granted by the desktop picker to its video stream. */
export async function attachDesktopScreenAudio(stream: MediaStream, signal: AbortSignal) {
  const bridge = desktopEnvironment()?.screenAudio;
  const video = stream.getVideoTracks()[0];
  if (!bridge || !video || signal.aborted || video.readyState === 'ended') return;
  let context: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  let track: MediaStreamTrack | undefined;
  let originalStop: (() => void) | undefined;
  let id: string | undefined;
  let stopped = false;
  let watcher: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(watcher);
    signal.removeEventListener('abort', cleanup);
    video.removeEventListener('ended', cleanup);
    originalStop?.();
    node?.disconnect();
    node?.port.close();
    if (context) void context.close().catch(console.error);
    if (id) void bridge.stop(id).catch(console.error);
  };
  signal.addEventListener('abort', cleanup, { once: true });
  video.addEventListener('ended', cleanup, { once: true });
  watcher = setInterval(() => {
    if (video.readyState === 'ended') cleanup();
  }, 250);
  try {
    context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await context.audioWorklet.addModule('/audio/desktop-screen-audio-worklet.js');
    if (stopped) return;
    node = new AudioWorkletNode(context, 'cuescord-screen-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const destination = context.createMediaStreamDestination();
    node.connect(destination);
    track = destination.stream.getAudioTracks()[0];
    originalStop = track.stop.bind(track);
    track.stop = cleanup;
    track.contentHint = 'music';
    await context.resume();
    if (stopped) return;
    const result = await bridge.start((packet) => {
      if (!stopped) node?.port.postMessage(packet, [packet.data]);
    }, cleanup);
    if (!result) {
      cleanup();
      return;
    }
    id = result.id;
    if (stopped) {
      await bridge.stop(id);
      return;
    }
    stream.addTrack(track);
  } catch (error) {
    console.error('Falha na captura nativa de áudio do compartilhamento:', error);
    cleanup();
  }
}
