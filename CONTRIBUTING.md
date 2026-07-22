# Contributing

This is a personal project, maintained on a best-effort basis. Contributions are welcome, but please keep the following in mind.

## Before opening a PR

- Open an issue first for anything non-trivial, so the approach can be agreed on before you put in the work.
- Keep changes focused — one concern per PR.
- Match the existing code style: no new abstractions, no added dependencies, unless the existing code already leans that way for the same kind of problem.

## Development setup

See [README.md](./README.md#setup) for environment setup (Node ≥ 20, Chrome, ffmpeg, API keys).

Run the existing tests before submitting:

```bash
node tests/mistral.test.js
node tests/openrouter.test.js
node tests/rateLimiter.test.js
```

## Reporting bugs

Open a GitHub issue with:
- What you did
- What you expected
- What actually happened
- Relevant console output (redact any API keys, phone numbers, or message content)

## Reporting security issues

Do not open a public issue — see [SECURITY.md](./SECURITY.md).

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
