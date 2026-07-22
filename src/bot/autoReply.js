import pkg from 'whatsapp-web.js';
import { client } from './client.js';
import { PERSONA, HISTORY_LIMIT } from '../tools/config.js';
import { getReply } from '../models/getReply.js';
import { saveMessage, getRecentMessages } from '../tools/AxioDB.js';
import { textToSpeech } from '../tools/tts.js';
import { sleep } from '../tools/rateLimiter.js';
import { sendAsBot } from './botMessages.js';
import { isAutoReplyPaused, getPausedUntil } from './takeover.js';
import { parseReply, humanDelayMs } from './voiceReply.js';
import { getVoiceGender, applyVoiceGenderCommand } from './voicePreference.js';
import { WEB_TOOLS, executeToolCall, wantsForcedSearch, FORCE_WEB_SEARCH_TOOL_CHOICE } from '../tools/webSearch.js';
import { formatIST } from '../tools/time.js';

const { MessageMedia } = pkg;

// In a conversation with Bengali/Banglish-flavored history, the model drifts back toward
// that established momentum even when the current message is plain English — verified live:
// a generic "match this message's language" reminder was not enough to stop it, but stating
// the classification outright ("this message is in English") was. Bengali/Devanagari script
// is unambiguous; Banglish/Hinglish (Latin script) is flagged by the presence of common
// transliterated words, so a Latin-script message with none of them is treated as English.
const BENGALI_SCRIPT = /[ঀ-৿]/;
const DEVANAGARI_SCRIPT = /[ऀ-ॿ]/;
const TRANSLITERATION_MARKERS = /\b(ki|re|bhai|acho|achi|achen|korbo|korchi|korle|korte|hobe|hoyeche|keno|tui|tumi|apni|kemon|bolo|bol|dhur|arre|yaar|kya|hai|hain|nahi|nahin|kar|karo|kaisa|kaise|kahan|thik|acha|accha)\b/i;

function isClearlyEnglish(text) {
  if (BENGALI_SCRIPT.test(text) || DEVANAGARI_SCRIPT.test(text)) return false;
  return !TRANSLITERATION_MARKERS.test(text);
}

const ENGLISH_REMINDER =
  '\n\n[This message is in English — reply only in English, plain casual text, no bold/bullets/headers, regardless of what language earlier messages in this chat used.]';

