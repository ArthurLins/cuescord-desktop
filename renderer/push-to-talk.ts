import { mouseShortcut } from './push-to-talk-binding.cjs';

export const PUSH_TO_TALK_RECORDING = 'cuescord:ptt-recording';
export interface PushToTalkState {
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
export function getPushToTalkBridge(): PushToTalkBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __CUESCORD_DESKTOP__?: { pushToTalk?: PushToTalkBridge } })
    .__CUESCORD_DESKTOP__?.pushToTalk;
}

/** One owner per call/binding. The desktop owns global input; DOM is the
 * focused fallback for browsers, old desktops and unsupported platforms. */
export function attachPushToTalkInput({
  target,
  shortcut,
  bridge,
  onPressed,
}: {
  target: Window;
  shortcut: string;
  bridge?: PushToTalkBridge;
  onPressed(pressed: boolean): void;
}) {
  let disposed = false,
    recording = target.document.documentElement.hasAttribute('data-ptt-recording'),
    global = Boolean(bridge),
    pressed = false;
  let id = '';
  let lastSequence = -1;
  function set(value: boolean) {
    if (pressed === value) return;
    pressed = value;
    onPressed(value);
  }
  const receive = (value: PushToTalkState) => {
    if (disposed || value.id !== id || value.sequence < lastSequence) return;
    lastSequence = value.sequence;
    global = value.global;
    set(!recording && value.pressed);
  };
  const unsubscribe = bridge?.subscribe(receive);
  function configure() {
    set(false);
    id = target.crypto.randomUUID();
    lastSequence = -1;
    const current = id;
    if (bridge) {
      global = true;
      void bridge
        .configure({ id, enabled: true, shortcut, suspended: recording })
        .then(receive)
        .catch(() => {
          if (!disposed && id === current) {
            global = false;
            set(false);
          }
        });
    }
  }
  const keyDown = (event: KeyboardEvent) => {
    if (!global && !recording && !event.repeat && event.code === shortcut) set(true);
  };
  const keyUp = (event: KeyboardEvent) => {
    if (!global && event.code === shortcut) set(false);
  };
  const mouseDown = (event: MouseEvent) => {
    if (mouseShortcut(event.button) === shortcut && event.button >= 3) event.preventDefault();
    if (!global && !recording && mouseShortcut(event.button) === shortcut) set(true);
  };
  const mouseUp = (event: MouseEvent) => {
    if (mouseShortcut(event.button) !== shortcut) return;
    if (event.button >= 3) event.preventDefault();
    if (!global) set(false);
  };
  const mouseAction = (event: MouseEvent) => {
    if (mouseShortcut(event.button) === shortcut) event.preventDefault();
  };
  const blur = () => {
    if (!global) set(false);
  };
  const record = (event: Event) => {
    recording = Boolean((event as CustomEvent<boolean>).detail);
    configure();
  };
  const listeners = {
    keydown: keyDown,
    keyup: keyUp,
    mousedown: mouseDown,
    mouseup: mouseUp,
    auxclick: mouseAction,
    contextmenu: mouseAction,
    blur,
    [PUSH_TO_TALK_RECORDING]: record,
  };
  for (const [name, handler] of Object.entries(listeners))
    target.addEventListener(name, handler as EventListener);
  onPressed(false);
  configure();
  return () => {
    if (disposed) return;
    disposed = true;
    for (const [name, handler] of Object.entries(listeners))
      target.removeEventListener(name, handler as EventListener);
    unsubscribe?.();
    set(false);
    if (bridge) void bridge.release(id).catch(() => undefined);
  };
}
