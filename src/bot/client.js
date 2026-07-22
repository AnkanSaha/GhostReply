import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

if (!process.env.OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env');
  process.exit(1);
}

export const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { executablePath: '/usr/bin/google-chrome-stable' },
});
