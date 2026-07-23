import { client } from './client.js';
import { replyInSelfChat } from './selfChat.js';
import { extractScheduleInstruction, generateScheduledMessage } from '../tools/scheduler.js';
import { findMatchingContacts, contactLabel } from '../tools/relay.js';
import { CANCEL_REGEX } from './relayHandler.js';
import { saveSchedule, getAllSchedules, deleteSchedule } from '../tools/AxioDB.js';
import { SCHEDULE_CHECK_INTERVAL_MS, IST_OFFSET_MS } from '../tools/config.js';

// Owns the two pieces of in-memory scheduling state: which schedules already fired today
// (so the minute-check can't double-fire one), and any in-progress recipient disambiguation.
// In-memory only: a restart within the exact firing minute could in theory refire a schedule
// once — an accepted, low-stakes edge case.
class ScheduleRuntime {
  constructor() {
    this.firedToday = new Map(); // documentId -> "YYYY-MM-DD" it last fired on
    // Pending recipient disambiguation for an in-progress schedule-setup — only one at a
    // time. { candidates, queue } where queue is the resolution state from resolveRecipients,
    // or null.
    this.pendingSchedule = null;
  }

  hasFiredToday(documentId, dateKey) {
    return this.firedToday.get(documentId) === dateKey;
  }

  markFired(documentId, dateKey) {
    this.firedToday.set(documentId, dateKey);
  }
}

const scheduleRuntime = new ScheduleRuntime();

