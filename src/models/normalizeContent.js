// Usually message.content is a plain string, but Mistral's medium model after a
// tool-augmented turn returns an array of { type: 'text' }/{ type: 'reference' } blocks
// instead — flatten either shape to the plain string downstream code expects.
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
