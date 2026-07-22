import { spawn } from 'node:child_process';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { TTS_VOICES } from './config.js';

function detectLang(text) {
  if (/[ঀ-৿]/.test(text)) return 'bn'; // Bengali script
  if (/[ऀ-ॿ]/.test(text)) return 'hi'; // Devanagari script
  return 'en'; // Latin script — covers English and romanized Banglish/Hinglish (no dedicated voice for those)
}

// The library builds an SSML request from this text without escaping it (per its
// own README warning), and LLM-generated replies can contain raw & < > " '.
function escapeSSML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// WhatsApp's voice-note player only decodes OGG/Opus. Transcode via the system
// ffmpeg binary (already required for many WhatsApp media features).
function mp3ToOggOpus(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-ar', '48000',
      '-ac', '1',
      '-f', 'ogg',
      'pipe:1',
    ]);

    const chunks = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}`));
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.write(mp3Buffer);
    ffmpeg.stdin.end();
  });
}

// Returns OGG/Opus audio, ready for WhatsApp's sendAudioAsVoice. `gender` defaults to
// male; pass 'female' to use the female voice for the detected language.
export async function textToSpeech(text, gender = 'male') {
  const voice = TTS_VOICES[detectLang(text)][gender === 'female' ? 'female' : 'male'];
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeSSML(text));
    const mp3Buffer = await streamToBuffer(audioStream);
    return await mp3ToOggOpus(mp3Buffer);
  } finally {
    tts.close();
  }
}
