import { MISTRAL_MODELS, LLM_REQUEST_TIMEOUT_MS, LLM_RATE_LIMIT_COOLDOWN_MS } from '../tools/config.js';
import { throttle } from '../tools/rateLimiter.js';
import { normalizeContent } from './normalizeContent.js';
import { formatIST } from '../tools/time.js';

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';


// model -> timestamp (ms) until which it should be skipped, reset in-memory on restart.
const cooldownUntil = new Map();

function parseRateLimitResetMs(res) {
  const header = res.headers.get('retry-after');
  if (header) return Date.now() + Number(header) * 1000;
  return Date.now() + LLM_RATE_LIMIT_COOLDOWN_MS;
}

export async function getMistralReply(messages, { apiKey = process.env.MISTRAL_API_KEY, models = MISTRAL_MODELS, fetchImpl = fetch, paced = true, tools, toolChoice } = {}) {
  let lastError = new Error('no Mistral models available (all on rate-limit cooldown)');

  for (const { model, rps } of models) {
    const cooldown = cooldownUntil.get(model);
    if (cooldown && Date.now() < cooldown) {
      console.warn(`[mistral] skipping ${model}, rate-limited until ${formatIST(new Date(cooldown))}`);
      continue;
    }

    if (paced) await throttle(`mistral:${model}`, Math.ceil(1000 / rps));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, ...(tools?.length ? { tools } : {}), ...(toolChoice ? { tool_choice: toolChoice } : {}) }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text();

        if (res.status === 429) {
          const resetAt = parseRateLimitResetMs(res);
          cooldownUntil.set(model, resetAt);
          console.warn(`[mistral] ${model} rate-limited, cooling down until ${formatIST(new Date(resetAt))}`);
        }

        throw new Error(`HTTP ${res.status}: ${bodyText}`);
      }

      const data = await res.json();
      const message = data.choices?.[0]?.message;
      const toolCalls = message?.tool_calls;
      const text = normalizeContent(message?.content);
      if (!text && !toolCalls?.length) throw new Error('empty response');

      return { text, model, toolCalls };
    } catch (err) {
      lastError = err;
      console.warn(`[mistral] model ${model} failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`all Mistral models failed, last error: ${lastError.message}`);
}
