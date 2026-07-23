// WhatsApp Web's reconnect/history-sync can replay 'message'/'message_create' events for
// messages that arrived while this session was disconnected (e.g. the app was closed and
// you chatted normally in the meantime) — they aren't actually new. Ignore anything that
// predates this process's own startup instant so a restart can't retroactively auto-reply
// to, or re-run a command against, a message already handled while the bot was off.
const startedAt = Date.now();

export function isStaleMessage(msg) {
  return msg.timestamp * 1000 < startedAt;
}
