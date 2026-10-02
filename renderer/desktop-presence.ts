export interface DesktopPresenceState {
  unreadCount: number;
  inCall: boolean;
  microphoneMuted: boolean;
}

export function updateDesktopPresence(state: DesktopPresenceState) {
  if (typeof window === 'undefined') return Promise.resolve();
  const desktop = (
    window as Window & {
      __CUESCORD_DESKTOP__?: {
        presence?: { update(state: DesktopPresenceState): Promise<void> };
      };
    }
  ).__CUESCORD_DESKTOP__;
  return desktop?.presence?.update(state) ?? Promise.resolve();
}
