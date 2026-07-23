import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

if (!process.env.OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env');
  process.exit(1);
}

export const client = new Client({
  authStrategy: new LocalAuth(),
  // No hardcoded executablePath — Puppeteer resolves its own npm-installed Chrome.
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  // ponytail: no version pin. WhatsApp ships new web-client builds multiple times a day, and
  // one recent build broke several internal whatsapp-web.js calls (getContact, fetchMessages,
  // getChatById) with a cryptic "r: r" Puppeteer error — a known, currently-open upstream
  // issue (wwebjs/whatsapp-web.js#201838, #201833), not a bug in this project. Pinning to the
  // last known-good local build was tried, but that exact file isn't mirrored in the
  // community wa-version archive (only newer, likely-still-broken builds are), so there's
  // currently no known-good version left to pin to. If the "r: r" errors reappear, check
  // whether whatsapp-web.js has shipped a fix (npm outdated whatsapp-web.js) before trying
  // to pin again.
});
