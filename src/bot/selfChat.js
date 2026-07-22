import { client } from './client.js';
import { sendAsBot } from './botMessages.js';

// The note-to-self chat's id (a @lid, distinct from client.info.wid) — resolved once at
// startup if that chat already exists, otherwise lazily on the first message sent to it.
let selfChatId = null;

// Set synchronously before a self-chat send starts, so message_create can check it even
// if that event fires before sendMessage()'s own promise resolves (see replyInSelfChat).
let sendingToSelfChat = 0;

export function getSelfChatId() {
  return selfChatId;
}

export function isSendingToSelfChat(chatId) {
  return sendingToSelfChat > 0 && chatId === selfChatId;
}

// Resolve the note-to-self chat up front, so message_create can do a plain string
// compare instead of an async contact lookup on every single message I send.
export async function resolveSelfChatAtStartup() {
  try {
    const chats = await client.getChats();
    for (const chat of chats) {
      const contact = await chat.getContact();
      if (contact.isMe) {
        selfChatId = chat.id._serialized;
        break;
      }
    }
  } catch (err) {
    console.warn('[takeover] could not resolve note-to-self chat at startup:', err.message);
  }
  console.log(
    selfChatId
      ? `[takeover] note-to-self chat control ready (${selfChatId}) — mention "stop" or "start" there to control auto-replies`
      : '[takeover] no note-to-self chat found yet — send yourself any message first (any content, just to establish the chat); after that, mentioning "stop" or "start" there will take effect',
  );
}

// Self-chat wasn't resolved at startup (first-ever message to it) — check authoritatively
// via WhatsApp's own contact resolution (isMe), which correctly handles the @lid aliasing
// that a plain client.info.wid string compare gets wrong. Returns true if `candidateChatId`
// is (now confirmed to be) the self-chat.
export async function resolveSelfChatLazily(candidateChatId) {
  if (selfChatId) return candidateChatId === selfChatId;

  try {
    const toContact = await client.getContactById(candidateChatId);
    if (!toContact.isMe) return false;
  } catch (err) {
    console.warn('[takeover] could not resolve destination contact:', err.message);
    return false;
  }
  selfChatId = candidateChatId;
  console.log(`[takeover] note-to-self chat resolved (${selfChatId})`);
  return true;
}

export async function replyInSelfChat(text) {
  // message_create fires from WhatsApp Web's own internal message stream, independent of
  // when sendMessage()'s promise resolves — it can (and did) fire for our own prompt before
  // botSentMessageIds got a chance to register its id, making the bot process its own
  // "...or "cancel"." confirmation text as if it were my reply. This flag can't race like that,
  // since it's set before the send even starts.
  sendingToSelfChat++;
  try {
    await sendAsBot(client.sendMessage(selfChatId, text));
  } finally {
    sendingToSelfChat--;
  }
}
