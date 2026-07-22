import { getMistralReply } from './mistral.js';
import { getAIReply } from './openrouter.js';

// Tries Mistral's full model fallback chain first, then OpenRouter's, before giving up.
// Shared by every caller (auto-reply, relay extraction, takeover duration parsing) so the
// same two-provider reliability applies everywhere, not just the main conversation flow.
// Throws only if both providers are exhausted.
export async function getReply(messages) {
  try {
    return await getMistralReply(messages);
  } catch (err) {
    console.warn('[mistral] all models failed, trying OpenRouter fallback:', err.message);
    try {
      return await getAIReply(messages);
    } catch (openrouterErr) {
      console.error('[models] both Mistral and OpenRouter failed:', openrouterErr.message);
      throw openrouterErr;
    }
  }
}
