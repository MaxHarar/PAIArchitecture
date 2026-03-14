/**
 * Sentinel Gateway -- Telegram Channel Adapter
 *
 * Bridges Telegram messages from Max into the gateway.
 * Trust level: OWNER (highest — can trigger all autonomy tiers).
 *
 * Auth:
 *   1. Gateway bearer token (handled by auth.ts)
 *   2. Telegram chat_id must match Max's verified ID (handled here)
 *
 * Messages are HMAC-signed into envelopes for tamper detection
 * within the gateway pipeline.
 */

import type { ChannelAdapter } from "./types.ts";
import type { GatewayMessage, GatewayResponse } from "../types.ts";
import { ChannelTrust } from "../types.ts";
import { getSecret } from "../secrets.ts";
import { validateBearer } from "../auth.ts";

// ---------------------------------------------------------------------------
// HMAC Envelope Signing
// ---------------------------------------------------------------------------

function signEnvelope(payload: string, secret: string): string {
  const nodeCrypto = require("crypto") as typeof import("crypto");
  return nodeCrypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Telegram Adapter
// ---------------------------------------------------------------------------

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram" as const;
  readonly trust = ChannelTrust.OWNER;

  /**
   * Parse a Telegram webhook update into a GatewayMessage.
   * Returns null if the message is not from Max or has no text content.
   */
  async parseMessage(req: Request): Promise<GatewayMessage | null> {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      console.error("[telegram] Failed to parse request body as JSON");
      return null;
    }

    // Extract the message object (could be message or edited_message)
    const update = body as {
      message?: {
        message_id: number;
        from?: { id: number; first_name?: string; username?: string };
        chat: { id: number; type: string };
        text?: string;
        date: number;
      };
      edited_message?: {
        message_id: number;
        from?: { id: number; first_name?: string; username?: string };
        chat: { id: number; type: string };
        text?: string;
        date: number;
      };
    };

    const msg = update.message ?? update.edited_message;
    if (!msg || !msg.text) {
      return null; // No text content (could be sticker, photo, etc.)
    }

    // Verify chat_id matches Max
    const expectedChatId = getSecret("telegram-chat-id");
    if (String(msg.chat.id) !== expectedChatId) {
      console.warn(
        `[telegram] Rejected message from unknown chat_id: ${msg.chat.id}`,
      );
      return null;
    }

    // Build the normalized message
    const timestamp = new Date(msg.date * 1000).toISOString();
    const messageId = `tg-${msg.message_id}-${Date.now()}`;

    const envelope: GatewayMessage = {
      id: messageId,
      channel: "telegram",
      trust: ChannelTrust.OWNER,
      content: msg.text,
      timestamp,
      metadata: {
        telegram_message_id: msg.message_id,
        telegram_chat_id: msg.chat.id,
        from_username: msg.from?.username ?? null,
      },
      requiresResponse: true,
    };

    // Sign the envelope for tamper detection downstream
    try {
      const gatewaySecret = getSecret("gateway-secret");
      const payloadStr = JSON.stringify({
        id: envelope.id,
        channel: envelope.channel,
        content: envelope.content,
        timestamp: envelope.timestamp,
      });
      envelope.signature = signEnvelope(payloadStr, gatewaySecret);
    } catch {
      console.warn("[telegram] Could not sign envelope (secret unavailable)");
    }

    return envelope;
  }

  /**
   * Send a response back to Max via Telegram Bot API.
   */
  async sendResponse(response: GatewayResponse): Promise<void> {
    const botToken = getSecret("telegram-bot-token");
    const chatId = getSecret("telegram-chat-id");

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    // Telegram has a 4096-char message limit; split if needed
    const chunks = splitMessage(response.content, 4096);

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
          // Retry without Markdown parse mode (in case of formatting errors)
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
            }),
          });
        }
      } catch (err) {
        console.error(
          "[telegram] Failed to send response:",
          err instanceof Error ? err.message : "unknown error",
        );
      }
    }
  }

  /**
   * Validate Telegram-specific auth: bearer token AND verified chat_id.
   */
  async validateAuth(req: Request): Promise<boolean> {
    // Check bearer token
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }

    const token = authHeader.slice("Bearer ".length);
    const bearerValid = await validateBearer(token);
    if (!bearerValid) {
      return false;
    }

    // Verify chat_id from the request body
    // We clone the request so the body can be read again by parseMessage
    try {
      const body = await req.clone().json();
      const msg = body?.message ?? body?.edited_message;
      if (!msg?.chat?.id) return false;

      const expectedChatId = getSecret("telegram-chat-id");
      return String(msg.chat.id) === expectedChatId;
    } catch {
      return false;
    }
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

    // Try to split at a newline near the limit
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.5) {
      // Fall back to splitting at a space
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.5) {
      // Hard split
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
