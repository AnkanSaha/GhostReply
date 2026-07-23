export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global per-key request pacer. Calls sharing a key are spaced at least
// minIntervalMs apart; a burst of calls queues up (FIFO, by reserved slot)
// instead of firing at once and blowing through a provider's rate limit.
export class RequestThrottle {
  constructor() {
    this.nextAvailable = new Map(); // key -> timestamp (ms) the next call may start at
  }

  async wait(key, minIntervalMs) {
    if (!minIntervalMs) return;

    const now = Date.now();
    const runAt = Math.max(now, this.nextAvailable.get(key) ?? 0);
    this.nextAvailable.set(key, runAt + minIntervalMs);

    const wait = runAt - now;
    if (wait > 0) await sleep(wait);
  }
}

const sharedThrottle = new RequestThrottle();

export async function throttle(key, minIntervalMs) {
  return sharedThrottle.wait(key, minIntervalMs);
}
