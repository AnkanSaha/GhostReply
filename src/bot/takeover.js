import { HUMAN_TAKEOVER_MINUTES, TAKEOVER_DURATION_PROMPT, TAKEOVER_MAX_WORDS_FOR_BARE_COMMAND } from '../tools/config.js';
import { getReply } from '../models/getReply.js';
import { replyInSelfChat } from './selfChat.js';
import { formatIST } from '../tools/time.js';

// Word-boundary match, not an exact phrase — catches natural phrasing like "please stop
// the auto reply" or "start it again", not just the literal words "stop"/"start" alone.
const STOP_REGEX = /\b(stop|disable)\b/i;
const START_REGEX = /\bstart\b/i;

// A bare "stop"/"start" word only counts as a takeover command if it's either said
// explicitly about the auto-reply/bot, or the message is short enough to plausibly BE
// the command itself — otherwise "start"/"stop" showing up incidentally inside an
// unrelated longer instruction (e.g. "phone number start with 88176...") would get
// swallowed here before it ever reaches relay/schedule parsing.
const EXPLICIT_CONTEXT_REGEX = /\b(auto[- ]?repl(?:y|ies)|autoreply|bot|ai)\b/i;

function isTakeoverPhrase(body, regex) {
  if (!regex.test(body)) return false;
  if (EXPLICIT_CONTEXT_REGEX.test(body)) return true;
  return body.trim().split(/\s+/).length <= TAKEOVER_MAX_WORDS_FOR_BARE_COMMAND;
}

// Timestamp until which ALL auto-replies are paused; 0 = not paused.
let pausedUntil = 0;

export function isAutoReplyPaused() {
  return pausedUntil !== 0 && Date.now() < pausedUntil;
}

export function getPausedUntil() {
  return pausedUntil;
}

// Returns a positive minute count if the stop instruction mentioned a duration, else null
// (caller falls back to the configured default). Goes through the same Mistral-then-
// OpenRouter fallback as everything else, so a Mistral outage doesn't silently degrade
// this to always-default before OpenRouter even gets a chance.
async function extractStopDuration(body) {
  try {
    const { text: raw, model } = await getReply([
      { role: 'system', content: TAKEOVER_DURATION_PROMPT },
      { role: 'user', content: `Instruction: "${body}"` },
    ]);
    console.log('[takeover] model used:', model);
    console.log('[takeover] raw response:', raw);
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.minutes === 'number' && parsed.minutes > 0) return parsed.minutes;
  } catch (err) {
    console.warn('[takeover] duration extraction failed, using default:', err.message);
  }
  return null;
}

// Returns true if `body` was a stop/start command (and applied its side effects),
// false if it wasn't a takeover command at all.
export async function tryHandleTakeoverCommand(body) {
  if (isTakeoverPhrase(body, STOP_REGEX)) {
    const minutes = (await extractStopDuration(body)) ?? HUMAN_TAKEOVER_MINUTES;
    pausedUntil = Date.now() + minutes * 60_000;
    const resumeAt = formatIST(new Date(pausedUntil));
    console.log(
      `[takeover] human takeover — auto-reply disabled for ${minutes} min, ` +
        `will resume at ${resumeAt} (mention "start" to resume sooner)`,
    );
    try {
      await replyInSelfChat(
        `Auto-reply disabled for ${minutes} min, will resume at ${resumeAt} (mention "start" to resume sooner).`,
      );
    } catch (err) {
      console.warn('[takeover] failed to send confirmation:', err.message);
    }
    return true;
  }

  if (isTakeoverPhrase(body, START_REGEX)) {
    pausedUntil = 0;
    console.log('[takeover] auto-reply resumed');
    try {
      await replyInSelfChat('Auto-reply resumed.');
    } catch (err) {
      console.warn('[takeover] failed to send confirmation:', err.message);
    }
    return true;
  }

  return false;
}
