/** Producer IPC contract; DOM input coordination belongs to the web app. */
interface PushToTalkState {
  id: string;
  available: boolean;
  global: boolean;
  pressed: boolean;
  sequence: number;
}
export interface PushToTalkBridge {
  status(): Promise<PushToTalkState>;
  configure(value: {
    id: string;
    enabled: boolean;
    shortcut: string;
    suspended: boolean;
  }): Promise<PushToTalkState>;
  release(id: string): Promise<PushToTalkState>;
  subscribe(listener: (state: PushToTalkState) => void): () => void;
}
