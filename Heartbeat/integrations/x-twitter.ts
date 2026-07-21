/**
 * X/Twitter Integration
 *
 * Uses X API v2 via direct REST calls (no heavy SDK dependency).
 *
 * Required env keys in ~/.claude/.env:
 *   X_API_KEY          — API key (consumer key)
 *   X_API_SECRET       — API secret (consumer secret)
 *   X_ACCESS_TOKEN     — User access token
 *   X_ACCESS_SECRET    — User access token secret
 *
 * Auth: OAuth 1.0a for user-context endpoints (post, reply, mentions).
 * We use a minimal OAuth 1.0a signing implementation to avoid the
 * twitter-api-v2 package weight. If you prefer the SDK, swap in later.
 */

import { createHmac, randomBytes } from "crypto";
import {
  BaseIntegration,
  type IntegrationResult,
  type TestResult,
  requestApproval,
  log,
} from "./base.ts";

// ---------------------------------------------------------------------------
// OAuth 1.0a signing (minimal implementation)
// ---------------------------------------------------------------------------

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

function buildOAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessSecret: string
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Combine all params for signature base
  const allParams = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessSecret)}`;
  const signature = createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

export class XTwitterIntegration extends BaseIntegration {
  readonly name = "x-twitter";
  readonly requiredEnvKeys = [
    "X_API_KEY",
    "X_API_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_SECRET",
  ];

  private getOAuthHeader(method: string, url: string, params: Record<string, string> = {}): string {
    return buildOAuthHeader(
      method,
      url,
      params,
      this.env("X_API_KEY"),
      this.env("X_API_SECRET"),
      this.env("X_ACCESS_TOKEN"),
      this.env("X_ACCESS_SECRET")
    );
  }

  // ---------------------------------------------------------------------------
  // X API v2 helpers
  // ---------------------------------------------------------------------------

  private async xGet(path: string, queryParams?: Record<string, string>): Promise<unknown> {
    const base = `https://api.x.com/2/${path}`;
    const qs = queryParams
      ? "?" + new URLSearchParams(queryParams).toString()
      : "";
    const url = `${base}${qs}`;

    // OAuth sig must be on the base URL; query params included in signature
    const authHeader = this.getOAuthHeader("GET", base, queryParams || {});

    const resp = await fetch(url, {
      headers: { Authorization: authHeader },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`X API GET ${path}: ${resp.status} ${text}`);
    }

    return resp.json();
  }

  private async xPost(path: string, body: unknown): Promise<unknown> {
    const url = `https://api.x.com/2/${path}`;
    const authHeader = this.getOAuthHeader("POST", url);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`X API POST ${path}: ${resp.status} ${text}`);
    }

    return resp.json();
  }

  // ---------------------------------------------------------------------------
  // Core interface
  // ---------------------------------------------------------------------------

  async check(): Promise<IntegrationResult> {
    // Get authenticated user ID first
    const me = (await this.xGet("users/me")) as {
      data: { id: string; username: string };
    };

    // Fetch recent mentions
    const mentions = (await this.xGet(
      `users/${me.data.id}/mentions`,
      {
        max_results: "10",
        "tweet.fields": "created_at,author_id,text",
      }
    )) as {
      data?: Array<{
        id: string;
        text: string;
        author_id: string;
        created_at: string;
      }>;
      meta?: { result_count: number };
    };

    return this.ok({
      user: me.data.username,
      mentionCount: mentions.meta?.result_count || 0,
      mentions: mentions.data || [],
    });
  }

  async act(action: string, params: Record<string, unknown>): Promise<IntegrationResult> {
    switch (action) {
      case "post":
        return this.post(params.text as string);
      case "reply":
        return this.reply(params.tweetId as string, params.text as string);
      default:
        return this.ok({ error: `Unknown action: ${action}` });
    }
  }

  async test(): Promise<TestResult> {
    const missing = this.checkEnvKeys();

    if (missing.length > 0) {
      return {
        integration: this.name,
        configured: false,
        healthy: false,
        missing,
        message: `Missing env keys: ${missing.join(", ")}`,
      };
    }

    return {
      integration: this.name,
      configured: true,
      healthy: true,
      message: "X/Twitter API keys present. Ready for API calls.",
    };
  }

  // ---------------------------------------------------------------------------
  // Actions (ASK_FIRST gated)
  // ---------------------------------------------------------------------------

  private async post(text: string): Promise<IntegrationResult> {
    if (!text) throw new Error("post requires 'text' param");

    // ASK_FIRST: posting a tweet requires human approval
    const approved = await requestApproval(
      this.name,
      "post",
      `Post tweet: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`
    );
    if (!approved) {
      return this.ok({ blocked: true, reason: "ASK_FIRST: awaiting approval" });
    }

    const result = await this.xPost("tweets", { text });
    log.info("Tweet posted", { text: text.slice(0, 50) });
    return this.ok(result);
  }

  private async reply(tweetId: string, text: string): Promise<IntegrationResult> {
    if (!tweetId || !text) throw new Error("reply requires 'tweetId' and 'text' params");

    // ASK_FIRST: replying also requires approval
    const approved = await requestApproval(
      this.name,
      "reply",
      `Reply to ${tweetId}: "${text.slice(0, 100)}"`
    );
    if (!approved) {
      return this.ok({ blocked: true, reason: "ASK_FIRST: awaiting approval" });
    }

    const result = await this.xPost("tweets", {
      text,
      reply: { in_reply_to_tweet_id: tweetId },
    });
    log.info("Tweet reply posted", { tweetId, text: text.slice(0, 50) });
    return this.ok(result);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point: bun run x-twitter.ts --test
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const x = new XTwitterIntegration();

  if (process.argv.includes("--test")) {
    x.safeTest().then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.healthy ? 0 : 1);
    });
  } else {
    console.log("Usage: bun run x-twitter.ts --test");
    console.log("  --test  Verify API keys exist in ~/.claude/.env");
  }
}
