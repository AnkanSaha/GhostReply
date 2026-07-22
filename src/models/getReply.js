import { getMistralReply } from './mistral.js';
import { getAIReply } from './openrouter.js';
import { MAX_TOOL_ITERATIONS } from '../tools/config.js';

// Tries Mistral's full model fallback chain first, then OpenRouter's, before giving up.
// Shared by every caller (auto-reply, relay extraction, takeover duration parsing) so the
// same two-provider reliability applies everywhere, not just the main conversation flow.
// Throws only if both providers are exhausted.
async function getReplyOnce(messages, tools, toolChoice) {
  try {
    return await getMistralReply(messages, { tools, toolChoice });
  } catch (err) {
    console.warn('[mistral] all models failed, trying OpenRouter fallback:', err.message);
    try {
      return await getAIReply(messages, { tools, toolChoice });
    } catch (openrouterErr) {
      console.error('[models] both Mistral and OpenRouter failed:', openrouterErr.message);
      throw openrouterErr;
    }
  }
}

// Callers that don't pass `tools`/`executeTool` get the exact same behavior as before —
// the loop below always returns on its first iteration in that case, since a request with
// no `tools` never gets a `tool_calls` response back. Only a caller that opts in (currently
// just auto-reply's persona conversation) pays for the extra round-trips a tool call costs.
//
// `toolChoice` (e.g. { type: 'function', function: { name: 'web_search' } }) forces that
// specific tool to be called on the FIRST turn only — a system-prompt instruction like "use
// web_search for X" is a request the model can and does ignore, so this is for callers that
// need an actual guarantee (e.g. the user explicitly said "search for this"). It's dropped
// after the first turn so the model can freely give its final answer once the tool result
// is in, instead of being forced to call the same tool forever.
export async function getReply(messages, { tools, executeTool, toolChoice } = {}) {
  let conversation = messages;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const { text, model, toolCalls } = await getReplyOnce(conversation, tools, i === 0 ? toolChoice : undefined);
    if (!toolCalls?.length) return { text, model };

    if (!executeTool) throw new Error('model requested a tool call but no executeTool was provided');

    conversation = [...conversation, { role: 'assistant', content: text ?? null, tool_calls: toolCalls }];
    for (const call of toolCalls) {
      console.log(`[tool] calling ${call.function.name}(${call.function.arguments})`);
      const output = await executeTool(call);
      console.log(`[tool] ${call.function.name} ->`, output.length > 300 ? `${output.slice(0, 300)}…` : output);
      conversation.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: output });
    }
  }

  throw new Error(`exceeded ${MAX_TOOL_ITERATIONS} tool-call iterations without a final answer`);
}
