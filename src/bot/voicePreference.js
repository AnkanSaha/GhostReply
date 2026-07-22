// Per-chat voice-gender preference for auto-reply voice messages. Defaults to male;
// a contact can switch it by asking to change the voice to female (or back to male),
// in English, Bengali, Hindi, Banglish, or Hinglish.
//
// Non-Latin scripts (Bengali/Devanagari) aren't in JS's \w range, so \b word boundaries
// don't fire around them — proximity matching without boundaries is used for those instead
// (fine here: these are distinctive multi-char words, not substrings likely to false-match).
const VOICE_WORDS = String.raw`(?:voice|awaaz|awaj|aawaz|kontho|gola|স্বর|কণ্ঠ|গলা|ভয়েস|आवाज़?|स्वर)`;
const FEMALE_WORDS = String.raw`(?:female|woman|girl|meye|meyer|mohila|mahila|ladki|larki|মহিলা|মেয়ে|নারী|महिला|औरत|लड़की)`;
const MALE_WORDS = String.raw`(?:male|man|boy|chele|cheler|purush|ladka|larka|aadmi|adami|পুরুষ|ছেলে|पुरुष|आदमी|लड़का)`;
const GENDER_WORDS = `(?:${FEMALE_WORDS}|${MALE_WORDS})`;

const VOICE_GENDER_REGEX = new RegExp(
  `${GENDER_WORDS}[^.!?\\n]{0,25}${VOICE_WORDS}|${VOICE_WORDS}[^.!?\\n]{0,25}${GENDER_WORDS}`,
  'i',
);
const FEMALE_REGEX = new RegExp(FEMALE_WORDS, 'i');

const genderByChat = new Map();

export function getVoiceGender(chatId) {
  return genderByChat.get(chatId) ?? 'male';
}

// Detects a "change/use/send in <gender> voice" instruction in `body` and, if found,
// updates the stored preference for `chatId`. Returns the new gender, or null if the
// message didn't mention one.
export function applyVoiceGenderCommand(chatId, body) {
  const match = body.match(VOICE_GENDER_REGEX);
  if (!match) return null;
  const gender = FEMALE_REGEX.test(match[0]) ? 'female' : 'male';
  genderByChat.set(chatId, gender);
  return gender;
}
