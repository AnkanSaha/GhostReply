// Global per-key request pacer. Calls sharing a key are spaced at least
// minIntervalMs apart; a burst of calls queues up (FIFO, by reserved slot)
// instead of firing at once and blowing through a provider's rate limit.
const nextAvailable = new Map(); // key -> timestamp (ms) the next call may start at

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function throttle(key, minIntervalMs) {
  if (!minIntervalMs) return;

  const now = Date.now();
  const runAt = Math.max(now, nextAvailable.get(key) ?? 0);
  nextAvailable.set(key, runAt + minIntervalMs);

  const wait = runAt - now;
  if (wait > 0) await sleep(wait);
}
