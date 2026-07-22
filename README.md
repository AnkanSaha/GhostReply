# GhostReply

A self-hosted WhatsApp agent that replies to your contacts as you — matching your language, tone, and persona — and lets you control it all through plain-English commands sent to yourself: send a text or voice note to anyone, schedule recurring messages, switch voice gender per chat, or pause auto-reply entirely. Runs entirely on free-tier LLMs (Mistral, with OpenRouter fallback) — no paid API required.

## ⚠️ Before you run this

- **This is unofficial WhatsApp automation.** It works by driving a real WhatsApp Web session ([`whatsapp-web.js`](https://wwebjs.dev/)), the same way any browser-based WhatsApp Web login does. This is against WhatsApp's Terms of Service, and accounts running this kind of automation can be banned at any time, with no warning and no appeal path. Use a number you're comfortable putting at risk — not your only line of contact.
- **The auto-reply persona is instructed to deny being an AI if asked.** It replies to your contacts as you, in your voice and style, and will not disclose that it's automated even if directly asked. That's a deliberate design choice for personal use on your own conversations — be aware of what you're agreeing to before pointing it at real contacts who haven't consented to talking to a bot.
- Chat history and message content are stored locally only (see [Data & privacy](#data--privacy)) — nothing is sent anywhere except the LLM providers you configure.

## Features

- **Auto-reply as you** — replies to incoming WhatsApp messages using an LLM persona (your background, tone, and mannerisms, configured in `src/tools/config.js`). Matches the sender's language/script (English, Bengali, Hindi, Banglish, Hinglish) and formality level from conversation history.
- **Web search & page scraping** — the auto-reply persona can call a `web_search` tool (a key-free lookup against DuckDuckGo's results page) and a `scrape_url` tool to look up current information — news, prices, recent events — it wouldn't otherwise know, then answers in character without mentioning it searched. No API key or signup needed for either; note this scrapes DuckDuckGo's HTML rather than using an official API, so it can break if their markup changes.
- **Voice-note replies** — can reply with an actual voice note instead of text, using free neural TTS (Bengali/Hindi/English, Indian accents). Male voice by default; a contact can ask to switch to female (in any of the four supported languages/scripts) and that chat remembers the preference.
- **Self-chat command center** — message yourself ("Message Yourself" chat in WhatsApp) to control the bot:
  - **Send messages**: *"send a voice message to Rahul saying I'll be 10 minutes late"* — parses the recipient (by contact name, or a full/partial phone number), message, and voice/gender want, then asks for confirmation before sending.
  - **Schedule messages**: *"send good morning to priya every day at 5am"* — recurring or one-time, verbatim or freshly generated per occasion. List (`"show my schedules"`) or cancel (`"cancel all schedules for priya"`) existing ones.
  - **Pause/resume auto-reply**: *"stop for 2 hours"* / *"start"* — pauses all auto-replies globally, with an optional duration.
- **Two-provider LLM reliability** — every request tries Mistral's model lineup first (in quality order, respecting per-model rate limits), then falls back to OpenRouter's free models if Mistral is exhausted.
- **Local persistence** — conversation history and schedules are stored in a local embedded database ([AxioDB](https://www.npmjs.com/package/axiodb)), nothing leaves your machine except the actual LLM API calls.

## Prerequisites

- Node.js ≥ 20
- **Google Chrome** installed at `/usr/bin/google-chrome-stable` (Linux) — the Puppeteer path is hardcoded in `src/bot/client.js`; adjust that path if your Chrome install lives elsewhere or you're on a different OS.
- **ffmpeg** available on your system `PATH` — used to transcode TTS output into the OGG/Opus format WhatsApp's voice-note player requires.
- A free [OpenRouter](https://openrouter.ai/) API key (required).
- A free [Mistral](https://console.mistral.ai/) API key (optional, but recommended — Mistral's models are tried first).

## Setup

```bash
git clone https://github.com/AnkanSaha/GhostReply.git
cd GhostReply
npm install
cp .env.example .env
```

Fill in `.env`:

```
OPENROUTER_API_KEY=your_key_here
MISTRAL_API_KEY=your_key_here   # optional
```

Start it:

```bash
npm start
```

A QR code prints to the terminal. Scan it from WhatsApp on your phone (**Settings → Linked Devices → Link a Device**). Once connected, the session persists locally (`.wwebjs_auth/`) so you won't need to re-scan on restart.

## Usage

Once running, open **your own "Message Yourself" chat** in WhatsApp and send it plain-English (or Bengali/Hindi/Banglish/Hinglish) instructions — see the Features section above for examples of send/schedule/pause commands.

Any other contact who messages you gets an auto-reply from the persona configured in `src/tools/config.js`. Group chats are ignored unless the bot is explicitly @-mentioned.

## Configuration

Everything tunable lives in `src/tools/config.js`:
- `PERSONA` — the bot's identity/background/personality/rules, edited as plain text.
- `FREE_MODELS` / `MISTRAL_MODELS` — the model fallback order for each provider.
- All LLM system prompts (send parsing, scheduling parsing, takeover duration parsing).
- Timing/threshold constants (history length, TTS voice-note pacing, phone-number match thresholds, etc.).
- `TTS_VOICES` — which neural voice is used per language/gender.

## Data & privacy

- `.wwebjs_auth/` — your WhatsApp session credentials. Never commit or share this directory; it's equivalent to being logged into your WhatsApp account.
- `AxioDB/` — local conversation history and schedules, used to give the LLM context. Stays on your machine.
- Both directories are already excluded via `.gitignore`.

## Development

Each test file under `tests/` is a standalone Node script using `node:assert/strict`:

```bash
node tests/mistral.test.js
node tests/openrouter.test.js
node tests/rateLimiter.test.js
```

## License

MIT — see [LICENSE](./LICENSE).
