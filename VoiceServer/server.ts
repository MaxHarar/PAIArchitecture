#!/usr/bin/env bun
/**
 * Voice Server - Personal AI Voice notification server using ElevenLabs TTS
 *
 * Architecture: Pure pass-through. All voice config comes from settings.json.
 * The server has zero hardcoded voice parameters.
 *
 * Config resolution (3-tier):
 *   1. Caller sends voice_settings in request body → use directly (pass-through)
 *   2. Caller sends voice_id → look up in settings.json daidentity.voices → use those settings
 *   3. Neither → use settings.json daidentity.voices.main as default
 *
 * Pronunciation preprocessing: loads pronunciations.json and applies
 * word-boundary replacements before sending text to ElevenLabs TTS.
 */

import { serve } from "bun";
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

// Load .env from user home directory
const envPath = join(homedir(), '.env');
if (existsSync(envPath)) {
  const envContent = await Bun.file(envPath).text();
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !key.startsWith('#')) {
      process.env[key.trim()] = value.trim();
    }
  });
}

const PORT = parseInt(process.env.PORT || "8888");
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Kokoro (mlx-audio) local TTS configuration
const KOKORO_PORT = parseInt(process.env.KOKORO_PORT || "8000");
const KOKORO_BASE_URL = `http://localhost:${KOKORO_PORT}`;
const KOKORO_MODEL = process.env.KOKORO_MODEL || "mlx-community/Kokoro-82M-bf16";
const KOKORO_DEFAULT_VOICE = process.env.KOKORO_DEFAULT_VOICE || "af_heart";

// TTS backend: "kokoro" (local, free) or "elevenlabs" (cloud, paid)
const TTS_BACKEND = process.env.TTS_BACKEND || "kokoro";

if (TTS_BACKEND === "elevenlabs" && !ELEVENLABS_API_KEY) {
  console.error('⚠️  ELEVENLABS_API_KEY not found in ~/.env');
  console.error('Add: ELEVENLABS_API_KEY=your_key_here');
  console.error('Or switch to Kokoro: TTS_BACKEND=kokoro');
}

// Check if Kokoro server is reachable
async function checkKokoroHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${KOKORO_BASE_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// ==========================================================================
// Pronunciation System
// ==========================================================================

interface PronunciationEntry {
  term: string;
  phonetic: string;
  note?: string;
}

interface PronunciationConfig {
  replacements: PronunciationEntry[];
}

// Compiled pronunciation rules (loaded once at startup)
interface CompiledRule {
  regex: RegExp;
  phonetic: string;
}

let pronunciationRules: CompiledRule[] = [];

// Load and compile pronunciation rules from pronunciations.json
function loadPronunciations(): void {
  const pronPath = join(import.meta.dir, 'pronunciations.json');
  try {
    if (!existsSync(pronPath)) {
      console.warn('⚠️  No pronunciations.json found — TTS will use default pronunciations');
      return;
    }
    const content = readFileSync(pronPath, 'utf-8');
    const config: PronunciationConfig = JSON.parse(content);

    pronunciationRules = config.replacements.map(entry => ({
      // Word-boundary matching: \b ensures "Kai" matches but "Kaiser" doesn't
      regex: new RegExp(`\\b${escapeRegex(entry.term)}\\b`, 'g'),
      phonetic: entry.phonetic,
    }));

    console.log(`📖 Loaded ${pronunciationRules.length} pronunciation rules`);
    for (const entry of config.replacements) {
      console.log(`   ${entry.term} → ${entry.phonetic} (${entry.note || ''})`);
    }
  } catch (error) {
    console.error('⚠️  Failed to load pronunciations.json:', error);
  }
}

// Escape special regex characters in a literal string
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Apply all pronunciation replacements to text before TTS
function applyPronunciations(text: string): string {
  let result = text;
  for (const rule of pronunciationRules) {
    result = result.replace(rule.regex, rule.phonetic);
  }
  return result;
}

// Load pronunciations at startup
loadPronunciations();

// ==========================================================================
// Voice Configuration — Single Source of Truth: settings.json
// ==========================================================================

// ElevenLabs voice_settings fields (sent to their API)
interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
}

// A voice entry from settings.json daidentity.voices.*
interface VoiceEntry {
  voiceId: string;
  voiceName?: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
  volume: number;
}

