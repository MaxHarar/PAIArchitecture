/**
 * Sentinel Gateway — Message Scheduler
 *
 * In-memory scheduler for proactive outbound messages.
 * Supports one-shot delayed messages and recurring cron-like patterns.
 *
 * All scheduled messages are sent via the Telegram Bot API.
 * Voice messages are generated via the local Kokoro TTS server.
 */

import { getSecret } from "./secrets.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduledMessage {
  id: string;
  text: string;
  /** ISO 8601 timestamp when this message should be sent */
  sendAt: string;
  /** If true, also generate and send a voice note */
  voice: boolean;
  /** Optional voice text override (defaults to text) */
  voiceText?: string;
  /** Source that scheduled this (brain, cron, api) */
  source: string;
  /** Whether this has been sent */
  sent: boolean;
  /** Creation timestamp */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const scheduled: Map<string, ScheduledMessage> = new Map();
let tickInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Telegram Bot API — Direct Send
// ---------------------------------------------------------------------------

async function sendTelegramText(text: string): Promise<boolean> {
  const botToken = getSecret("telegram-bot-token");
  const chatId = getSecret("telegram-chat-id");
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  // Split long messages (Telegram 4096 char limit)
  const chunks = splitMessage(text, 4096);

  for (const chunk of chunks) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
        }),
      });

      if (!res.ok) {
        // Retry without Markdown (formatting errors)
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });
      }
    } catch (err) {
      console.error("[scheduler] Failed to send Telegram text:", err);
      return false;
    }
  }

  return true;
}

async function sendTelegramVoice(voiceText: string): Promise<boolean> {
  const botToken = getSecret("telegram-bot-token");
  const chatId = getSecret("telegram-chat-id");

  try {
    // Generate audio via voice server (Kokoro TTS)
    const ttsResponse = await fetch("http://localhost:8888/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: voiceText,
        telegram_chat_id: chatId,
        title: "Sentinel",
      }),
    });

    if (!ttsResponse.ok) {
      console.error("[scheduler] Voice server error:", ttsResponse.status);
      return false;
    }

    const ttsResult = (await ttsResponse.json()) as {
      status: string;
      audio_file_path?: string;
    };

    if (!ttsResult.audio_file_path) {
      console.error("[scheduler] Voice server returned no audio_file_path");
      return false;
    }

    // Send voice note to Telegram
    const audioFile = Bun.file(ttsResult.audio_file_path);
    const audioBuffer = await audioFile.arrayBuffer();

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("voice", new Blob([audioBuffer], { type: "audio/wav" }), "voice.wav");

    const url = `https://api.telegram.org/bot${botToken}/sendVoice`;
    const res = await fetch(url, {
      method: "POST",
      body: formData,
    });

    // Clean up temp file
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(ttsResult.audio_file_path);
    } catch { /* ignore cleanup errors */ }

    if (!res.ok) {
      const errText = await res.text();
      console.error("[scheduler] Failed to send voice to Telegram:", errText);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[scheduler] Voice send error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a message to Telegram immediately (proactive outbound).
 */
export async function sendOutbound(
  text: string,
  options: { voice?: boolean; voiceText?: string } = {},
): Promise<{ success: boolean; messageId: string }> {
  const messageId = crypto.randomUUID();

  console.log(`[scheduler] Sending outbound message (${text.length} chars, voice=${options.voice ?? false})`);

  const textSent = await sendTelegramText(text);
  let voiceSent = false;

  if (options.voice) {
    const spokenText = options.voiceText ?? text;
    voiceSent = await sendTelegramVoice(spokenText);
  }

  console.log(`[scheduler] Outbound result: text=${textSent}, voice=${voiceSent}`);

  return { success: textSent, messageId };
}

/**
 * Schedule a message for future delivery.
 */
export function scheduleMessage(
  text: string,
  sendAt: Date | string,
  options: { voice?: boolean; voiceText?: string; source?: string } = {},
): ScheduledMessage {
  const id = crypto.randomUUID();
  const msg: ScheduledMessage = {
    id,
    text,
    sendAt: typeof sendAt === "string" ? sendAt : sendAt.toISOString(),
    voice: options.voice ?? false,
    voiceText: options.voiceText,
    source: options.source ?? "api",
    sent: false,
    createdAt: new Date().toISOString(),
  };

  scheduled.set(id, msg);
  console.log(`[scheduler] Scheduled message ${id} for ${msg.sendAt} (voice=${msg.voice})`);

  return msg;
}

/**
 * Cancel a scheduled message.
 */
export function cancelScheduled(id: string): boolean {
  return scheduled.delete(id);
}

/**
 * List all pending scheduled messages.
 */
export function listScheduled(): ScheduledMessage[] {
  return Array.from(scheduled.values()).filter((m) => !m.sent);
}

/**
 * Start the scheduler tick (checks every 10 seconds).
 */
export function startScheduler(): void {
  if (tickInterval) return;

  tickInterval = setInterval(async () => {
    const now = Date.now();

    for (const [id, msg] of scheduled) {
      if (msg.sent) continue;

      const sendTime = new Date(msg.sendAt).getTime();
      if (sendTime <= now) {
        msg.sent = true;
        console.log(`[scheduler] Firing scheduled message ${id}`);

        try {
          await sendOutbound(msg.text, {
            voice: msg.voice,
            voiceText: msg.voiceText,
          });
        } catch (err) {
          console.error(`[scheduler] Failed to send scheduled message ${id}:`, err);
        }

        // Clean up sent messages after 1 hour
        setTimeout(() => scheduled.delete(id), 60 * 60 * 1000);
      }
    }
  }, 10_000); // Check every 10 seconds

  console.log("[scheduler] Scheduler started (10s tick)");
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log("[scheduler] Scheduler stopped");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.5) {
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.5) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
