export interface RecoverableTransport {
  readonly closed: boolean;
  readonly connectionState: string;
  on(event: 'connectionstatechange', listener: (state: string) => void): unknown;
  off(event: 'connectionstatechange', listener: (state: string) => void): unknown;
}
export const voiceRecoveryGraceMs = 4000;
export const voiceRecoveryTimeoutMs = 30000;

// Each direction recovers independently. A short ICE gap must not tear down
// microphones/cameras; an unsuccessful restart must not leave a silent call.
export function recoverVoiceTransport(
  transport: RecoverableTransport,
  signal: AbortSignal,
  restart: () => Promise<void>,
  rejoin: () => void,
  graceMs = voiceRecoveryGraceMs,
  recoveryMs = voiceRecoveryTimeoutMs,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let attempted = false;
  let attempts = 0;
  let lastState: string | undefined;
  let disposed = false;
  const stop = () => {
    disposed = true;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    transport.off('connectionstatechange', changed);
    signal.removeEventListener('abort', stop);
  };
  const failed = () => {
    if (disposed || signal.aborted) return;
    stop();
    rejoin();
  };
  const recover = async () => {
    if (disposed || signal.aborted || pending || attempts >= 3) return;
    if (transport.closed) {
      failed();
      return;
    }
    pending = true;
    // Includes signaling and the browser's ICE negotiation, both of which can hang.
    // Retries share this deadline; a failed candidate round must not extend it.
    if (!attempted) {
      attempted = true;
      clearTimeout(timer);
      timer = setTimeout(failed, recoveryMs);
    }
    attempts++;
    try {
      await restart();
      if (disposed || signal.aborted) return;
      if (transport.connectionState === 'connected') {
        clearTimeout(timer);
        clearTimeout(retryTimer);
        retryTimer = undefined;
        attempted = false;
        attempts = 0;
      }
    } catch {
      failed();
    } finally {
      pending = false;
      if (attempted && transport.connectionState === 'failed') retry();
    }
  };
  const retry = () => {
    if (disposed || signal.aborted || pending || retryTimer || attempts >= 3) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void recover();
    }, 1000);
  };
  const changed = (state: string) => {
    if (disposed || signal.aborted) return;
    if (state === lastState) return;
    lastState = state;
    if (state === 'connected') {
      // A connected event during the request can describe the previous ICE pair.
      if (!pending) {
        clearTimeout(timer);
        clearTimeout(retryTimer);
        retryTimer = undefined;
        attempted = false;
        attempts = 0;
      }
    } else if (state === 'closed') failed();
    else if (state === 'connecting' && !pending && !attempted) {
      clearTimeout(timer);
      timer = setTimeout(failed, recoveryMs);
    } else if ((state === 'disconnected' || state === 'failed') && !pending && attempted) {
      if (state === 'failed') retry();
    } else if ((state === 'disconnected' || state === 'failed') && !pending && !attempted) {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          void recover();
        },
        state === 'failed' ? 0 : graceMs,
      );
    }
  };
  transport.on('connectionstatechange', changed);
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  else changed(transport.connectionState);
  return stop;
}
