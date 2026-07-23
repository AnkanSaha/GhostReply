import { getMistralReply } from './mistral.js';
import { getAIReply } from './openrouter.js';
import { MAX_TOOL_ITERATIONS } from '../tools/config.js';

// Every classification-style caller (relay, scheduler, takeover) logs which model answered
// and what it said right after calling getReply — one shared line pair instead of each
// caller repeating it.
export function logModelUsage(tag, model, raw, label = 'raw response') {
  console.log(`[${tag}] model used:`, model);
  console.log(`[${tag}] ${label}:`, raw);
}

// Tries Mistral's full model fallback chain first, then OpenRouter's — shared by every
// caller so the same two-provider reliability applies everywhere. Throws only if both
// providers are exhausted.
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

// A caller without `tools` always returns on the first iteration (no `tool_calls` possible),
// so only opted-in callers pay for extra round-trips. `toolChoice` forces one specific tool
// on the FIRST turn only, for callers needing a guarantee beyond a system-prompt request the
// model could ignore — dropped after that so the model can give its final answer freely.
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
