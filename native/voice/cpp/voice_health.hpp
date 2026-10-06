#pragma once
#include <algorithm>
#include <cstdint>

enum class RecoveryDecision { None, Network, Recover, Exhausted };

// A symptom must persist for three measured windows after a ten-second warm-up.
// Real packet loss does not justify resetting a healthy receiver. Two local
// repairs per session, spaced by 30 s, bound interruptions and fallback loops.
class QualityWatchdog {
  unsigned badWindows = 0, repairs = 0;
  int64_t started = -1, repairedAt = -1;

 public:
  RecoveryDecision observe(int64_t now, bool complete, bool bad, bool networkBad = false) {
    if (started < 0) started = now;
    if (!complete || now - started < 10000) {
      badWindows = 0;
      return RecoveryDecision::None;
    }
    if (networkBad) {
      badWindows = 0;
      return bad ? RecoveryDecision::Network : RecoveryDecision::None;
    }
    if (!bad) {
      badWindows = 0;
      return RecoveryDecision::None;
    }
    if (repairedAt >= 0 && now - repairedAt < 30000) {
      badWindows = 0;
      return RecoveryDecision::None;
    }
    if (++badWindows < 3) return RecoveryDecision::None;
    badWindows = 0;
    if (repairs >= 2) return RecoveryDecision::Exhausted;
    ++repairs;
    repairedAt = now;
    return RecoveryDecision::Recover;
  }
};

struct ReceiverQualitySample {
  uint64_t samples = 0, concealed = 0, accelerated = 0, received = 0, lost = 0;
};

class ReceiverQualityMonitor {
  QualityWatchdog watchdog;
  ReceiverQualitySample previous;
  bool sampled = false;

 public:
  void resetSamples() { sampled = false; }
  RecoveryDecision observe(int64_t now, bool complete, const ReceiverQualitySample& current) {
    const auto delta = [](uint64_t value, uint64_t before) {
      return value >= before ? value - before : 0;
    };
    const auto packets = delta(current.received, previous.received);
    const double samples = double(delta(current.samples, previous.samples));
    const auto lost = delta(current.lost, previous.lost);
    const double loss = double(lost) / std::max<double>(1, packets + lost);
    // DTX and paused senders can create concealment with no broken decoder.
    // A decreasing counter indicates a restarted stream, not a bad window.
    const bool continuous =
        sampled && current.samples >= previous.samples && current.received >= previous.received &&
        current.concealed >= previous.concealed && current.accelerated >= previous.accelerated &&
        current.lost >= previous.lost;
    const bool measurable = complete && continuous && samples > 0 && packets >= 20;
    const bool bad =
        samples > 0 && (delta(current.concealed, previous.concealed) / samples > 0.15 ||
                        delta(current.accelerated, previous.accelerated) / samples > 0.05);
    previous = current;
    sampled = complete;
    return watchdog.observe(now, measurable, bad, loss > 0.03);
  }
};
