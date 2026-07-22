import { VOICE_REPLY_MIN_DELAY_MS, VOICE_REPLY_MAX_DELAY_MS, VOICE_REPLY_MS_PER_CHAR } from '../tools/config.js';

// Every reply must start with "VOICE: yes"/"VOICE: no" (see the Response format rule
// in the persona) — an unconditional prefix the model follows far more reliably than
// a marker it only has to remember to add sometimes.
const VOICE_LINE_REGEX = /^\s*voice:\s*(yes|no)\s*\n?/i;

export function parseReply(text) {
  const match = text.match(VOICE_LINE_REGEX);
  const wantsVoice = match ? match[1].toLowerCase() === 'yes' : false;
  const rest = match ? text.slice(match[0].length) : text;

  if (!wantsVoice) {
    const replyText = rest.trim();
    return { wantsVoice, replyText, spokenText: replyText };
  }

  const splitAt = rest.indexOf('\n');
  const replyText = (splitAt === -1 ? rest : rest.slice(0, splitAt)).trim();
  const spokenText = splitAt === -1 ? replyText : rest.slice(splitAt + 1).trim() || replyText;
  return { wantsVoice, replyText, spokenText };
}

// A speedy-typist pace, capped so long replies don't drag out the wait.
export function humanDelayMs(charCount) {
  return Math.min(VOICE_REPLY_MAX_DELAY_MS, Math.max(VOICE_REPLY_MIN_DELAY_MS, charCount * VOICE_REPLY_MS_PER_CHAR));
}
