import qrcode from 'qrcode-terminal';
import { client } from './client.js';
import { initChatHistory } from '../tools/AxioDB.js';
import { resolveSelfChatAtStartup } from './selfChat.js';
import { registerSelfChatHandler } from './selfChatRouter.js';
import { registerAutoReplyHandler } from './autoReply.js';
import { startScheduler } from './scheduler.js';

export async function start() {
  client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
  client.on('ready', async () => {
    console.log('WhatsApp bot ready.');
    await resolveSelfChatAtStartup();
  });

  registerSelfChatHandler();
  registerAutoReplyHandler();

  await initChatHistory();
  startScheduler();
  client.initialize();
}
