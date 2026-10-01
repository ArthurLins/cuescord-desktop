// Desktop PCM: signed 16-bit LE, interleaved stereo, 48 kHz. No speaker connection.
class ScreenAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lanes = new Map();
    this.capacity = 24000;
    this.port.onmessage = ({ data: packet }) => {
      if (
        !(packet.data instanceof ArrayBuffer) ||
        packet.data.byteLength > 8192 ||
        typeof packet.lane !== 'string'
      )
        return;
      let lane = this.lanes.get(packet.lane);
      if (!lane) {
        if (this.lanes.size >= 64) return;
        lane = {
          left: new Float32Array(this.capacity),
          right: new Float32Array(this.capacity),
          read: 0,
          write: 0,
          length: 0,
          seen: currentFrame,
        };
        this.lanes.set(packet.lane, lane);
      }
      const bytes = new DataView(packet.data);
      const frames = Math.floor(bytes.byteLength / 4);
      // Drop stale queued audio rather than accumulating delay on a slow renderer.
      if (lane.length + frames > this.capacity) {
        lane.read = lane.write;
        lane.length = 0;
      }
      for (let i = 0; i < frames; i++) {
        lane.left[lane.write] = bytes.getInt16(i * 4, true) / 32768;
        lane.right[lane.write] = bytes.getInt16(i * 4 + 2, true) / 32768;
        lane.write = (lane.write + 1) % this.capacity;
      }
      lane.length += frames;
      lane.seen = currentFrame;
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (const [id, lane] of this.lanes) {
      if (currentFrame - lane.seen > sampleRate * 2 && lane.length === 0) {
        this.lanes.delete(id);
        continue;
      }
      const count = Math.min(left.length, lane.length);
      for (let i = 0; i < count; i++) {
        left[i] += lane.left[lane.read];
        right[i] += lane.right[lane.read];
        lane.read = (lane.read + 1) % this.capacity;
      }
      lane.length -= count;
    }
    for (let i = 0; i < left.length; i++) {
      left[i] = Math.max(-1, Math.min(1, left[i]));
      right[i] = Math.max(-1, Math.min(1, right[i]));
    }
    return true;
  }
}
registerProcessor('cuescord-screen-audio', ScreenAudioProcessor);
