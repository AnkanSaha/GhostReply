import { VOICE_REPLY_MIN_DELAY_MS, VOICE_REPLY_MAX_DELAY_MS, VOICE_REPLY_MS_PER_CHAR } from '../tools/config.js';

// A speedy-typist pace, capped so long replies don't drag out the wait.
export function humanDelayMs(charCount) {
  return Math.min(VOICE_REPLY_MAX_DELAY_MS, Math.max(VOICE_REPLY_MIN_DELAY_MS, charCount * VOICE_REPLY_MS_PER_CHAR));
}

// Calling this IS the model's decision to reply with voice instead of plain text — no
// VOICE: yes/no prefix to parse. getReply() treats it as terminal (see terminalTools):
// its arguments are the final answer, not a result to feed back for another completion.
export const VOICE_REPLY_TOOL = {
  type: 'function',
  function: {
    name: 'send_voice_reply',
    description:
      'Reply with a voice note instead of plain text. Call this when they asked to hear or receive a voice message, or the moment genuinely calls for one — never to narrate that voice is being used.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The reply as normal chat text.' },
        spokenText: {
          type: 'string',
          description:
            'The same reply rewritten for correct pronunciation when read aloud — Banglish to Bengali script, Hinglish to Devanagari, otherwise unchanged.',
        },
      },
      required: ['text', 'spokenText'],
    },
  },
};
