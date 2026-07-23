# GhostReply

## What this is

A self-hosted WhatsApp automation agent that logs into your own WhatsApp Web
session and replies to incoming messages *as you* — same tone, language, and
persona — while also acting as a command center: send a message or voice
note to any contact, schedule recurring messages, switch reply voice gender
per chat, or pause auto-reply, all triggered by plain-English (or
Bengali/Hindi/Banglish/Hinglish) instructions sent to your own
"Message Yourself" chat.

## Why it exists

Manually replying to routine WhatsApp messages (or drafting the same kind of
scheduled greetings) is repetitive. GhostReply offloads that to an LLM
persona configured with your actual background and speaking style, so
replies read as genuinely yours instead of an obvious bot, and lets you
issue commands the same way you'd ask a person to do it for you — in
natural language, not a rigid CLI syntax.

## How it works

1. **`whatsapp-web.js`** drives a real WhatsApp Web session via Puppeteer/
   Chrome — the same login flow as scanning a QR code in a browser.
2. Every inbound message is classified: is it a command in your own
   self-chat (send/schedule/pause), or a message from a contact needing an
   auto-reply?
3. For auto-replies, recent chat history (from AxioDB, falling back to
   WhatsApp's own history on the first-ever turn) plus a persona system
   prompt are sent to an LLM. The model can call `web_search` /
   `scrape_url` tools for anything it doesn't already know.
4. LLM calls go through a two-provider fallback chain — Mistral's models
   first (quality-ordered, rate-limited per model), then OpenRouter's free
   models if Mistral is exhausted — so a single provider outage doesn't
   stop replies.
5. Replies can be text or a synthesized voice note (`msedge-tts`, Indian
   neural voices per language/gender), transcoded to OGG/Opus via `ffmpeg`
   for WhatsApp's voice-note player.
6. Conversation history and schedules persist locally in AxioDB — nothing
   leaves the machine except the actual LLM API calls.

## Technologies used

| Concern | Choice |
|---|---|
| WhatsApp session | `whatsapp-web.js` (Puppeteer-driven WhatsApp Web) |
| LLM providers | Mistral API (primary), OpenRouter free models (fallback) |
| Local persistence | AxioDB (embedded, file-based) |
| Text-to-speech | `msedge-tts` (free Microsoft Edge neural voices) + `ffmpeg` |
| Runtime | Node.js ≥ 20, native ESM (`type: module`) |
| Config/secrets | `dotenv` |
| Tests | `node:assert/strict`, plain scripts under `tests/` — no test framework |

See `README.md` for setup/usage; see `src/tools/config.js` for the actual
persona, prompts, and every tunable constant.

---

## Engineering rules

These rules govern all code written or modified in this repo. They apply on
top of (never instead of) the reviewer's own judgment about correctness and
the existing architecture.

### 1. OOP by default, functional helpers where they fit better

Model a "thing with identity, state, and behavior" (a provider client, a
scheduler, a persisted record) as a class. Stateless, single-purpose
transforms (`formatIST`, `stripTags`, `throttle`) stay as plain exported
functions — do not wrap a pure function in a class just to have a class.
The test is: does this concept own state or coordinate multiple operations
over time? If yes, a class. If it's an input → output transform, a
function.

### 2. SOLID

- **S — Single Responsibility**: a module/class has one reason to change.
  `webSearch.js` doing search *and* scrape *and* tool-schema definitions is
  borderline — if it grows further, split by responsibility, not by file
  size.
- **O — Open/Closed**: extend via new functions/strategies (e.g. adding a
  model to `MISTRAL_MODELS`/`FREE_MODELS`), don't reshape existing call
  sites to bolt on a special case.
- **L — Liskov Substitution**: anything implementing a shared shape (e.g.
  both LLM providers returning `{ text, model }`) must be swappable without
  the caller special-casing which one it got.
- **I — Interface Segregation**: don't force a caller to depend on
  parameters/methods it doesn't use — prefer several small, specific
  exports over one do-everything function with a flags object.
- **D — Dependency Inversion**: high-level flow (`autoReply.js`) depends on
  abstractions (`getReply`, `executeToolCall`) it's handed, not on
  reaching into a specific provider module directly.

### 3. File names: camelCase

`autoReply.js`, `voicePreference.js`, `rateLimiter.js` — lowercase first
letter, no hyphens/underscores. Exception already in the codebase:
`AxioDB.js` (matches the `axiodb` package/product name) — don't rename it
to "fix" this; don't add new similar exceptions without a comparable
reason.

### 4. Meaningful names

A function or variable name should tell the reader what it holds/does
without needing to open its body. Prefer `containsUrl`, `wantsForcedSearch`,
`humanDelayMs` over `check`, `flag`, `x`. Abbreviate only for genuinely
standard terms (`ms`, `url`, `id`) — never for anything a first-time reader
would have to guess.

### 5. Standard practices for every package

Use a dependency the way its own docs/maintainers intend — not a
workaround pattern found in an old blog post. If the correct usage isn't
already known with confidence, look it up (web search the package's docs)
before writing the integration, rather than guessing from memory or
copying an unverified pattern.

### 6. Any API surface follows the OpenAPI standard

This project doesn't currently expose an HTTP API — it's driven entirely by
WhatsApp messages. If one is ever added (a webhook, a status endpoint,
etc.), its request/response shapes and routes must be describable as a
valid OpenAPI (v3) document — conventional HTTP methods/status codes,
schema-typed request/response bodies, no ad hoc envelopes.

### 7. Cohesion: related things live in the same class/module

Group by what changes together, not by technical layer. Voice-gender
preference storage and lookup both live in `voicePreference.js`; scheduling
parsing, storage, and firing logic stay together rather than being spread
thinly across unrelated files just to keep files short.

### 8. Comments: short, few, and only where the code can't speak for itself

Default to no comment. When one is needed, one line explaining *why*
(a non-obvious constraint, a workaround, a subtlety), never *what* the
next line does. Reserve JSDoc blocks for genuinely non-obvious public
function contracts (unusual parameter shapes, non-throwing error
conventions) — not as a default header on every function.
