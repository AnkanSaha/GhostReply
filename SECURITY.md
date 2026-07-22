# Security Policy

## Reporting a Vulnerability

This is a personal, single-maintainer project. If you find a security issue — credential handling, session data exposure, injection risks, or anything else — please report it privately rather than opening a public issue.

Open a [GitHub Security Advisory](https://github.com/AnkanSaha/GhostReply/security/advisories/new) on this repository, or contact the maintainer directly through the profile linked on this repo.

There's no bug bounty and no guaranteed response time — this is maintained on a best-effort basis — but reports will be looked at and fixes released as soon as practical.

## Scope

Relevant to report:
- API key or credential leakage (OpenRouter, Mistral)
- WhatsApp session (`.wwebjs_auth/`) exposure or hijacking risks
- Injection vulnerabilities in message/command parsing
- Any way a message from a WhatsApp contact could execute unintended code or actions

Not in scope:
- WhatsApp's own platform security or Terms of Service enforcement
- Issues in third-party dependencies (`whatsapp-web.js`, `axiodb`, `msedge-tts`, etc.) — report those upstream

## Handling your own instance

- `.env`, `.wwebjs_auth/`, and `AxioDB/` contain your API keys, live WhatsApp session, and personal chat history respectively. Never commit or share them — they're already excluded via `.gitignore`.
- Treat `.wwebjs_auth/` as equivalent to your WhatsApp login itself: anyone with that directory can act as your WhatsApp account until you unlink the device.
