import { FREE_MODELS, LLM_REQUEST_TIMEOUT_MS, LLM_RATE_LIMIT_COOLDOWN_MS, OPENROUTER_MIN_INTERVAL_MS } from '../tools/config.js';
import { throttle } from '../tools/rateLimiter.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// model -> timestamp (ms) until which it should be skipped, reset in-memory on restart.
// ponytail: process-local circuit breaker, move to shared storage if you ever run multiple instances.
const cooldownUntil = new Map();

function parseRateLimitResetMs(res, bodyText) {
  const header = res.headers.get('x-ratelimit-reset');
  if (header) return Number(header);

  try {
    const reset = JSON.parse(bodyText)?.error?.metadata?.headers?.['X-RateLimit-Reset'];
    if (reset) return Number(reset);
  } catch {
    // fall through to default
  }

  return Date.now() + LLM_RATE_LIMIT_COOLDOWN_MS;
}

// Tries each model in FREE_MODELS in order; returns the first successful reply.
// Skips models still in a rate-limit cooldown. Throws only if every model fails/is on cooldown.
export async function getAIReply(messages, { apiKey = process.env.OPENROUTER_API_KEY, models = FREE_MODELS, fetchImpl = fetch, paced = true } = {}) {
  let lastError = new Error('no models available (all on rate-limit cooldown)');

  for (const model of models) {
    const cooldown = cooldownUntil.get(model);
    if (cooldown && Date.now() < cooldown) {
      console.warn(`[openrouter] skipping ${model}, rate-limited until ${new Date(cooldown).toISOString()}`);
      continue;
    }

    if (paced) await throttle('openrouter', OPENROUTER_MIN_INTERVAL_MS);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text();

        if (res.status === 429) {
          const resetAt = parseRateLimitResetMs(res, bodyText);
          cooldownUntil.set(model, resetAt);
          console.warn(`[openrouter] ${model} rate-limited, cooling down until ${new Date(resetAt).toISOString()}`);
        }

        throw new Error(`HTTP ${res.status}: ${bodyText}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('empty response');

      return { text, model };
    } catch (err) {
      lastError = err;
      console.warn(`[openrouter] model ${model} failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`all models failed, last error: ${lastError.message}`);
}
