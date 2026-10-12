const AUDIO_GRANT_LIFETIME_MS = 30_000;

// A single-use permission, bound to an opaque owner identity. Electron frames
// are supplied by the adapter; this model never reads windows, clocks or IPC.
class ScreenAudioGrant {
  #owner;
  #expiresAt;
  #claimed = false;

  constructor({ id, owner, config, expiresAt }) {
    this.id = id;
    this.#owner = owner;
    this.config = Object.freeze({ ...config });
    this.#expiresAt = expiresAt;
  }

  claim(owner, now) {
    if (owner !== this.#owner || this.#claimed || now >= this.#expiresAt) return false;
    this.#claimed = true;
    return true;
  }
}

module.exports = { ScreenAudioGrant, AUDIO_GRANT_LIFETIME_MS };