export function registerAutoReplyHandler() {
  client.on('message', async (msg) => {
    try {
      if (msg.from === 'status@broadcast' || msg.fromMe) return;
      if (msg.from.endsWith('@newsletter')) return; // WhatsApp Channels — one-way broadcasts, not a conversation
      if (!msg.body || !msg.body.trim()) return; // reactions, revokes, etc. fire 'message' with no text

      const chatId = msg.from;

      if (isAutoReplyPaused()) {
        console.log(`[takeover] skipping auto-reply for ${chatId}, paused until ${formatIST(new Date(getPausedUntil()))}`);
        return;
      }

      // Covers Communities too, not just standalone groups — a community's sub-groups
      // (including its announcement group) are still plain @g.us group chats under the
      // hood (just linked to a parent via groupMetadata.parentGroupId), so this gate
      // already applies to them identically: no reply without an explicit @mention.
      const isGroup = chatId.endsWith('@g.us');

      if (isGroup) {
        const mentioned = (msg.mentionedIds ?? []).includes(client.info.wid._serialized);
        const isBroadcastMention = /@all\b|@everyone\b/i.test(msg.body ?? '');
        if (!mentioned || isBroadcastMention) return;
      }

      let realNumber = chatId;
      try {
        realNumber = (await msg.getContact()).number || chatId;
      } catch (err) {
        console.warn('[contact] could not resolve real number, using raw id:', err.message);
      }
      console.log(`[recv] from ${realNumber}: ${msg.body}`);

      const newVoiceGender = applyVoiceGenderCommand(chatId, msg.body);
      if (newVoiceGender) console.log(`[voice] ${realNumber} switched voice to ${newVoiceGender}`);

      let history = [];
      try {
        history = await getRecentMessages(chatId, HISTORY_LIMIT);
      } catch (err) {
        console.warn('[history] could not load persisted history, continuing without it:', err.message);
      }

      let historyMessages;
      if (history.length > 0) {
        historyMessages = history.flatMap((turn) => [
          { role: 'user', content: turn.userMessage },
          { role: 'assistant', content: turn.reply },
        ]);
      } else {
        // Nothing in AxioDB yet for this chat — either the very first message the bot has
        // ever processed from them, or a fresh DB. Either way, AxioDB only knows about turns
        // the bot itself has replied to; it has no record of whatever was actually said in
        // this chat before the bot started running. Pull that real context straight from
        // WhatsApp instead of replying blind on turn one.
        try {
          const chat = await msg.getChat();
          const waMessages = await chat.fetchMessages({ limit: HISTORY_LIMIT });
          historyMessages = waMessages
            .filter((m) => m.body?.trim() && m.id._serialized !== msg.id._serialized)
            .map((m) => ({ role: m.fromMe ? 'assistant' : 'user', content: m.body }));
        } catch (err) {
          console.warn('[history] could not fetch WhatsApp chat history, continuing without it:', err.message);
          historyMessages = [];
        }
      }

      const promptMessages = [
        { role: 'system', content: PERSONA },
        ...historyMessages,
        { role: 'user', content: isClearlyEnglish(msg.body) ? `${msg.body}${ENGLISH_REMINDER}` : msg.body },
      ];
      console.log('[prompt]', { chatId: realNumber, messages: promptMessages });

      const toolChoice = wantsForcedSearch(msg.body) ? FORCE_WEB_SEARCH_TOOL_CHOICE : undefined;
      if (toolChoice) console.log(`[tool] forcing web_search — "${msg.body}" explicitly asked for a search`);

      let text, model;
      try {
        ({ text, model } = await getReply(promptMessages, { tools: WEB_TOOLS, executeTool: executeToolCall, toolChoice }));
      } catch {
        // getReply() already logged which provider(s) failed and why.
        await sendAsBot(msg.reply("Sorry, I couldn't process that right now — please try again shortly."));
        return;
      }

      console.log('[model]', { chatId: realNumber, model });
      console.log('[raw]', { chatId: realNumber, text });

      const { wantsVoice, replyText, spokenText } = parseReply(text);

      const targetDelayMs = humanDelayMs(wantsVoice ? spokenText.length : replyText.length);
      try {
        // Goes straight to the chat-state API with the raw chatId — chat.sendStateTyping()
        // needs a resolved Chat object via msg.getChat(), which is unreliable for @lid
        // (WhatsApp's newer privacy-number) chat IDs. sendChatstate only needs the id string.
        await client.pupPage.evaluate(
          (state, id) => window.WWebJS.sendChatstate(state, id),
          wantsVoice ? 'recording' : 'typing',
          chatId,
        );
      } catch (err) {
        console.warn('[presence] could not show typing/recording state:', err.message);
      }

      if (wantsVoice) {
        const startedAt = Date.now();
        try {
          const audioBuffer = await textToSpeech(spokenText, getVoiceGender(chatId));
          await sleep(Math.max(0, targetDelayMs - (Date.now() - startedAt)));
          const media = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'));
          await sendAsBot(client.sendMessage(chatId, media, { sendAudioAsVoice: true }));
        } catch (err) {
          console.warn('[tts] voice generation failed, falling back to text:', err.message);
          await sendAsBot(msg.reply(replyText));
        }
      } else {
        await sleep(targetDelayMs);
        await sendAsBot(msg.reply(replyText));
      }

      try {
        // Store the raw model output (VOICE: line included), not the stripped replyText —
        // otherwise every past turn shown back to the model omits the required format,
        // and the model pattern-matches its own history over the system prompt's rule.
        await saveMessage(chatId, msg.body, text, model);
      } catch (err) {
        console.warn('[history] could not persist this turn:', err.message);
      }
      console.log(`[sent] to ${realNumber} via ${model}${wantsVoice ? ' (voice)' : ''}: ${replyText}`);
    } catch (err) {
      console.error('message handler error:', err);
    }
  });
}
