/** Public voice-only protocol. The renderer owns authenticated signaling; the
 * native helper owns devices, processing, RTP and playback. Never send tokens. */
export interface NativeVoiceStatus {
  protocol: 1;
  available: boolean;
  enabled: boolean;
  active: boolean;
  engine: string;
}
export interface VoiceControls {
  audioInputId?: string;
  audioOutputId?: string;
  inputMode?: 'voice-activity' | 'push-to-talk';
  activationMode?: 'automatic' | 'manual';
  activationThreshold?: number;
  inputVolume?: number;
  outputVolume?: number;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  noiseSuppression?: boolean;
  muted?: boolean;
  deafened?: boolean;
  ptt?: boolean;
  volumes?: Record<string, number>;
}
export interface NativeVoiceEvent {
  sessionId: string;
  type: 'signal' | 'meter' | 'transport-state' | 'stopped' | 'health';
  requestId?: number;
  method?: string;
  data?: Record<string, unknown>;
  level?: number;
  speaking?: boolean;
  transmitting?: boolean;
  captureFrames?: number;
  transportId?: string;
  state?: string;
  reason?: string;
}
export interface NativeVoiceBridge {
  status(): Promise<NativeVoiceStatus>;
  setEnabled(enabled: boolean): Promise<NativeVoiceStatus>;
  open(): Promise<NativeVoiceStatus & { sessionId: string }>;
  request<T>(sessionId: string, method: string, data?: object): Promise<T>;
  close(sessionId: string): Promise<void>;
  subscribe(listener: (event: NativeVoiceEvent) => void): () => void;
}
export interface NativeVoiceStats {
  send: Array<Record<string, unknown> & { id: string }>;
  recv: Array<Record<string, unknown> & { id: string }>;
  captureFrames: number;
  inputLevel: number;
  powerProtection: boolean;
  engine: string;
}
/** Prefix identifiers so native audio reports and browser video reports can be
 * sampled together without collisions. Existing samplers redact these IDs. */
