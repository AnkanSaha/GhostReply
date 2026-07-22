import { IST_OFFSET_MS } from './config.js';

// Formats any Date/epoch as a readable IST timestamp for logs and user-facing messages —
// e.g. "2026-07-22 21:59:50 IST" — regardless of what timezone the host server itself runs
// in. Shifts the epoch by the IST offset, then reads the UTC-labeled fields back off that
// shifted value (the same trick already used elsewhere in this project for IST wall-clock
// math), since JS has no built-in IST timezone without a full Intl/ICU dependency.
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
