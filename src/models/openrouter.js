import { FREE_MODELS, LLM_RATE_LIMIT_COOLDOWN_MS, OPENROUTER_MIN_INTERVAL_MS } from '../tools/config.js';
import { throttle } from '../tools/rateLimiter.js';
import { LlmProvider } from './llmProvider.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// OpenRouter's free tier rate-limits per account, not per model, so every model paces
// through one shared key/interval instead of a per-model one like Mistral's rps.
class OpenRouterProvider extends LlmProvider {
  async pace() {
    await throttle('openrouter', OPENROUTER_MIN_INTERVAL_MS);
  }

  parseRateLimitReset(res, bodyText) {
    const header = res.headers.get('x-ratelimit-reset');
    if (header) return Number(header);

    try {
      const reset = JSON.parse(bodyText)?.error?.metadata?.headers?.['X-RateLimit-Reset'];
      if (reset) return Number(reset);
    } catch {
      // fall through to default
    }

    return super.parseRateLimitReset();
  }
}

const openrouter = new OpenRouterProvider('openrouter', ENDPOINT, LLM_RATE_LIMIT_COOLDOWN_MS);

export async function getAIReply(
  messages,
  { apiKey = process.env.OPENROUTER_API_KEY, models = FREE_MODELS, fetchImpl = fetch, paced = true, tools, toolChoice, signal } = {},
) {
  return openrouter.getReply(messages, { apiKey, models, fetchImpl, paced, tools, toolChoice, signal });
}