export function mergeNativeRtcStats(
  browser: RTCStatsReport | undefined,
  rows: NativeVoiceStats['send'],
): RTCStatsReport {
  const result = new Map<string, Record<string, unknown>>();
  browser?.forEach((row) => result.set(row.id, row));
  for (const row of rows) {
    const entry = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'string' && (key === 'id' || key.endsWith('Id'))
          ? 'native:' + value
          : value,
      ]),
    );
    result.set(String(entry.id), entry);
  }
  return result as RTCStatsReport;
}
export function getNativeVoiceBridge(): NativeVoiceBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __CUESCORD_DESKTOP__?: { nativeVoice?: NativeVoiceBridge } })
    .__CUESCORD_DESKTOP__?.nativeVoice;
}
export class NativeVoiceSession {
  readonly consumers = new Map<string, string>();
  producer?: { id: string; closed: boolean; pause(): void; resume(): void };
  rtpCapabilities: unknown;
  private unsubscribe: () => void;
  private closed = false;
  private transports = new Map<string, 'send' | 'recv'>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private failed = false;
  private controls: VoiceControls = {};
  private connectionWaiters = new Map<
    string,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private connected = new Set<string>();
  private constructor(
    private bridge: NativeVoiceBridge,
    readonly sessionId: string,
    private signal: AbortSignal,
    private signaling: <T>(method: string, data: object) => Promise<T>,
    private onMeter: (event: NativeVoiceEvent) => void,
    private onFailure: () => void,
  ) {
    this.unsubscribe = bridge.subscribe((event) => {
      if (this.closed || event.sessionId !== sessionId || signal.aborted) return;
      if (event.type === 'signal') void this.reply(event);
      else if (event.type === 'meter') onMeter(event);
      else if (event.type === 'stopped' || event.type === 'health') this.fail();
      else if (event.type === 'transport-state') {
        const id = event.transportId!;
        if (event.state === 'connected' || event.state === 'completed') {
          this.connected.add(id);
          const waiting = this.connectionWaiters.get(id);
          if (waiting) {
            clearTimeout(waiting.timer);
            waiting.resolve();
            this.connectionWaiters.delete(id);
          }
          clearTimeout(this.disconnectTimers.get(id));
          this.disconnectTimers.delete(id);
        } else if (event.state === 'failed' || event.state === 'closed') this.fail();
        else if (event.state === 'disconnected' && !this.disconnectTimers.has(id)) {
          this.connected.delete(id);
          this.disconnectTimers.set(
            id,
            setTimeout(() => this.fail(), 5000),
          );
        }
      }
    });
    signal.addEventListener('abort', this.close, { once: true });
  }
  static async open(
    signal: AbortSignal,
    signaling: <T>(method: string, data: object) => Promise<T>,
    onMeter: (event: NativeVoiceEvent) => void,
    onFailure: () => void,
  ) {
    const bridge = getNativeVoiceBridge();
    if (!bridge) throw new Error('Native voice unavailable');
    signal.throwIfAborted();
    const ready = await bridge.open();
    if (signal.aborted) {
      await bridge.close(ready.sessionId);
      signal.throwIfAborted();
    }
    return new NativeVoiceSession(bridge, ready.sessionId, signal, signaling, onMeter, onFailure);
  }
  private fail() {
    if (this.closed || this.failed || this.signal.aborted) return;
    this.failed = true;
    this.close();
    this.onFailure();
  }
  private async reply(event: NativeVoiceEvent) {
    if (!['connect-transport', 'produce'].includes(event.method ?? '')) {
      this.fail();
      return;
    }
    try {
      const result = await this.signaling(event.method!, event.data ?? {});
      await this.command('reply', { requestId: event.requestId, result });
    } catch {
      if (!this.closed)
        await this.command('reply', { requestId: event.requestId, error: true }).catch(() =>
          this.fail(),
        );
    }
  }
  command<T>(method: string, data: object = {}): Promise<T> {
    if (this.closed || this.signal.aborted) return Promise.reject(new Error('Native voice closed'));
    return this.bridge.request<T>(this.sessionId, method, data).catch((error) => {
      if (method !== 'stats' && method !== 'devices') this.fail();
      throw error;
    });
  }
  async initialize(rtpCapabilities: unknown, iceServers: unknown[], controls: VoiceControls) {
    const loaded = await this.command<{ rtpCapabilities: unknown }>('load', { rtpCapabilities });
    this.rtpCapabilities = loaded.rtpCapabilities;
    await this.command('configure', controls);
    // Same signaling commands as the browser. Purpose adds a bounded audio-only
    // pair; authorization, participant identity and mute events stay shared.
    const [send, recv] = await Promise.all(
      ['send', 'recv'].map((direction) =>
        this.signaling<{ params: { id: string } }>('create-transport', {
          direction,
          purpose: 'voice',
        }),
      ),
    );
    for (const [direction, response] of [
      ['send', send],
      ['recv', recv],
    ] as const) {
      await this.command('transport', { direction, params: response.params, iceServers });
      this.transports.set(response.params.id, direction);
    }
  }
  configure(controls: VoiceControls) {
    const changed = Object.fromEntries(
      Object.entries(controls).filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(this.controls[key as keyof VoiceControls]),
      ),
    ) as VoiceControls;
    if (!Object.keys(changed).length) return Promise.resolve();
    this.controls = { ...this.controls, ...changed };
    return this.command('configure', changed).catch(() => this.fail());
  }
  async publish(bitrate: number) {
    const result = await this.command<{ producerId: string }>('produce', { bitrate });
    this.producer = {
      id: result.producerId,
      closed: false,
      pause: () => {
        void this.configure({ muted: true });
      },
      resume: () => {
        void this.configure({ muted: false });
      },
    };
    const send = [...this.transports].find(([, direction]) => direction === 'send')![0];
    await this.waitForConnection(send);
    return this.producer;
  }
  async consume(params: { id: string; producerId: string; kind: string; rtpParameters: unknown }) {
    if (params.kind !== 'audio') throw new Error('Native voice accepts audio only');
    await this.command('consume', params);
    await this.waitForConnection(this.receiveTransportId!);
    this.consumers.set(params.producerId, params.id);
  }
  async closeConsumer(producerId: string) {
    this.consumers.delete(producerId);
    if (!this.closed) await this.command('close-consumer', { producerId });
  }
  async updateIceServers(iceServers: unknown[]) {
    for (const direction of this.transports.values())
      await this.command('ice-servers', { direction, iceServers });
  }
  stats() {
    return this.command<NativeVoiceStats>('stats');
  }
  private waitForConnection(id: string) {
    if (this.connected.has(id)) return Promise.resolve();
    if (this.closed || this.signal.aborted) return Promise.reject(new Error('Native voice closed'));
    // Consumers share the receive transport. Only one waiter owns its timeout.
    const existing = this.connectionWaiters.get(id);
    if (existing) return this.connectionPromises.get(id)!;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.connectionWaiters.delete(id);
        reject(new Error('Native voice connection timed out'));
        this.fail();
      }, 12000);
      this.connectionWaiters.set(id, { resolve, reject, timer });
    });
    this.connectionPromises.set(id, promise);
    return promise;
  }
  private connectionPromises = new Map<string, Promise<void>>();
  get receiveTransportId() {
    return [...this.transports].find(([, direction]) => direction === 'recv')?.[0];
  }
  close = () => {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener('abort', this.close);
    this.unsubscribe();
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    this.consumers.clear();
    for (const waiting of this.connectionWaiters.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error('Native voice closed'));
    }
    this.connectionWaiters.clear();
    this.connectionPromises.clear();
    this.connected.clear();
    if (this.producer) this.producer.closed = true;
    void this.bridge.close(this.sessionId).catch(() => undefined);
  };
}