// Loaded config from settings.json
interface LoadedVoiceConfig {
  defaultVoiceId: string;
  voices: Record<string, VoiceEntry>;     // keyed by name ("main", "algorithm")
  voicesByVoiceId: Record<string, VoiceEntry>;  // keyed by voiceId for lookup
}

// Last-resort defaults if settings.json is entirely missing or unparseable
const FALLBACK_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  speed: 1.0,
  use_speaker_boost: true,
};
const FALLBACK_VOLUME = 1.0;

// Load voice configuration from settings.json (cached at startup)
function loadVoiceConfig(): LoadedVoiceConfig {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  try {
    if (!existsSync(settingsPath)) {
      console.warn('⚠️  settings.json not found — using fallback voice defaults');
      return { defaultVoiceId: '', voices: {}, voicesByVoiceId: {} };
    }

    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const daidentity = settings.daidentity || {};
    const voicesSection = daidentity.voices || {};

    // Build lookup maps
    const voices: Record<string, VoiceEntry> = {};
    const voicesByVoiceId: Record<string, VoiceEntry> = {};

    for (const [name, config] of Object.entries(voicesSection)) {
      const entry = config as any;
      if (entry.voiceId) {
        const voiceEntry: VoiceEntry = {
          voiceId: entry.voiceId,
          voiceName: entry.voiceName,
          stability: entry.stability ?? 0.5,
          similarity_boost: entry.similarity_boost ?? 0.75,
          style: entry.style ?? 0.0,
          speed: entry.speed ?? 1.0,
          use_speaker_boost: entry.use_speaker_boost ?? true,
          volume: entry.volume ?? 1.0,
        };
        voices[name] = voiceEntry;
        voicesByVoiceId[entry.voiceId] = voiceEntry;
      }
    }

    // Default voice ID from settings
    const defaultVoiceId = voices.main?.voiceId || daidentity.mainDAVoiceID || '';

    const voiceNames = Object.keys(voices);
    console.log(`✅ Loaded ${voiceNames.length} voice config(s) from settings.json: ${voiceNames.join(', ')}`);
    for (const [name, entry] of Object.entries(voices)) {
      console.log(`   ${name}: ${entry.voiceName || entry.voiceId} (speed: ${entry.speed}, stability: ${entry.stability})`);
    }

    return { defaultVoiceId, voices, voicesByVoiceId };
  } catch (error) {
    console.error('⚠️  Failed to load settings.json voice config:', error);
    return { defaultVoiceId: '', voices: {}, voicesByVoiceId: {} };
  }
}

// Load config at startup
const voiceConfig = loadVoiceConfig();
const DEFAULT_VOICE_ID = voiceConfig.defaultVoiceId || process.env.ELEVENLABS_VOICE_ID || "{YOUR_ELEVENLABS_VOICE_ID}";

// Look up a voice entry by voice ID
function lookupVoiceByVoiceId(voiceId: string): VoiceEntry | null {
  return voiceConfig.voicesByVoiceId[voiceId] || null;
}

// Get ElevenLabs voice settings for a voice entry
function voiceEntryToSettings(entry: VoiceEntry): ElevenLabsVoiceSettings {
  return {
    stability: entry.stability,
    similarity_boost: entry.similarity_boost,
    style: entry.style,
    speed: entry.speed,
    use_speaker_boost: entry.use_speaker_boost,
  };
}

// Emotional markers for dynamic voice adjustment (overlay-only — modifies stability + similarity_boost)
interface EmotionalOverlay {
  stability: number;
  similarity_boost: number;
}

// 13 Emotional Presets - Expanded Prosody System
// These OVERLAY onto resolved voice settings, not replace them
const EMOTIONAL_PRESETS: Record<string, EmotionalOverlay> = {
  // High Energy / Positive
  'excited': { stability: 0.7, similarity_boost: 0.9 },
  'celebration': { stability: 0.65, similarity_boost: 0.85 },
  'insight': { stability: 0.55, similarity_boost: 0.8 },
  'creative': { stability: 0.5, similarity_boost: 0.75 },

  // Success / Achievement
  'success': { stability: 0.6, similarity_boost: 0.8 },
  'progress': { stability: 0.55, similarity_boost: 0.75 },

  // Analysis / Investigation
  'investigating': { stability: 0.6, similarity_boost: 0.85 },
  'debugging': { stability: 0.55, similarity_boost: 0.8 },
  'learning': { stability: 0.5, similarity_boost: 0.75 },

  // Thoughtful / Careful
  'pondering': { stability: 0.65, similarity_boost: 0.8 },
  'focused': { stability: 0.7, similarity_boost: 0.85 },
  'caution': { stability: 0.4, similarity_boost: 0.6 },

  // Urgent / Critical
  'urgent': { stability: 0.3, similarity_boost: 0.9 },
};

