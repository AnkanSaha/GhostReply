import { client } from './client.js';
import { wasSentByBot } from './botMessages.js';
import { getSelfChatId, isSendingToSelfChat, resolveSelfChatLazily } from './selfChat.js';
import { tryHandleTakeoverCommand } from './takeover.js';
import { hasPendingSend, handlePendingSend, tryStartSendInstruction } from './relayHandler.js';
import { hasPendingSchedule, handlePendingSchedule, tryStartScheduleInstruction } from './scheduler.js';
import { isStaleMessage } from './startupGuard.js';

// 'message' never fires for fromMe messages (wwebjs filters those out before emitting it),
// so these commands can only be caught here. message_create fires for every message either way.
// Only the "Message Yourself" note-to-self chat is watched, so the command never shows up
// in an actual conversation with someone else.
export function registerSelfChatHandler() {
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    if (isSendingToSelfChat(msg.to)) return; // our own outgoing prompt, not a manual command
    if (wasSentByBot(msg.id._serialized)) return; // our own auto-reply, not a manual command
    if (isStaleMessage(msg)) return; // a command typed before this session started, replayed on reconnect

    if (msg.to !== getSelfChatId()) {
      const isSelfChat = await resolveSelfChatLazily(msg.to);
      if (!isSelfChat) return;
    }

    const body = msg.body ?? '';

    // A pending confirmation/disambiguation takes priority over everything else —
    // this message is the answer to that, not a new command or note.
    if (hasPendingSend()) {
      try {
        await handlePendingSend(body);
      } catch (err) {
        console.warn('[relay] failed handling pending send:', err.message);
      }
      return;
    }

    if (hasPendingSchedule()) {
      try {
        await handlePendingSchedule(body);
      } catch (err) {
        console.warn('[scheduler] failed handling pending schedule:', err.message);
      }
      return;
    }

    const wasTakeoverCommand = await tryHandleTakeoverCommand(body);
    if (wasTakeoverCommand) return;

    let wasScheduleInstruction = false;
    try {
      wasScheduleInstruction = await tryStartScheduleInstruction(body);
    } catch (err) {
      console.warn('[scheduler] failed parsing schedule instruction:', err.message);
    }
    if (wasScheduleInstruction) return;

    try {
      await tryStartSendInstruction(body);
    } catch (err) {
      console.warn('[relay] failed parsing send instruction:', err.message);
    }
  });
}