export function hasPendingSchedule() {
  return scheduleRuntime.pendingSchedule !== null;
}

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function currentHHMM(date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function currentDateKeyIST(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fireSchedule(schedule) {
  try {
    // verbatim: send the stored text exactly, no LLM call at all. Otherwise generate
    // fresh content for the occasion each time it fires.
    const message = schedule.verbatim ? schedule.topic : await generateScheduledMessage(schedule.topic);
    await client.sendMessage(schedule.recipientId, message);
    console.log(`[scheduler] sent "${schedule.topic}"${schedule.verbatim ? ' (verbatim)' : ''} to ${schedule.recipientLabel}: "${message}"`);
  } catch (err) {
    console.warn(`[scheduler] failed to send scheduled message to ${schedule.recipientLabel}:`, err.message);
  }

  if (!schedule.recurring) {
    try {
      await deleteSchedule(schedule.documentId);
      console.log(`[scheduler] one-time schedule fired, removed: ${schedule.recipientLabel} @ ${schedule.time}`);
    } catch (err) {
      console.warn('[scheduler] failed to remove fired one-time schedule:', err.message);
    }
  }
}

async function checkSchedules() {
  let allSchedules;
  try {
    allSchedules = await getAllSchedules();
  } catch (err) {
    console.warn('[scheduler] failed to load schedules:', err.message);
    return;
  }

  const now = nowIST();
  const hhmm = currentHHMM(now);
  const dateKey = currentDateKeyIST(now);

  for (const schedule of allSchedules) {
    if (schedule.time !== hhmm) continue;
    if (scheduleRuntime.hasFiredToday(schedule.documentId, dateKey)) continue;
    scheduleRuntime.markFired(schedule.documentId, dateKey);
    await fireSchedule(schedule);
  }
}

// Call once at startup. Checks every minute against IST wall-clock time — no cron
// dependency needed for a same-time-every-day recurrence.
export function startScheduler() {
  setInterval(() => {
    checkSchedules().catch((err) => console.warn('[scheduler] check failed:', err.message));
  }, SCHEDULE_CHECK_INTERVAL_MS);
  console.log('[scheduler] started, checking every minute (IST)');
}

async function saveResolvedSchedules(queue) {
  const savedSummaries = [];
  for (const recipient of queue.resolved) {
    for (const entry of queue.entries) {
      try {
        await saveSchedule({
          time: entry.time,
          topic: entry.topic,
          recipientId: recipient.id,
          recipientLabel: recipient.label,
          recurring: entry.recurring,
          verbatim: entry.verbatim,
        });
        const recurLabel = entry.recurring ? 'every day' : 'once';
        const modeLabel = entry.verbatim ? 'as-is' : 'generated fresh each time';
        savedSummaries.push(`${entry.time} (${recurLabel}, ${modeLabel}) — "${entry.topic}" to ${recipient.label}`);
      } catch (err) {
        console.warn('[scheduler] failed to save schedule:', err.message);
      }
    }
  }

  console.log('[scheduler] schedules saved:', savedSummaries);
  if (queue.failed.length) console.log('[scheduler] could not resolve:', queue.failed);

  let reply = savedSummaries.length ? `Scheduled:\n${savedSummaries.join('\n')}` : 'Could not save any schedules.';
  if (queue.failed.length) {
    reply += `\n\nCouldn't find contact for: ${queue.failed.join(', ')}`;
  }
  await replyInSelfChat(reply);
}

async function handleScheduleQuery(parsed) {
  let allSchedules;
  try {
    allSchedules = await getAllSchedules();
  } catch (err) {
    console.warn('[scheduler] failed to load schedules:', err.message);
    await replyInSelfChat('Could not load schedules right now.');
    return;
  }

  if (parsed.action === 'list') {
    console.log(`[scheduler] listing ${allSchedules.length} schedule(s)`);
    if (allSchedules.length === 0) {
      await replyInSelfChat('No schedules set.');
      return;
    }
    const list = allSchedules
      .map((s) => `${s.time} (${s.recurring ? 'every day' : 'once'}, ${s.verbatim ? 'as-is' : 'generated'}) — "${s.topic}" to ${s.recipientLabel}`)
      .join('\n');
    await replyInSelfChat(`Schedules:\n${list}`);
    return;
  }

  // action === 'delete'
  const matches = parsed.all
    ? allSchedules
    : allSchedules.filter((s) => {
        if (parsed.time && s.time !== parsed.time) return false;
        if (parsed.topic && !s.topic.toLowerCase().includes(parsed.topic.toLowerCase())) return false;
        if (parsed.recipient && !s.recipientLabel.toLowerCase().includes(parsed.recipient.toLowerCase())) return false;
        return true;
      });

  if (matches.length === 0) {
    console.log('[scheduler] no schedules matched delete criteria:', parsed);
    await replyInSelfChat('No matching schedules found to cancel.');
    return;
  }

  const removed = [];
  for (const s of matches) {
    try {
      await deleteSchedule(s.documentId);
      removed.push(`${s.time} — "${s.topic}" to ${s.recipientLabel}`);
    } catch (err) {
      console.warn('[scheduler] failed to delete schedule:', err.message);
    }
  }
  console.log('[scheduler] cancelled schedules:', removed);
  await replyInSelfChat(removed.length ? `Cancelled:\n${removed.join('\n')}` : 'Could not cancel any matching schedules.');
}

// Resolves recipient names one at a time. On the first ambiguous name, pauses and asks
// (same numbered-list pattern as relay's disambiguation) — the rest of the queue picks
// back up once that one's answered. Returns true once every name has been resolved/failed.
async function resolveRecipients(queue) {
  while (queue.names.length > 0) {
    const name = queue.names.shift();
    const matches = await findMatchingContacts(client, name);
    console.log(`[scheduler] ${matches.length} contact match(es) for "${name}"`);
    if (matches.length === 1) {
      queue.resolved.push({ id: matches[0].id._serialized, label: contactLabel(matches[0]) });
    } else if (matches.length === 0) {
      queue.failed.push(name);
    } else {
      const candidates = matches.slice(0, 8).map((c) => ({ id: c.id._serialized, label: contactLabel(c) }));
      console.log(`[scheduler] multiple matches for "${name}", awaiting disambiguation:`, candidates.map((c) => c.label));
      scheduleRuntime.pendingSchedule = { candidates, queue };
      const list = candidates.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
      await replyInSelfChat(`Multiple matches for "${name}":\n${list}\nReply with a number, or "cancel".`);
      return false;
    }
  }
  return true;
}

export async function handlePendingSchedule(body) {
  const normalized = body.trim();
  const { candidates, queue } = scheduleRuntime.pendingSchedule;

  if (CANCEL_REGEX.test(normalized)) {
    console.log('[scheduler] schedule setup cancelled during disambiguation');
    scheduleRuntime.pendingSchedule = null;
    await replyInSelfChat('Cancelled.');
    return;
  }

  const idx = Number.parseInt(normalized, 10);
  const candidate = Number.isInteger(idx) ? candidates[idx - 1] : null;
  if (!candidate) {
    await replyInSelfChat('Not a valid choice — reply with a number from the list, or "cancel".');
    return;
  }

  console.log(`[scheduler] disambiguation resolved to ${candidate.label}`);
  queue.resolved.push(candidate);
  scheduleRuntime.pendingSchedule = null;

  const done = await resolveRecipients(queue);
  if (done) await saveResolvedSchedules(queue);
}

// Returns true if `body` was a schedule-related instruction (handled here), false otherwise,
// so the caller can fall through to other self-chat interpretations (e.g. relay).
export async function tryStartScheduleInstruction(body) {
  const parsed = await extractScheduleInstruction(body);
  if (!parsed || !parsed.action) {
    console.log(`[scheduler] not a schedule instruction: "${body}"`);
    return false;
  }

  console.log('[scheduler] schedule instruction detected:', parsed);

  if (parsed.action === 'incomplete') {
    console.log(`[scheduler] incomplete schedule instruction, missing: ${parsed.missing}`);
    await replyInSelfChat(
      `Got it, but I need a time to schedule this — e.g. "at 5am" or "every day at 6pm". Resend with a time and I'll set it up.`,
    );
    return true;
  }

  if (parsed.action === 'list' || parsed.action === 'delete') {
    await handleScheduleQuery(parsed);
    return true;
  }

  // action === 'create'
  const queue = { names: [...parsed.recipients], resolved: [], failed: [], entries: parsed.entries };
  const done = await resolveRecipients(queue);
  if (done) await saveResolvedSchedules(queue);
  return true;
}
