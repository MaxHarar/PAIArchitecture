/**
 * Sentinel Gateway -- Webhook Channel Adapter
 *
 * Generic adapter for external webhook sources (Gmail, X/Twitter, Sentry, Vercel).
 * Trust level: EXTERNAL (read-only context injection, NO action triggering).
 *
 * All external content is wrapped via wrapExternalContent() from injection.ts
 * to prevent prompt injection. The soul prompt treats <external_data> as inert.
 *
 * Source detection:
 *   1. URL path: /webhook/gmail, /webhook/sentry, etc.
 *   2. X-Webhook-Source header
 *   3. Falls back to generic "webhook" channel
 *
 * Auth: webhook-specific signatures verified per source via auth.ts.
 */

import type { ChannelAdapter } from "./types.ts";
import type {
  ChannelId,
  GatewayMessage,
  GatewayResponse,
} from "../types.ts";
import { ChannelTrust } from "../types.ts";
import { validateWebhookSignature } from "../auth.ts";
import { wrapExternalContent } from "../injection.ts";

// ---------------------------------------------------------------------------
// Supported Webhook Sources
// ---------------------------------------------------------------------------

const WEBHOOK_SOURCES: Record<string, ChannelId> = {
  gmail: "gmail",
  "x-twitter": "x-twitter",
  x: "x-twitter",
  twitter: "x-twitter",
  sentry: "sentry",
  vercel: "vercel",
};

// ---------------------------------------------------------------------------
// Webhook Adapter
// ---------------------------------------------------------------------------

export class WebhookAdapter implements ChannelAdapter {
  readonly name = "webhook" as const;
  readonly trust = ChannelTrust.EXTERNAL;

  /**
   * Parse an incoming webhook request into a GatewayMessage.
   * Wraps ALL content in external_data envelope for injection defense.
   * Returns null if the payload is unparseable.
   */
  async parseMessage(req: Request): Promise<GatewayMessage | null> {
    const source = this.detectSource(req);
    let rawContent: string;

    try {
      const contentType = req.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = await req.json();
        rawContent = JSON.stringify(body, null, 2);
      } else {
        rawContent = await req.text();
      }
    } catch {
      console.error(`[webhook:${source}] Failed to parse request body`);
      return null;
    }

    if (!rawContent || rawContent.trim().length === 0) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const messageId = `wh-${source}-${Date.now()}`;

    // Wrap in external_data envelope — this is the critical injection defense
    const wrappedContent = wrapExternalContent(source, rawContent, {
      webhook_source: source,
      content_type: req.headers.get("content-type") ?? "unknown",
    });

    return {
      id: messageId,
      channel: source,
      trust: ChannelTrust.EXTERNAL,
      content: wrappedContent,
      rawContent,
      timestamp,
      metadata: {
        webhook_source: source,
        content_length: rawContent.length,
        headers: this.extractSafeHeaders(req),
      },
      requiresResponse: false, // Webhooks are one-way context injection
    };
  }

  /**
   * No-op for webhooks. External sources don't receive responses.
   */
  async sendResponse(_response: GatewayResponse): Promise<void> {
    // Webhooks are one-way — nothing to send back
  }

  /**
   * Validate webhook-specific signatures per source.
   * Each source uses its own signing scheme (see auth.ts).
   */
  async validateAuth(req: Request): Promise<boolean> {
    const source = this.detectSource(req);
    const signature = this.extractSignature(req, source);

    if (!signature) {
      console.warn(`[webhook:${source}] No signature found in request`);
      return false;
    }

    try {
      const body = await req.clone().arrayBuffer();
      return validateWebhookSignature(
        source,
        Buffer.from(body),
        signature,
      );
    } catch (err) {
      console.error(
        `[webhook:${source}] Signature verification error:`,
        err instanceof Error ? err.message : "unknown error",
      );
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Detect the webhook source from the URL path or headers.
   */
  private detectSource(req: Request): ChannelId {
    // Check X-Webhook-Source header first
    const headerSource = req.headers.get("x-webhook-source");
    if (headerSource && WEBHOOK_SOURCES[headerSource.toLowerCase()]) {
      return WEBHOOK_SOURCES[headerSource.toLowerCase()]!;
    }

    // Parse from URL path: /webhook/{source}
    try {
      const url = new URL(req.url);
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length >= 2 && segments[0] === "webhook") {
        const pathSource = segments[1]!.toLowerCase();
        if (WEBHOOK_SOURCES[pathSource]) {
          return WEBHOOK_SOURCES[pathSource]!;
        }
      }
    } catch {
      // URL parsing failed — fall through to default
    }

    return "webhook";
  }

  /**
   * Extract the webhook signature from source-specific headers.
   */
  private extractSignature(req: Request, source: ChannelId): string | null {
    // Common signature header
    const generic = req.headers.get("x-webhook-signature");
    if (generic) return generic;

    // Source-specific headers
    switch (source) {
      case "gmail":
        return req.headers.get("authorization") ?? null;
      case "x-twitter":
        return req.headers.get("x-twitter-webhooks-signature") ?? null;
      case "sentry":
        return req.headers.get("sentry-hook-signature") ?? null;
      case "vercel":
        return req.headers.get("x-vercel-signature") ?? null;
      default:
        return null;
    }
  }

  /**
   * Extract safe (non-secret) headers for metadata logging.
   * Never include Authorization or signature headers.
   */
  private extractSafeHeaders(req: Request): Record<string, string> {
    const safe: Record<string, string> = {};
    const allowList = [
      "content-type",
      "content-length",
      "user-agent",
      "x-request-id",
      "x-webhook-source",
    ];

    for (const key of allowList) {
      const val = req.headers.get(key);
      if (val) safe[key] = val;
    }

    return safe;
  }
}
