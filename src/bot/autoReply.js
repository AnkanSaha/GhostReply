import pkg from 'whatsapp-web.js';
import { client } from './client.js';
import { PERSONA, HISTORY_LIMIT } from '../tools/config.js';
import { getReply } from '../models/getReply.js';
import { saveMessage, getRecentMessages, savePendingMessage, getPendingMessages, clearPendingMessages } from '../tools/AxioDB.js';
import { textToSpeech } from '../tools/tts.js';
import { sleep } from '../tools/rateLimiter.js';
import { sendAsBot } from './botMessages.js';
import { isAutoReplyPaused, getPausedUntil } from './takeover.js';
import { humanDelayMs, VOICE_REPLY_TOOL } from './voiceReply.js';
import { getVoiceGender, applyVoiceGenderCommand } from './voicePreference.js';
import { messageDebouncer } from './messageDebouncer.js';
import {
  WEB_TOOLS,
  executeToolCall,
  wantsForcedSearch,
  containsUrl,
  FORCE_WEB_SEARCH_TOOL_CHOICE,
  FORCE_SCRAPE_TOOL_CHOICE,
} from '../tools/webSearch.js';
import { formatIST } from '../tools/time.js';
import { detectScript } from '../tools/scriptDetect.js';
import { isStaleMessage } from './startupGuard.js';

const { MessageMedia } = pkg;

const AUTO_REPLY_TOOLS = [...WEB_TOOLS, VOICE_REPLY_TOOL];
const TERMINAL_TOOLS = new Set([VOICE_REPLY_TOOL.function.name]);

// A long Banglish/Hinglish history pulls the model's reply language back toward that
// momentum even when the current message is plain English, so tag every message with its
// actual script to force a fresh per-turn judgment — no word list guessing English vs.
// Banglish, that's left to the model, which is fine at it once not defaulting to history.
function scriptTag(text) {
  const script = detectScript(text);
  if (script === 'bn') return '\n\n[Script check: this message is written in Bengali script.]';
  if (script === 'hi') return '\n\n[Script check: this message is written in Devanagari/Hindi script.]';
  return '\n\n[Script check: this message is in Latin script — judge from its actual words alone whether it is plain English or Banglish/Hinglish, regardless of what language earlier messages in this chat used.]';
}

// Runs once the debounce window closes with no further message — bundles every message
// buffered during the burst into one combined turn, one LLM call, one reply. `anchorMsg`
// is the last message of the burst, used for anything that needs an actual Message/Chat
// object (replying, resolving the contact, reading WhatsApp's own history).
async function processBurst(anchorMsg) {
  const chatId = anchorMsg.from;

  let pending;
  try {
    pending = await getPendingMessages(chatId);
  } catch (err) {
    console.warn('[debounce] could not load pending messages, using just the latest:', err.message);
    pending = [];
  }
  const combinedBody = pending.length ? pending.map((m) => m.body).join('\n') : anchorMsg.body;

  let realNumber = chatId;
  try {
    realNumber = (await anchorMsg.getContact()).number || chatId;
  } catch (err) {
    console.warn('[contact] could not resolve real number, using raw id:', err.message);
  }
  console.log(`[recv] from ${realNumber}: ${combinedBody}`);

  const newVoiceGender = applyVoiceGenderCommand(chatId, combinedBody);
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
      const chat = await anchorMsg.getChat();
      const waMessages = await chat.fetchMessages({ limit: HISTORY_LIMIT });
      historyMessages = waMessages
        .filter((m) => m.body?.trim() && m.id._serialized !== anchorMsg.id._serialized)
        .map((m) => ({ role: m.fromMe ? 'assistant' : 'user', content: m.body }));
    } catch (err) {
      console.warn('[history] could not fetch WhatsApp chat history, continuing without it:', err.message);
      historyMessages = [];
    }
  }

  const promptMessages = [
    { role: 'system', content: PERSONA },
    ...historyMessages,
    { role: 'user', content: `${combinedBody}${scriptTag(combinedBody)}` },
  ];
  console.log('[prompt]', { chatId: realNumber, messages: promptMessages });

  let toolChoice;
  if (containsUrl(combinedBody)) {
    toolChoice = FORCE_SCRAPE_TOOL_CHOICE;
    console.log(`[tool] forcing scrape_url — "${combinedBody}" contains a link`);
  } else if (wantsForcedSearch(combinedBody)) {
    toolChoice = FORCE_WEB_SEARCH_TOOL_CHOICE;
    console.log(`[tool] forcing web_search — "${combinedBody}" explicitly asked for a search`);
  }

  let text, model, toolCall;
  try {
    ({ text, model, toolCall } = await getReply(promptMessages, {
      tools: AUTO_REPLY_TOOLS,
      executeTool: executeToolCall,
      toolChoice,
      terminalTools: TERMINAL_TOOLS,
    }));
  } catch {
    // getReply() already logged which provider(s) failed and why.
    await sendAsBot(anchorMsg.reply("Sorry, I couldn't process that right now — please try again shortly."));
    try {
      await clearPendingMessages(chatId);
    } catch (err) {
      console.warn('[debounce] could not clear pending messages:', err.message);
    }
    return;
  }

  console.log('[model]', { chatId: realNumber, model });

  let wantsVoice, replyText, spokenText;
  if (toolCall) {
    const args = JSON.parse(toolCall.function.arguments);
    wantsVoice = true;
    replyText = args.text;
    spokenText = args.spokenText || args.text;
    console.log('[raw]', { chatId: realNumber, toolCall: args });
  } else {
    wantsVoice = false;
    replyText = text.trim();
    spokenText = replyText;
    console.log('[raw]', { chatId: realNumber, text });
  }

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
      await sendAsBot(anchorMsg.reply(replyText));
    }
  } else {
    await sleep(targetDelayMs);
    await sendAsBot(anchorMsg.reply(replyText));
  }

  try {
    // combinedBody, not just anchorMsg.body — this turn's "user message" is the whole
    // bundled burst, so future history reflects what was actually replied to.
    await saveMessage(chatId, combinedBody, replyText, model);
  } catch (err) {
    console.warn('[history] could not persist this turn:', err.message);
  }

  try {
    await clearPendingMessages(chatId);
  } catch (err) {
    console.warn('[debounce] could not clear pending messages:', err.message);
  }

  console.log(`[sent] to ${realNumber} via ${model}${wantsVoice ? ' (voice)' : ''}: ${replyText}`);
}

export function registerAutoReplyHandler() {
  client.on('message', async (msg) => {
    try {
      if (msg.from === 'status@broadcast' || msg.fromMe) return;
      if (msg.from.endsWith('@newsletter')) return; // WhatsApp Channels — one-way broadcasts, not a conversation
      if (!msg.body || !msg.body.trim()) return; // reactions, revokes, etc. fire 'message' with no text
      if (isStaleMessage(msg)) {
        console.log(`[autoReply] skipping stale message from ${msg.from} (sent before this session started)`);
        return;
      }

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

      try {
        await savePendingMessage(chatId, msg.body);
      } catch (err) {
        console.warn('[debounce] could not persist pending message:', err.message);
      }
      console.log(`[debounce] buffering message from ${chatId}: ${msg.body}`);

      // Resets on every message in this chat — a rapid burst only flushes once, this many
      // ms after the last one, bundled into a single LLM call and a single reply.
      messageDebouncer.schedule(chatId, () => {
        processBurst(msg).catch((err) => console.error('[autoReply] burst processing error:', err));
      });
    } catch (err) {
      console.error('message handler error:', err);
    }
  });
}
