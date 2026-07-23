import pkg from 'whatsapp-web.js';
import { client } from './client.js';
import { replyInSelfChat } from './selfChat.js';
import { extractSendInstruction, findMatchingContacts, contactLabel, interpretConfirmationReply, resolveRawNumber } from '../tools/relay.js';
import { textToSpeech } from '../tools/tts.js';

const { MessageMedia } = pkg;

// Only used for disambiguation ("cancel" vs a numeric pick) — the confirm step's own
// yes/no/replace decision goes through interpretConfirmationReply instead (see below).
// Exported so scheduler.js's own disambiguation flow uses the exact same cancel wording.
export const CANCEL_REGEX = /\b(no|cancel|nevermind|never ?mind|stop|abort)\b/i;

// Owns the pending "message someone" action from the note-to-self chat — only one at a
// time. current: null, or { type: 'confirm', contactId, label, message, wantsVoice,
// spokenMessage, voiceGender }, or { type: 'disambiguate', candidates, ...same fields }.
class PendingSendState {
  constructor() {
    this.current = null;
  }
}

const pendingSendState = new PendingSendState();

export function hasPendingSend() {
  return pendingSendState.current !== null;
}

function confirmPrompt(pending) {
  const voiceTag = pending.wantsVoice ? ' (voice message)' : '';
  return `Send${voiceTag} to ${pending.label}: "${pending.message}"?\nReply "yes" to send, "no" to cancel, or tell me what to say instead.`;
}

export async function handlePendingSend(body) {
  const normalized = body.trim();

  if (pendingSendState.current.type === 'disambiguate') {
    if (CANCEL_REGEX.test(normalized)) {
      console.log('[relay] disambiguation cancelled');
      pendingSendState.current = null;
      await replyInSelfChat('Cancelled.');
      return;
    }
    const idx = Number.parseInt(normalized, 10);
    const candidate = Number.isInteger(idx) ? pendingSendState.current.candidates[idx - 1] : null;
    if (!candidate) {
      console.log(`[relay] invalid disambiguation choice: "${normalized}"`);
      await replyInSelfChat('Not a valid choice — reply with a number from the list, or "cancel".');
      return;
    }
    console.log(`[relay] disambiguation resolved to ${candidate.label}, awaiting confirmation`);
    pendingSendState.current = {
      type: 'confirm',
      contactId: candidate.id,
      label: candidate.label,
      message: pendingSendState.current.message,
      wantsVoice: pendingSendState.current.wantsVoice,
      spokenMessage: pendingSendState.current.spokenMessage,
      voiceGender: pendingSendState.current.voiceGender,
    };
    await replyInSelfChat(confirmPrompt(pendingSendState.current));
    return;
  }

  // type === 'confirm' — interpreted by the model, not naive keyword matching: a reply like
  // "no no send, say X instead" contains both "no" and "send" as whole words, so simple
  // regex can't tell a real confirm from a rejection-with-replacement.
  const decision = await interpretConfirmationReply(pendingSendState.current.message, normalized);
  console.log('[relay] confirmation decision:', decision);

  if (decision.action === 'confirm') {
    const { contactId, label, message, wantsVoice, spokenMessage, voiceGender } = pendingSendState.current;
    pendingSendState.current = null;
    try {
      if (wantsVoice) {
        const audioBuffer = await textToSpeech(spokenMessage || message, voiceGender);
        const media = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'));
        await client.sendMessage(contactId, media, { sendAudioAsVoice: true });
      } else {
        await client.sendMessage(contactId, message);
      }
      console.log(`[relay] sent to ${label}${wantsVoice ? ' (voice)' : ''}: "${message}"`);
      await replyInSelfChat('Sent.');
    } catch (err) {
      console.warn(`[relay] failed to send to ${label}:`, err.message);
      await replyInSelfChat(`Failed to send: ${err.message}`);
    }
  } else if (decision.action === 'replace') {
    console.log(`[relay] draft replaced for ${pendingSendState.current.label}: "${decision.newMessage}"`);
    // No re-transliteration on replace — the new content goes to TTS as-is if this was a
    // voice request. textToSpeech() still does its own script detection/fallback either way.
    pendingSendState.current = {
      ...pendingSendState.current,
      message: decision.newMessage,
      spokenMessage: pendingSendState.current.wantsVoice ? decision.newMessage : null,
    };
    await replyInSelfChat(confirmPrompt(pendingSendState.current));
  } else {
    console.log(`[relay] send to ${pendingSendState.current.label} cancelled`);
    pendingSendState.current = null;
    await replyInSelfChat('Cancelled.');
  }
}

export async function tryStartSendInstruction(body) {
  const parsed = await extractSendInstruction(body);
  if (!parsed) {
    console.log(`[relay] not a send instruction: "${body}"`);
    return;
  }

  console.log('[relay] send instruction detected:', parsed);

  const matches = await findMatchingContacts(client, parsed.recipient);
  console.log(`[relay] ${matches.length} contact match(es) for "${parsed.recipient}"`);

  if (matches.length === 0) {
    const raw = await resolveRawNumber(client, parsed.recipient);
    if (raw) {
      console.log(`[relay] resolved raw number: ${raw.label}, awaiting confirmation`);
      pendingSendState.current = {
        type: 'confirm',
        contactId: raw.id,
        label: raw.label,
        message: parsed.message,
        wantsVoice: parsed.wantsVoice,
        spokenMessage: parsed.spokenMessage,
        voiceGender: parsed.voiceGender,
      };
      await replyInSelfChat(confirmPrompt(pendingSendState.current));
    } else {
      console.log(`[relay] no contact match for "${parsed.recipient}"`);
      await replyInSelfChat(`Couldn't find anyone matching "${parsed.recipient}" in your contacts.`);
    }
  } else if (matches.length === 1) {
    const label = contactLabel(matches[0]);
    console.log(`[relay] single match: ${label}, awaiting confirmation`);
    pendingSendState.current = {
      type: 'confirm',
      contactId: matches[0].id._serialized,
      label,
      message: parsed.message,
      wantsVoice: parsed.wantsVoice,
      spokenMessage: parsed.spokenMessage,
      voiceGender: parsed.voiceGender,
    };
    await replyInSelfChat(confirmPrompt(pendingSendState.current));
  } else {
    const candidates = matches.slice(0, 8).map((c) => ({ id: c.id._serialized, label: contactLabel(c) }));
    console.log('[relay] multiple matches, awaiting disambiguation:', candidates.map((c) => c.label));
    pendingSendState.current = {
      type: 'disambiguate',
      candidates,
      message: parsed.message,
      wantsVoice: parsed.wantsVoice,
      spokenMessage: parsed.spokenMessage,
      voiceGender: parsed.voiceGender,
    };
    const list = candidates.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
    await replyInSelfChat(`Multiple matches for "${parsed.recipient}":\n${list}\nReply with a number, or "cancel".`);
  }
}
