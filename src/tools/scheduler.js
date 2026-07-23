import { getReply, logModelUsage } from '../models/getReply.js';
import { stripCodeFence } from '../models/parseModelJson.js';
import { SCHEDULE_EXTRACT_PROMPT, scheduledMessagePrompt } from './config.js';

function parseScheduleJson(raw) {
  try {
    const parsed = JSON.parse(stripCodeFence(raw));

    if (parsed?.action === 'create' && Array.isArray(parsed.recipients) && parsed.recipients.length && Array.isArray(parsed.entries) && parsed.entries.length) {
      return {
        action: 'create',
        recipients: parsed.recipients,
        entries: parsed.entries.map((e) => ({
          time: e.time,
          topic: e.topic,
          recurring: e.recurring === true,
          verbatim: e.verbatim === true,
        })),
      };
    }
    if (parsed?.action === 'list') return { action: 'list' };
    if (parsed?.action === 'incomplete') return { action: 'incomplete', missing: parsed.missing ?? 'time' };
    if (parsed?.action === 'delete') {
      return {
        action: 'delete',
        time: parsed.time ?? null,
        topic: parsed.topic ?? null,
        recipient: parsed.recipient ?? null,
        all: parsed.all === true,
      };
    }
  } catch {
    // malformed JSON — treat as "not a schedule instruction"
  }
  return null;
}

export async function extractScheduleInstruction(text) {
  const { text: raw, model } = await getReply([
    { role: 'system', content: SCHEDULE_EXTRACT_PROMPT },
    { role: 'user', content: `Instruction: "${text}"` },
  ]);
  logModelUsage('scheduler', model, raw);
  return parseScheduleJson(raw);
}

// Called at fire-time — generates fresh, natural content for the occasion rather than
// sending the same canned text every day.
export async function generateScheduledMessage(topic) {
  const { text, model } = await getReply([
    { role: 'system', content: scheduledMessagePrompt(topic) },
    { role: 'user', content: `Occasion: ${topic}` },
  ]);
  logModelUsage('scheduler', model, text, 'generated message');
  return text.trim();
}
