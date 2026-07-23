// Real Unicode ranges — zero false positives, unlike guessing a language from vocabulary.
// Shared by autoReply.js (per-message language tagging) and tts.js (voice selection).
const BENGALI_SCRIPT = /[ঀ-৿]/;
const DEVANAGARI_SCRIPT = /[ऀ-ॿ]/;

export function detectScript(text) {
  if (BENGALI_SCRIPT.test(text)) return 'bn';
  if (DEVANAGARI_SCRIPT.test(text)) return 'hi';
  return 'latin';
}
