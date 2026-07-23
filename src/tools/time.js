import { IST_OFFSET_MS } from './config.js';

// Formats any Date as a readable IST timestamp regardless of the host's own timezone, by
// shifting the epoch and reading UTC-labeled fields back off it — avoids a full Intl/ICU
// timezone dependency for a single fixed offset.
export function formatIST(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  const y = shifted.getUTCFullYear();
  const mo = pad(shifted.getUTCMonth() + 1);
  const d = pad(shifted.getUTCDate());
  const h = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  const s = pad(shifted.getUTCSeconds());
  return `${y}-${mo}-${d} ${h}:${mi}:${s} IST`;
}