// Escape special characters for AppleScript
function escapeForAppleScript(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Extract emotional marker from message
function extractEmotionalMarker(message: string): { cleaned: string; emotion?: string } {
  const emojiToEmotion: Record<string, string> = {
    '\u{1F4A5}': 'excited',
    '\u{1F389}': 'celebration',
    '\u{1F4A1}': 'insight',
    '\u{1F3A8}': 'creative',
    '\u{2728}': 'success',
    '\u{1F4C8}': 'progress',
    '\u{1F50D}': 'investigating',
    '\u{1F41B}': 'debugging',
    '\u{1F4DA}': 'learning',
    '\u{1F914}': 'pondering',
    '\u{1F3AF}': 'focused',
    '\u{26A0}\u{FE0F}': 'caution',
    '\u{1F6A8}': 'urgent'
  };

  const emotionMatch = message.match(/\[(\u{1F4A5}|\u{1F389}|\u{1F4A1}|\u{1F3A8}|\u{2728}|\u{1F4C8}|\u{1F50D}|\u{1F41B}|\u{1F4DA}|\u{1F914}|\u{1F3AF}|\u{26A0}\u{FE0F}|\u{1F6A8})\s+(\w+)\]/u);
  if (emotionMatch) {
    const emoji = emotionMatch[1];
    const emotionName = emotionMatch[2].toLowerCase();

    if (emojiToEmotion[emoji] === emotionName) {
      return {
        cleaned: message.replace(emotionMatch[0], '').trim(),
        emotion: emotionName
      };
    }
  }

  return { cleaned: message };
}

// Sanitize input for TTS and notifications
function sanitizeForSpeech(input: string): string {
  const cleaned = input
    .replace(/<script/gi, '')
    .replace(/\.\.\//g, '')
    .replace(/[;&|><`$\\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .trim()
    .substring(0, 500);

  return cleaned;
}

// Validate user input
function validateInput(input: any): { valid: boolean; error?: string; sanitized?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Invalid input type' };
  }

  if (input.length > 500) {
    // Gracefully truncate instead of rejecting — callers may send long content
    input = input.substring(0, 497) + "...";
  }

  const sanitized = sanitizeForSpeech(input);

  if (!sanitized || sanitized.length === 0) {
    return { valid: false, error: 'Message contains no valid content after sanitization' };
  }

  return { valid: true, sanitized };
}

// Generate speech using Kokoro (mlx-audio) local TTS — OpenAI-compatible API
async function generateSpeechKokoro(
  text: string,
  speed: number = 1.0
): Promise<{ buffer: ArrayBuffer; format: string }> {
  const pronouncedText = applyPronunciations(text);
  if (pronouncedText !== text) {
    console.log(`📖 Pronunciation: "${text}" → "${pronouncedText}"`);
  }

  const response = await fetch(`${KOKORO_BASE_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: KOKORO_MODEL,
      voice: KOKORO_DEFAULT_VOICE,
      input: pronouncedText,
      speed: speed,
      response_format: "wav",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kokoro TTS error: ${response.status} - ${errorText}`);
  }

  return { buffer: await response.arrayBuffer(), format: "wav" };
}

// Generate speech using ElevenLabs API — pure pass-through of voice_settings
async function generateSpeechElevenLabs(
  text: string,
  voiceId: string,
  voiceSettings: ElevenLabsVoiceSettings
): Promise<{ buffer: ArrayBuffer; format: string }> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const pronouncedText = applyPronunciations(text);
  if (pronouncedText !== text) {
    console.log(`📖 Pronunciation: "${text}" → "${pronouncedText}"`);
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: pronouncedText,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: voiceSettings,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  return { buffer: await response.arrayBuffer(), format: "mp3" };
}

// Unified speech generation — routes to active backend
async function generateSpeech(
  text: string,
  voiceId: string,
  voiceSettings: ElevenLabsVoiceSettings
): Promise<{ buffer: ArrayBuffer; format: string }> {
  if (TTS_BACKEND === "kokoro") {
    return generateSpeechKokoro(text, voiceSettings.speed || 1.0);
  } else {
    return generateSpeechElevenLabs(text, voiceId, voiceSettings);
  }
}

// Play audio using afplay (macOS) — supports both mp3 and wav
async function playAudio(audioBuffer: ArrayBuffer, volume: number = FALLBACK_VOLUME, format: string = "mp3"): Promise<void> {
  const ext = format === "wav" ? "wav" : "mp3";
  const tempFile = `/tmp/voice-${Date.now()}.${ext}`;

  await Bun.write(tempFile, audioBuffer);

  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/afplay', ['-v', volume.toString(), tempFile]);

    proc.on('error', (error) => {
      console.error('Error playing audio:', error);
      reject(error);
    });

    proc.on('exit', (code) => {
      spawn('/bin/rm', [tempFile]);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`afplay exited with code ${code}`));
      }
    });
  });
}

// Spawn a process safely
function spawnSafe(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);

    proc.on('error', (error) => {
      console.error(`Error spawning ${command}:`, error);
      reject(error);
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

// ==========================================================================
// Core: Send notification with 3-tier voice settings resolution
// ==========================================================================

/**
 * Send macOS notification with voice.
 *
 * Voice settings resolution (3-tier):
 *   1. callerVoiceSettings provided → use directly (pass-through)
 *   2. voiceId provided → look up in settings.json → use those settings
 *   3. Neither → use settings.json voices.main defaults
 *
 * Emotional presets overlay stability + similarity_boost onto resolved settings.
 * Volume is resolved separately: caller → voice entry → main → 1.0 fallback.
 */
async function sendNotification(
  title: string,
  message: string,
  voiceEnabled = true,
  voiceId: string | null = null,
  callerVoiceSettings?: Partial<ElevenLabsVoiceSettings> | null,
  callerVolume?: number | null,
  telegramChatId?: string | null,
) {
  const titleValidation = validateInput(title);
  const messageValidation = validateInput(message);

  if (!titleValidation.valid) {
    throw new Error(`Invalid title: ${titleValidation.error}`);
  }

  if (!messageValidation.valid) {
    throw new Error(`Invalid message: ${messageValidation.error}`);
  }

  const safeTitle = titleValidation.sanitized!;
  let safeMessage = messageValidation.sanitized!;

  const { cleaned, emotion } = extractEmotionalMarker(safeMessage);
  safeMessage = cleaned;

  let audioFilePath: string | null = null;

  // Generate and play voice using ElevenLabs
  if (voiceEnabled && (TTS_BACKEND === "kokoro" || ELEVENLABS_API_KEY)) {
    try {
      const voice = voiceId || DEFAULT_VOICE_ID;

      // 3-tier voice settings resolution
      let resolvedSettings: ElevenLabsVoiceSettings;
      let resolvedVolume: number;

      if (callerVoiceSettings && Object.keys(callerVoiceSettings).length > 0) {
        // Tier 1: Caller provided explicit voice_settings → pass through
        resolvedSettings = {
          stability: callerVoiceSettings.stability ?? FALLBACK_VOICE_SETTINGS.stability,
          similarity_boost: callerVoiceSettings.similarity_boost ?? FALLBACK_VOICE_SETTINGS.similarity_boost,
          style: callerVoiceSettings.style ?? FALLBACK_VOICE_SETTINGS.style,
          speed: callerVoiceSettings.speed ?? FALLBACK_VOICE_SETTINGS.speed,
          use_speaker_boost: callerVoiceSettings.use_speaker_boost ?? FALLBACK_VOICE_SETTINGS.use_speaker_boost,
        };
        resolvedVolume = callerVolume ?? FALLBACK_VOLUME;
        console.log(`🔗 Voice settings: pass-through from caller`);
      } else {
        // Tier 2/3: Look up by voiceId, fall back to main
        const voiceEntry = lookupVoiceByVoiceId(voice) || voiceConfig.voices.main;
        if (voiceEntry) {
          resolvedSettings = voiceEntryToSettings(voiceEntry);
          resolvedVolume = callerVolume ?? voiceEntry.volume ?? FALLBACK_VOLUME;
          console.log(`📋 Voice settings: from settings.json (${voiceEntry.voiceName || voice})`);
        } else {
          resolvedSettings = { ...FALLBACK_VOICE_SETTINGS };
          resolvedVolume = callerVolume ?? FALLBACK_VOLUME;
          console.log(`⚠️  Voice settings: fallback defaults (no config found for ${voice})`);
        }
      }

      // Emotional preset overlay — modifies stability + similarity_boost only
      if (emotion && EMOTIONAL_PRESETS[emotion]) {
        resolvedSettings = {
          ...resolvedSettings,
          stability: EMOTIONAL_PRESETS[emotion].stability,
          similarity_boost: EMOTIONAL_PRESETS[emotion].similarity_boost,
        };
        console.log(`🎭 Emotion overlay: ${emotion}`);
      }

      console.log(`🎙️  Generating speech [${TTS_BACKEND}] (voice: ${TTS_BACKEND === 'kokoro' ? KOKORO_DEFAULT_VOICE : voice}, speed: ${resolvedSettings.speed}, volume: ${resolvedVolume})`);

      const { buffer: audioBuffer, format: audioFormat } = await generateSpeech(safeMessage, voice, resolvedSettings);

      if (telegramChatId) {
        // Telegram mode: save audio file and return path (don't play locally)
        const ext = audioFormat === "wav" ? "wav" : "mp3";
        audioFilePath = `/tmp/voice-telegram-${Date.now()}.${ext}`;
        await Bun.write(audioFilePath, audioBuffer);
        console.log(`📱 Saved audio for Telegram: ${audioFilePath}`);
      } else {
        // Local mode: play via afplay
        await playAudio(audioBuffer, resolvedVolume, audioFormat);
      }
    } catch (error) {
      console.error("Failed to generate/play speech:", error);
    }
  }

  // Display macOS notification (skip for Telegram-only requests)
  if (!telegramChatId) {
    try {
      const escapedTitle = escapeForAppleScript(safeTitle);
      const escapedMessage = escapeForAppleScript(safeMessage);
      const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name ""`;
      await spawnSafe('/usr/bin/osascript', ['-e', script]);
    } catch (error) {
      console.error("Notification display error:", error);
    }
  }

  return { audioFilePath };
}

// Rate limiting
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

// Start HTTP server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const clientIp = req.headers.get('x-forwarded-for') || 'localhost';

    // Allow requests from browser, Tauri webview, and local dev servers
    const origin = req.headers.get("origin") || "";
    const allowOrigin = origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1") ||
      origin.startsWith("tauri://")
        ? origin
        : "http://localhost";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ status: "error", message: "Rate limit exceeded" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 429
        }
      );
    }

    if (url.pathname === "/notify" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "PAI Notification";
        const message = data.message || "Task completed";
        const voiceEnabled = data.voice_enabled !== false;
        const voiceId = data.voice_id || data.voice_name || null;
        const voiceSettings = data.voice_settings || null;
        const volume = data.volume ?? null;
        const telegramChatId = data.telegram_chat_id || null;

        if (voiceId && typeof voiceId !== 'string') {
          throw new Error('Invalid voice_id');
        }

        console.log(`📨 Notification: "${title}" - "${message}" (voice: ${voiceEnabled}, voiceId: ${voiceId || DEFAULT_VOICE_ID}${telegramChatId ? `, telegram: ${telegramChatId}` : ''})`);

        const result = await sendNotification(title, message, voiceEnabled, voiceId, voiceSettings, volume, telegramChatId);

        const responseBody: Record<string, string> = { status: "success", message: "Notification sent" };
        if (result.audioFilePath) {
          responseBody.audio_file_path = result.audioFilePath;
        }

        return new Response(
          JSON.stringify(responseBody),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("Notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    // /notify/personality — compatibility shim for callers using the old Qwen3-TTS endpoint
    // Personality fields are Qwen3-specific; for ElevenLabs, we just speak with default voice
    if (url.pathname === "/notify/personality" && req.method === "POST") {
      try {
        const data = await req.json();
        const message = data.message || "Notification";

        console.log(`🎭 Personality notification: "${message}"`);

        const _personalityResult = await sendNotification("PAI Notification", message, true, null);

        return new Response(
          JSON.stringify({ status: "success", message: "Personality notification sent" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("Personality notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    if (url.pathname === "/pai" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "PAI Assistant";
        const message = data.message || "Task completed";

        console.log(`🤖 PAI notification: "${title}" - "${message}"`);

        const _paiResult = await sendNotification(title, message, true, null);

        return new Response(
          JSON.stringify({ status: "success", message: "PAI notification sent" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("PAI notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    // /transcribe — Speech-to-text using mlx-whisper (local, Apple Silicon)
    if (url.pathname === "/transcribe" && req.method === "POST") {
      try {
        const contentType = req.headers.get("content-type") || "";
        let audioBuffer: ArrayBuffer;
        let ext = "webm";

        if (contentType.includes("multipart/form-data")) {
          const formData = await req.formData();
          const file = formData.get("audio") as File | null;
          if (!file) {
            return new Response(
              JSON.stringify({ error: "No audio file in form data" }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }
          audioBuffer = await file.arrayBuffer();
          // Detect extension from file name or mime type
          if (file.name?.endsWith(".wav")) ext = "wav";
          else if (file.type?.includes("wav")) ext = "wav";
        } else {
          // Raw binary body
          audioBuffer = await req.arrayBuffer();
          if (contentType.includes("wav")) ext = "wav";
        }

        // Save to temp file
        const tempPath = `/tmp/stt-${Date.now()}.${ext}`;
        await Bun.write(tempPath, audioBuffer);

        console.log(`🎤 Transcribing audio (${(audioBuffer.byteLength / 1024).toFixed(1)}KB, ${ext})`);

        // Run whisper transcription via Python script
        // Use anaconda python which has mlx-whisper installed
        const pythonPath = process.env.PYTHON_PATH || "/opt/anaconda3/bin/python";
        const transcribeScript = join(import.meta.dir, "transcribe.py");
        const proc = Bun.spawn([pythonPath, transcribeScript, tempPath], {
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
          },
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;

        // Clean up temp file
        try { await Bun.write(tempPath, ""); spawn("/bin/rm", [tempPath]); } catch {}

        if (proc.exitCode !== 0) {
          console.error("Whisper error:", stderr);
          return new Response(
            JSON.stringify({ error: "Transcription failed", details: stderr }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
          );
        }

        const result = JSON.parse(stdout.trim());
        console.log(`✅ Transcribed: "${result.text}"`);

        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (error: any) {
        console.error("Transcription error:", error);
        return new Response(
          JSON.stringify({ error: error.message || "Transcription failed" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    if (url.pathname === "/health") {
      const kokoroUp = TTS_BACKEND === "kokoro" ? await checkKokoroHealth() : null;
      return new Response(
        JSON.stringify({
          status: "healthy",
          port: PORT,
          tts_backend: TTS_BACKEND,
          voice_system: TTS_BACKEND === "kokoro" ? "Kokoro (mlx-audio)" : "ElevenLabs",
          kokoro_server: TTS_BACKEND === "kokoro" ? (kokoroUp ? "connected" : "unreachable") : "n/a",
          kokoro_voice: TTS_BACKEND === "kokoro" ? KOKORO_DEFAULT_VOICE : "n/a",
          stt_backend: "mlx-whisper (whisper-tiny)",
          default_voice_id: DEFAULT_VOICE_ID,
          api_key_configured: !!ELEVENLABS_API_KEY,
          pronunciation_rules: pronunciationRules.length,
          configured_voices: Object.keys(voiceConfig.voices),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200
        }
      );
    }

    return new Response("Voice Server - POST to /notify, /notify/personality, or /pai", {
      headers: corsHeaders,
      status: 200
    });
  },
});

console.log(`🚀 Voice Server running on port ${PORT}`);
console.log(`🎙️  TTS Backend: ${TTS_BACKEND === "kokoro" ? `Kokoro (mlx-audio) → ${KOKORO_BASE_URL} | voice: ${KOKORO_DEFAULT_VOICE}` : `ElevenLabs (voice: ${DEFAULT_VOICE_ID})`}`);
console.log(`📡 POST to http://localhost:${PORT}/notify`);
console.log(`🔒 Security: CORS restricted to localhost, rate limiting enabled`);
if (TTS_BACKEND === "elevenlabs") {
  console.log(`🔑 API Key: ${ELEVENLABS_API_KEY ? '✅ Configured' : '❌ Missing'}`);
}
console.log(`📖 Pronunciations: ${pronunciationRules.length} rules loaded`);

// Check Kokoro connectivity at startup
if (TTS_BACKEND === "kokoro") {
  checkKokoroHealth().then(ok => {
    if (ok) {
      console.log(`✅ Kokoro server reachable at ${KOKORO_BASE_URL}`);
    } else {
      console.warn(`⚠️  Kokoro server not reachable at ${KOKORO_BASE_URL}`);
      console.warn(`   Start it with: mlx_audio.server --port ${KOKORO_PORT}`);
    }
  });
}
