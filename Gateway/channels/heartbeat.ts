/**
 * Sentinel Gateway -- Heartbeat Channel Adapter
 *
 * Handles cron-driven heartbeat messages from launchd scheduled tasks.
 * Trust level: TRUSTED (can trigger AUTONOMOUS actions only, not ASK_FIRST).
 *
 * Heartbeat modes:
 *   - regular:            Periodic health check / context refresh
 *   - daily-review:       Morning daily briefing trigger
 *   - nightly-reflection: End-of-day reflection and memory consolidation
 *
 * Responses are logged locally — heartbeats don't need external delivery.
 */

import type { ChannelAdapter } from "./types.ts";
import type { GatewayMessage, GatewayResponse } from "../types.ts";
import { ChannelTrust } from "../types.ts";
import { validateBearer } from "../auth.ts";

// ---------------------------------------------------------------------------
// Heartbeat Message Shape
// ---------------------------------------------------------------------------

interface HeartbeatPayload {
  mode: "regular" | "daily-review" | "nightly-reflection";
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Heartbeat Adapter
// ---------------------------------------------------------------------------

export class HeartbeatAdapter implements ChannelAdapter {
  readonly name = "heartbeat" as const;
  readonly trust = ChannelTrust.TRUSTED;

  /**
   * Parse a heartbeat check-in into a GatewayMessage.
   * Returns null if the payload is malformed.
   */
  async parseMessage(req: Request): Promise<GatewayMessage | null> {
    let body: HeartbeatPayload;
    try {
      body = await req.json() as HeartbeatPayload;
    } catch {
      console.error("[heartbeat] Failed to parse request body as JSON");
      return null;
    }

    // Validate mode
    const validModes = ["regular", "daily-review", "nightly-reflection"];
    if (!body.mode || !validModes.includes(body.mode)) {
      console.warn(`[heartbeat] Invalid heartbeat mode: ${body.mode}`);
      return null;
    }

    const timestamp = new Date().toISOString();
    const messageId = `hb-${body.mode}-${Date.now()}`;

    // Build content based on mode
    const content = this.buildContent(body);

    return {
      id: messageId,
      channel: "heartbeat",
      trust: ChannelTrust.TRUSTED,
      content,
      timestamp,
      metadata: {
        heartbeat_mode: body.mode,
        heartbeat_data: body.data ?? null,
      },
      requiresResponse: body.mode !== "regular", // Regular heartbeats don't need Claude's attention
    };
  }

  /**
   * Log the response locally. Heartbeats don't send responses externally.
   */
  async sendResponse(response: GatewayResponse): Promise<void> {
    console.log(
      `[heartbeat] Response for ${response.messageId}: ${response.content.slice(0, 200)}${response.content.length > 200 ? "..." : ""}`,
    );
  }

  /**
   * Validate auth: shared gateway bearer token.
   */
  async validateAuth(req: Request): Promise<boolean> {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }

    const token = authHeader.slice("Bearer ".length);
    return validateBearer(token);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private buildContent(payload: HeartbeatPayload): string {
    switch (payload.mode) {
      case "regular":
        return "[HEARTBEAT] Regular check-in. System is alive.";

      case "daily-review": {
        const data = payload.data ?? {};
        const parts = ["[HEARTBEAT] Daily review triggered."];
        if (data.health_summary) {
          parts.push(`Health: ${JSON.stringify(data.health_summary)}`);
        }
        if (data.schedule) {
          parts.push(`Schedule: ${JSON.stringify(data.schedule)}`);
        }
        return parts.join(" ");
      }

      case "nightly-reflection": {
        const data = payload.data ?? {};
        const parts = ["[HEARTBEAT] Nightly reflection triggered."];
        if (data.day_summary) {
          parts.push(`Day summary: ${JSON.stringify(data.day_summary)}`);
        }
        if (data.pending_tasks) {
          parts.push(`Pending: ${JSON.stringify(data.pending_tasks)}`);
        }
        return parts.join(" ");
      }

      default:
        return `[HEARTBEAT] Unknown mode: ${payload.mode}`;
    }
  }
}
