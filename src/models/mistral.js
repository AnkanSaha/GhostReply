import { MISTRAL_MODELS, LLM_RATE_LIMIT_COOLDOWN_MS } from '../tools/config.js';
import { throttle } from '../tools/rateLimiter.js';
import { LlmProvider } from './llmProvider.js';

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

class MistralProvider extends LlmProvider {
  modelId(entry) {
    return entry.model;
  }

  async pace(entry) {
    await throttle(`mistral:${entry.model}`, Math.ceil(1000 / entry.rps));
  }

  parseRateLimitReset(res) {
    const header = res.headers.get('retry-after');
    if (header) return Date.now() + Number(header) * 1000;
    return super.parseRateLimitReset();
  }
}

const mistral = new MistralProvider('mistral', ENDPOINT, LLM_RATE_LIMIT_COOLDOWN_MS);

export async function getMistralReply(
  messages,
  { apiKey = process.env.MISTRAL_API_KEY, models = MISTRAL_MODELS, fetchImpl = fetch, paced = true, tools, toolChoice } = {},
) {
  return mistral.getReply(messages, { apiKey, models, fetchImpl, paced, tools, toolChoice });
}
