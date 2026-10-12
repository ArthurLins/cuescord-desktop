/** Producer IPC contract implemented by the sandboxed preload. Browser session
 * orchestration belongs to the base web application. */
interface NativeVoiceStatus {
  protocol: 1;
  available: boolean;
  enabled: boolean;
  active: boolean;
  engine: string;
  noiseSuppressionModes?: Array<'native' | 'rnnoise'>;
  voiceQualityProtocol?: number;
  lastStopReason?: string;
}
type NativeNoiseStatus = 'off' | 'native' | 'loading' | 'rnnoise' | 'fallback';
interface NativeVoiceEvent {
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
interface NativeVoiceDevice {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput';
  label: string;
}
