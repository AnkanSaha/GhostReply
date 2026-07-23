import { client } from './client.js';
import { sendAsBot } from './botMessages.js';

// Owns the note-to-self chat's identity and the in-flight-send flag that message_create
// checks against — coordinated across startup resolution, lazy resolution, and every send.
class SelfChatResolver {
  constructor() {
    // The note-to-self chat's id (a @lid, distinct from client.info.wid) — resolved once at
    // startup if that chat already exists, otherwise lazily on the first message sent to it.
    this.selfChatId = null;
    // Incremented synchronously before a self-chat send starts, so message_create can check
    // it even if that event fires before sendMessage()'s own promise resolves (see replyIn).
    this.sendingCount = 0;
  }

  isSendingTo(chatId) {
    return this.sendingCount > 0 && chatId === this.selfChatId;
  }

  // Resolve the note-to-self chat up front, so message_create can do a plain string
  // compare instead of an async contact lookup on every single message I send.
  async resolveAtStartup() {
    try {
      const chats = await client.getChats();
      for (const chat of chats) {
        const contact = await chat.getContact();
        if (contact.isMe) {
          this.selfChatId = chat.id._serialized;
          break;
        }
      }
    } catch (err) {
      console.warn('[takeover] could not resolve note-to-self chat at startup:', err.message);
    }
    console.log(
      this.selfChatId
        ? `[takeover] note-to-self chat control ready (${this.selfChatId}) — mention "stop" or "start" there to control auto-replies`
        : '[takeover] no note-to-self chat found yet — send yourself any message first (any content, just to establish the chat); after that, mentioning "stop" or "start" there will take effect',
    );
  }

  // Self-chat wasn't resolved at startup (first-ever message to it) — check authoritatively
  // via WhatsApp's own contact resolution (isMe), which correctly handles the @lid aliasing
  // that a plain client.info.wid string compare gets wrong. Returns true if `candidateChatId`
  // is (now confirmed to be) the self-chat.
  async resolveLazily(candidateChatId) {
    if (this.selfChatId) return candidateChatId === this.selfChatId;

    try {
      const toContact = await client.getContactById(candidateChatId);
      if (!toContact.isMe) return false;
    } catch (err) {
      console.warn('[takeover] could not resolve destination contact:', err.message);
      return false;
    }
    this.selfChatId = candidateChatId;
    console.log(`[takeover] note-to-self chat resolved (${this.selfChatId})`);
    return true;
  }

  async replyInSelfChat(text) {
    // message_create fires from WhatsApp Web's own internal message stream, independent of
    // when sendMessage()'s promise resolves — it can (and did) fire for our own prompt before
    // botSentMessageIds got a chance to register its id, making the bot process its own
    // "...or "cancel"." confirmation text as if it were my reply. This flag can't race like
    // that, since it's set before the send even starts.
    this.sendingCount++;
    try {
      await sendAsBot(client.sendMessage(this.selfChatId, text));
    } finally {
      this.sendingCount--;
    }
  }
}

const selfChatResolver = new SelfChatResolver();

export function getSelfChatId() {
  return selfChatResolver.selfChatId;
}

export function isSendingToSelfChat(chatId) {
  return selfChatResolver.isSendingTo(chatId);
}

export async function resolveSelfChatAtStartup() {
  return selfChatResolver.resolveAtStartup();
}

export async function resolveSelfChatLazily(candidateChatId) {
  return selfChatResolver.resolveLazily(candidateChatId);
}

export async function replyInSelfChat(text) {
  return selfChatResolver.replyInSelfChat(text);
}
