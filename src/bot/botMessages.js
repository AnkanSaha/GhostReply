// message IDs the bot itself just sent, so message_create doesn't mistake them for manual commands.
const botSentMessageIds = new Set();

export async function sendAsBot(sendPromise) {
  const sentMsg = await sendPromise;
  if (sentMsg?.id?._serialized) botSentMessageIds.add(sentMsg.id._serialized);
  return sentMsg;
}

// Returns true (and consumes the entry) if this message id was sent via sendAsBot.
export function wasSentByBot(id) {
  return botSentMessageIds.delete(id);
}
