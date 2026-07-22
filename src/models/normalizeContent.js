// Most providers return message.content as a plain string, but some responses (seen from
// Mistral's medium model after a tool-augmented turn) return an array of content blocks
// instead — { type: 'text', text: '...' } interleaved with { type: 'reference', ... }
// citation markers. Downstream code (VOICE: line parsing, etc.) needs a plain string
// either way, so both providers normalize through this before returning `text`.
export function normalizeContent(content) {
  if (content == null || typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('');
  }
  return String(content);
}
