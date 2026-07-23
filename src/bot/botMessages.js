// Tracks message ids the bot itself just sent, so message_create doesn't mistake them for
// manual commands — a send registers an id, a lookup consumes it (one-shot check).
class BotMessageTracker {
  constructor() {
    this.sentIds = new Set();
  }

  record(id) {
    if (id) this.sentIds.add(id);
  }

  consume(id) {
    return this.sentIds.delete(id);
  }
}

const botMessageTracker = new BotMessageTracker();

export async function sendAsBot(sendPromise) {
  const sentMsg = await sendPromise;
  botMessageTracker.record(sentMsg?.id?._serialized);
  return sentMsg;
}

// Returns true (and consumes the entry) if this message id was sent via sendAsBot.
export function wasSentByBot(id) {
  return botMessageTracker.consume(id);
}
