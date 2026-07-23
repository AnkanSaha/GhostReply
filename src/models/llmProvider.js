import { LLM_REQUEST_TIMEOUT_MS } from '../tools/config.js';
import { normalizeContent } from './normalizeContent.js';
import { formatIST } from '../tools/time.js';

// Mistral and OpenRouter share the same OpenAI-shaped wire format and per-model rate-limit
// circuit breaker — this base class owns that request/retry/cooldown loop. A subclass
// overrides only what differs: reading a model id from a models[] entry, pacing, and
// parsing a 429's rate-limit reset info.
export class LlmProvider {
  constructor(name, endpoint, rateLimitCooldownMs) {
    this.name = name;
    this.endpoint = endpoint;
    this.rateLimitCooldownMs = rateLimitCooldownMs;
    this.cooldownUntil = new Map(); // model -> timestamp (ms) until which it's skipped
  }

  modelId(entry) {
    return entry;
  }

  async pace(_entry) {}

  parseRateLimitReset(_res, _bodyText) {
    return Date.now() + this.rateLimitCooldownMs;
  }

  async getReply(messages, { apiKey, models, fetchImpl = fetch, paced = true, tools, toolChoice } = {}) {
    let lastError = new Error(`no ${this.name} models available (all on rate-limit cooldown)`);

    for (const entry of models) {
      const model = this.modelId(entry);
      const cooldown = this.cooldownUntil.get(model);
      if (cooldown && Date.now() < cooldown) {
        console.warn(`[${this.name}] skipping ${model}, rate-limited until ${formatIST(new Date(cooldown))}`);
        continue;
      }

      if (paced) await this.pace(entry);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

      try {
        const res = await fetchImpl(this.endpoint, {
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
            const resetAt = this.parseRateLimitReset(res, bodyText);
            this.cooldownUntil.set(model, resetAt);
            console.warn(`[${this.name}] ${model} rate-limited, cooling down until ${formatIST(new Date(resetAt))}`);
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
        console.warn(`[${this.name}] model ${model} failed: ${err.message}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`all ${this.name} models failed, last error: ${lastError.message}`);
  }
}
