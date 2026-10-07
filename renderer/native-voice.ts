import {
  recoverVoiceTransport,
  voiceRecoveryGraceMs,
  voiceRecoveryTimeoutMs,
  type RecoverableTransport,
} from './voice-transport-recovery';

/** Public voice-only protocol. The renderer owns authenticated signaling; the
 * native helper owns devices, processing, RTP and playback. Never send account
 * tokens or cookies; ICE relay credentials belong to the transport contract. */
export interface NativeVoiceStatus {
  protocol: 1;
  available: boolean;
  enabled: boolean;
  active: boolean;
  engine: string;
  noiseSuppressionModes?: Array<'native' | 'rnnoise'>;
  voiceQualityProtocol?: number;
  lastStopReason?: string;
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
  noiseSuppressionMode?: 'native' | 'rnnoise';
  voiceBoost?: boolean;
  muted?: boolean;
  deafened?: boolean;
  ptt?: boolean;
  volumes?: Record<string, number>;
}
export type NativeNoiseStatus = 'off' | 'native' | 'loading' | 'rnnoise' | 'fallback';
export interface NativeVoiceEvent {
  sessionId: string;
  type:
    | 'signal'
    | 'meter'
    | 'transport-state'
    | 'stopped'
    | 'health'
    | 'processing-state'
    | 'quality';
  requestId?: number;
  method?: string;
  data?: Record<string, unknown>;
  level?: number;
  speaking?: boolean;
  transmitting?: boolean;
  captureFrames?: number;
  transportId?: string;
  direction?: 'send' | 'recv';
  state?: string;
  reason?: string;
  noiseProcessorStatus?: NativeNoiseStatus;
  noiseSuppressionEffective?: boolean;
}
export interface NativeVoiceBridge {
  status(): Promise<NativeVoiceStatus>;
  setEnabled(enabled: boolean): Promise<NativeVoiceStatus>;
  open(): Promise<NativeVoiceStatus & { sessionId: string }>;
  devices?(): Promise<NativeVoiceDevice[]>;
  request<T>(sessionId: string, method: string, data?: object): Promise<T>;
  close(sessionId: string): Promise<void>;
  subscribe(listener: (event: NativeVoiceEvent) => void): () => void;
}
export interface NativeVoiceDevice {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput';
  label: string;
}
export interface NativeVoiceStats {
  send: Array<Record<string, unknown> & { id: string }>;
  recv: Array<Record<string, unknown> & { id: string }>;
  captureFrames: number;
  inputLevel: number;
  powerProtection: boolean;
  engine: string;
  noiseSuppressionMode?: 'native' | 'rnnoise';
  noiseProcessorStatus?: NativeNoiseStatus;
  noiseModel?: string;
  webrtcNoiseSuppression?: boolean;
  noiseFrames?: number;
  noiseProcessingAverageMs?: number;
  noiseProcessingMaxMs?: number;
  roomAudioBitrate?: number;
  microphoneEncodingBitrate?: number;
  microphoneAdaptivePtime?: boolean;
  microphoneBitratePriority?: number;
  captureMmcss?: boolean;
  renderMmcss?: boolean;
  captureMmcssInherited?: boolean;
  renderMmcssInherited?: boolean;
  capturePriorityError?: number;
  renderPriorityError?: number;
  captureLateFrames?: number;
  captureMaxGapMs?: number;
  limitedCaptureFrames?: number;
  limitedRenderFrames?: number;
  captureLimiterGain?: number;
  renderLimiterGain?: number;
  voiceBoost?: boolean;
  captureRecoveries?: number;
  autoGainActive?: boolean;
  autoGainErrors?: number;
  autoGainFrames?: number;
  receiverRecoveries?: number;
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
/** Enable older Windows desktops that still persist an experimental opt-out. */
export async function getPreferredNativeVoiceStatus() {
  const bridge = getNativeVoiceBridge();
  const status = await bridge?.status();
  return status?.available && !status.enabled ? bridge!.setEnabled(true) : status;
}
const deviceRequests = new WeakMap<NativeVoiceBridge, Promise<NativeVoiceDevice[]>>();
/** Old bridges need a temporary helper; serialize it with call startup. */
export function enumerateNativeVoiceDevices(bridge: NativeVoiceBridge) {
  const pending = deviceRequests.get(bridge);
  if (pending) return pending;
  const request = (async () => {
    if (bridge.devices) return bridge.devices();
    const ready = await bridge.open();
    try {
      return await bridge.request<NativeVoiceDevice[]>(ready.sessionId, 'devices');
    } finally {
      await bridge.close(ready.sessionId);
    }
  })().finally(() => deviceRequests.delete(bridge));
  deviceRequests.set(bridge, request);
  return request;
}
/** Adapts helper events to the browser transport recovery contract. */
class NativeTransport implements RecoverableTransport {
  connectionState = 'new';
  closed = false;
  private listeners = new Set<(state: string) => void>();
  on(_event: 'connectionstatechange', listener: (state: string) => void) {
    this.listeners.add(listener);
  }
  off(_event: 'connectionstatechange', listener: (state: string) => void) {
    this.listeners.delete(listener);
  }
  change(state: string) {
    this.connectionState = state === 'completed' ? 'connected' : state;
    for (const listener of this.listeners) listener(this.connectionState);
  }
  dispose() {
    this.closed = true;
    this.listeners.clear();
  }
}
export class NativeVoiceSession {
  readonly consumers = new Map<string, string>();
  producer?: { id: string; closed: boolean; pause(): void; resume(): void };
  rtpCapabilities: unknown;
  private unsubscribe: () => void;
  private closed = false;
  private transports = new Map<string, 'send' | 'recv'>();
  private transportRecovery = new Map<string, { transport: NativeTransport; stop(): void }>();
  private failed = false;
  private controls: VoiceControls = {};
  private connectionWaiters = new Map<
    string,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private connected = new Set<string>();
  private established = new Set<string>();
  private constructor(
    private bridge: NativeVoiceBridge,
    readonly sessionId: string,
    private signal: AbortSignal,
    private signaling: <T>(method: string, data: object) => Promise<T>,
    private onMeter: (event: NativeVoiceEvent) => void,
    private onFailure: (reason: string) => void,
    readonly supportsRnnoise: boolean,
    readonly supportsQuality: boolean,
    readonly engine: string,
  ) {
    this.unsubscribe = bridge.subscribe((event) => {
      if (this.closed || event.sessionId !== sessionId || signal.aborted) return;
      if (event.type === 'signal') void this.reply(event);
      else if (
        event.type === 'meter' ||
        event.type === 'processing-state' ||
        event.type === 'quality'
      )
        onMeter(event);
      else if (event.type === 'stopped' || event.type === 'health')
        this.fail(event.reason ?? event.type);
      else if (event.type === 'transport-state') {
        const id = event.transportId!;
        const recovery = this.transportRecovery.get(id);
        if (!recovery || !event.state) return;
        if (event.state === 'connected' || event.state === 'completed') {
          this.connected.add(id);
          this.established.add(id);
          const waiting = this.connectionWaiters.get(id);
          if (waiting) {
            clearTimeout(waiting.timer);
            waiting.resolve();
            this.connectionWaiters.delete(id);
          }
        } else this.connected.delete(id);
        onMeter({ ...event, direction: this.transports.get(id) });
        recovery.transport.change(event.state);
      }
    });
    signal.addEventListener('abort', this.close, { once: true });
  }
  static async open(
    signal: AbortSignal,
    signaling: <T>(method: string, data: object) => Promise<T>,
    onMeter: (event: NativeVoiceEvent) => void,
    onFailure: (reason: string) => void,
  ) {
    const bridge = getNativeVoiceBridge();
    if (!bridge) throw new Error('Native voice unavailable');
    signal.throwIfAborted();
    const pendingDevices = deviceRequests.get(bridge);
    if (pendingDevices) await pendingDevices.catch(() => undefined);
    signal.throwIfAborted();
    const ready = await bridge.open();
    if (signal.aborted) {
      await bridge.close(ready.sessionId);
      signal.throwIfAborted();
    }
    return new NativeVoiceSession(
      bridge,
      ready.sessionId,
      signal,
      signaling,
      onMeter,
      onFailure,
      ready.noiseSuppressionModes?.includes('rnnoise') === true,
      ready.voiceQualityProtocol === 1,
      ready.engine,
    );
  }
  private fail(reason = 'media-operation-failed') {
    if (this.closed || this.failed || this.signal.aborted) return;
    this.failed = true;
    this.close();
    this.onFailure(reason);
  }
  private async reply(event: NativeVoiceEvent) {
    if (
      !['connect-transport', 'produce', 'repair-consumer', 'resume-consumer'].includes(
        event.method ?? '',
      )
    ) {
      this.fail();
      return;
    }
    try {
      let result: unknown;
      if (event.method === 'repair-consumer') {
        const producerId = event.data?.producerId;
        if (typeof producerId !== 'string') throw new Error('Unknown native producer');
        const oldId = this.consumers.get(producerId);
        if (!this.supportsQuality || !oldId || !this.receiveTransportId)
          throw new Error('Unknown native consumer');
        await this.signaling('close-consumer', { consumerId: oldId });
        this.signal.throwIfAborted();
        const response = await this.signaling<{
          consumer: { id: string; producerId: string; kind: string; rtpParameters: unknown };
        }>('consume', {
          producerId,
          transportId: this.receiveTransportId,
          rtpCapabilities: this.rtpCapabilities,
        });
        if (
          this.closed ||
          this.consumers.get(producerId) !== oldId ||
          response.consumer.kind !== 'audio' ||
          response.consumer.producerId !== producerId
        )
          throw new Error('Native consumer no longer active');
        this.consumers.set(producerId, response.consumer.id);
        result = response.consumer;
      } else if (event.method === 'resume-consumer') {
        if (
          !this.supportsQuality ||
          ![...this.consumers.values()].includes(String(event.data?.consumerId))
        )
          throw new Error('Unknown native consumer');
        result = await this.signaling(event.method, event.data ?? {});
      } else result = await this.signaling(event.method!, event.data ?? {});
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
      if (method !== 'stats' && method !== 'devices')
        this.fail(
          error instanceof Error
            ? /Native voice closed \(([-a-z]+)\)/.exec(error.message)?.[1]
            : undefined,
        );
      throw error;
    });
  }
  async initialize(rtpCapabilities: unknown, iceServers: unknown[], controls: VoiceControls) {
    const loaded = await this.command<{ rtpCapabilities: unknown }>('load', { rtpCapabilities });
    this.rtpCapabilities = loaded.rtpCapabilities;
    await this.configure(controls);
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
      this.transports.set(response.params.id, direction);
      const transport = new NativeTransport();
      const stop = recoverVoiceTransport(
        transport,
        this.signal,
        () => this.restartTransport(response.params.id, direction),
        () => this.fail(),
      );
      this.transportRecovery.set(response.params.id, { transport, stop });
      await this.command('transport', { direction, params: response.params, iceServers });
    }
  }
  private async restartTransport(transportId: string, direction: 'send' | 'recv') {
    const quality = (reason: string) => {
      if (!this.closed && !this.signal.aborted)
        this.onMeter({
          sessionId: this.sessionId,
          type: 'quality',
          reason,
          transportId,
          direction,
        });
    };
    quality('ice-restart-started');
    try {
      const next = await this.signaling<{ iceServers: unknown[] }>('ice-config', {});
      await this.command('ice-servers', { direction, iceServers: next.iceServers });
      if (this.closed || this.signal.aborted) return;
      const { iceParameters } = await this.signaling<{ iceParameters: unknown }>('restart-ice', {
        transportId,
      });
      await this.command('restart-ice', { direction, iceParameters });
      quality('ice-restart-finished');
    } catch (error) {
      quality('ice-restart-failed');
      throw error;
    }
  }
  configure(controls: VoiceControls) {
    // 0.4.8 and earlier reject unknown configure keys. A newer web must remain
    // compatible with those desktops until their signed update is installed.
    if (!this.supportsRnnoise) {
      controls = { ...controls };
      delete controls.noiseSuppressionMode;
    }
    if (!this.supportsQuality) {
      controls = { ...controls };
      delete controls.voiceBoost;
    }
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
  async setBitrate(bitrate: number) {
    if (!this.supportsQuality) return false;
    await this.command('set-bitrate', { bitrate });
    return true;
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
      const timer = setTimeout(
        () => {
          this.connectionWaiters.delete(id);
          reject(new Error('Native voice connection timed out'));
          this.fail();
        },
        this.established.has(id) ? voiceRecoveryGraceMs + voiceRecoveryTimeoutMs : 12000,
      );
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
    for (const { transport, stop } of this.transportRecovery.values()) {
      stop();
      transport.dispose();
    }
    this.transportRecovery.clear();
    this.transports.clear();
    this.consumers.clear();
    for (const waiting of this.connectionWaiters.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error('Native voice closed'));
    }
    this.connectionWaiters.clear();
    this.connectionPromises.clear();
    this.connected.clear();
    this.established.clear();
    if (this.producer) this.producer.closed = true;
    void this.bridge.close(this.sessionId).catch(() => undefined);
  };
}
