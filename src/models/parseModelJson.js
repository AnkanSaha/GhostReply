// Models are told to reply with raw JSON only, but sometimes wrap it in a ```json fence
// anyway — strip that before JSON.parse. Shared by every caller that parses a classification
// reply (relay.js, tools/scheduler.js, takeover.js).
export function stripCodeFence(raw) {
  return raw.trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
}
