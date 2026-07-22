import { getReply } from '../models/getReply.js';
import { SEND_EXTRACT_PROMPT, SEND_CONFIRM_PROMPT, MIN_CONTACT_NUMBER_DIGITS, MIN_RAW_NUMBER_DIGITS } from './config.js';

function parseJsonReply(raw) {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    if (parsed?.recipient && parsed?.message) {
      return {
        recipient: parsed.recipient,
        message: parsed.message,
        wantsVoice: parsed.wantsVoice === true,
        spokenMessage: parsed.wantsVoice === true ? (parsed.spokenMessage || parsed.message) : null,
        voiceGender: parsed.voiceGender === 'female' ? 'female' : 'male',
      };
    }
  } catch {
    // malformed JSON from the model — treat as "not a send instruction"
  }
  return null;
}

export async function extractSendInstruction(text) {
  const { text: raw, model } = await getReply([
    { role: 'system', content: SEND_EXTRACT_PROMPT },
    { role: 'user', content: `Instruction: "${text}"` },
  ]);
  console.log('[relay] model used:', model);
  console.log('[relay] raw response:', raw);
  return parseJsonReply(raw);
}

function parseConfirmationJson(raw) {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    if (['confirm', 'cancel', 'replace'].includes(parsed?.action)) return parsed;
  } catch {
    // malformed JSON — fall back to treating it as a cancel, safer than guessing send
  }
  return { action: 'cancel', newMessage: null };
}

const EXACT_CONFIRM = new Set(['yes', 'y', 'confirm', 'send', 'ok', 'okay']);
const EXACT_CANCEL = new Set(['no', 'n', 'cancel', 'nevermind', 'never mind']);

// Interprets a reply to a "send to X?" confirmation prompt. Handles the obvious single-word
// cases directly (no API call), and defers anything more nuanced — like "no no send, say
// this instead" — to the model, since naive keyword matching can't tell "no" + "send" apart
// from an actual yes when both appear as whole words in the same reply.
export async function interpretConfirmationReply(draftMessage, replyText) {
  const normalized = replyText.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (EXACT_CONFIRM.has(normalized)) return { action: 'confirm', newMessage: null };
  if (EXACT_CANCEL.has(normalized)) return { action: 'cancel', newMessage: null };

  const { text: raw, model } = await getReply([
    { role: 'system', content: SEND_CONFIRM_PROMPT },
    { role: 'user', content: `Draft: "${draftMessage}"\nReply: "${replyText}"` },
  ]);
  console.log('[relay] model used:', model);
  console.log('[relay] raw response:', raw);
  return parseConfirmationJson(raw);
}

function extractDigits(text) {
  return text.replace(/\D/g, '');
}

export async function findMatchingContacts(client, recipientName) {
  const contacts = await client.getContacts();
  const needle = recipientName.toLowerCase();
  const needleDigits = extractDigits(recipientName);
  const matches = contacts.filter((c) => {
    if (c.isMe) return false;
    const name = (c.name ?? '').toLowerCase();
    const pushname = (c.pushname ?? '').toLowerCase();
    if (name.includes(needle) || pushname.includes(needle)) return true;
    if (needleDigits.length < MIN_CONTACT_NUMBER_DIGITS) return false;
    return extractDigits(c.number ?? '').includes(needleDigits);
  });

  // WhatsApp's newer @lid privacy IDs mean the same real contact often appears twice —
  // once under their real number (@c.us), once under an internal @lid alias whose "number"
  // isn't an actual phone number. Dedupe by display name, preferring the @c.us entry so we
  // message the real number rather than a duplicate alias.
  const byName = new Map();
  for (const contact of matches) {
    const key = contact.name || contact.pushname || contact.number;
    const existing = byName.get(key);
    if (!existing || (existing.id.server === 'lid' && contact.id.server === 'c.us')) {
      byName.set(key, contact);
    }
  }
  return [...byName.values()];
}

export function contactLabel(contact) {
  return `${contact.name || contact.pushname || contact.number} (${contact.number})`;
}

// Resolves a phone number typed directly in the instruction (no saved contact needed) to
// a WhatsApp id, for when findMatchingContacts finds nothing — covers numbers not yet
// saved as a contact, or typed in full to sidestep a name-matching mixup.
export async function resolveRawNumber(client, recipientText) {
  const digits = extractDigits(recipientText);
  if (digits.length < MIN_RAW_NUMBER_DIGITS) return null;
  try {
    const numberId = await client.getNumberId(digits);
    if (!numberId) return null;
    return { id: numberId._serialized, label: `+${digits}` };
  } catch (err) {
    console.warn('[relay] getNumberId failed:', err.message);
    return null;
  }
}
