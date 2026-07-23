import { MESSAGE_DEBOUNCE_MS } from '../tools/config.js';

// Owns one pending timer per chat — resetting it on every new message so a burst of
// rapid-fire messages only flushes once, `delayMs` after the last one. The buffered
// messages themselves aren't held here (they're persisted in AxioDB); this only tracks
// the in-memory scheduling state needed to know WHEN to flush.
class MessageDebouncer {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.timers = new Map(); // chatId -> Timeout
  }

  // Replaces any pending timer for this chat — only the most recently scheduled callback
  // ever fires, so callers should always pass a callback that reads current state (e.g.
  // reload pending messages from AxioDB) rather than closing over stale data.
  schedule(chatId, onFlush) {
    clearTimeout(this.timers.get(chatId));
    this.timers.set(
      chatId,
      setTimeout(() => {
        this.timers.delete(chatId);
        onFlush();
      }, this.delayMs),
    );
  }
}

export const messageDebouncer = new MessageDebouncer(MESSAGE_DEBOUNCE_MS);
