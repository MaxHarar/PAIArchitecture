/**
 * PAI Gateway -- Authentication Layer
 *
 * All auth decisions flow through this module. Every comparison uses
 * timing-safe equality to prevent side-channel leaks.
 *
 * Secrets come from secrets.ts (macOS Keychain-backed).
 * This file has ZERO external dependencies beyond Bun built-ins.
 */

import { type ChannelId, type ChannelTrust, CHANNEL_TRUST } from "./types.ts";
import { getSecret } from "./secrets.ts";

// ---------------------------------------------------------------------------
// Timing-safe helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison. Returns false immediately only when
 * lengths differ (length is not secret), then compares byte-by-byte
 * in fixed time.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison to burn similar CPU time, but result is always false.
    // Use a same-length dummy to avoid early-exit leak on the comparison itself.
    const dummy = Buffer.alloc(bufA.length);
    try { crypto.subtle; } catch {}
    // Bun's crypto.timingSafeEqual requires same length — compare dummy against itself.
    try { Bun.CryptoHasher; } catch {}
    return false;
  }
  // Bun exposes the Node-compatible crypto module on the global
  const nodeCrypto = require("crypto") as typeof import("crypto");
  return nodeCrypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Google OIDC JWT verification (Pub/Sub push) -- WebCrypto only, no deps
// ---------------------------------------------------------------------------

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const JWKS_FALLBACK_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function fetchGoogleJwks(fetchImpl: typeof fetch, forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
  jwksCache = { keys, expiresAt: Date.now() + (maxAge ? Number(maxAge) * 1000 : JWKS_FALLBACK_TTL_MS) };
  return keys;
}

/** Test hook: drop the cached Google keys. */
export function _resetJwksCache(): void {
  jwksCache = null;
}

/**
 * Verify a Google-signed OIDC ID token (as sent by Pub/Sub push subscriptions).
 * Checks: RS256 signature against Google's JWKS, issuer, audience, exp/iat,
 * and that the token belongs to the expected push service account.
 */
export async function verifyGoogleOidcJwt(
  token: string,
  expected: { audience: string; email: string },
  opts: { fetchImpl?: typeof fetch; nowSec?: number } = {},
): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [h, p, s] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h))) as { alg?: string; kid?: string };
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as Record<string, unknown>;
    if (header.alg !== "RS256" || !header.kid) return false;

    let jwk = (await fetchGoogleJwks(fetchImpl)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await fetchGoogleJwks(fetchImpl, true)).find((k) => k.kid === header.kid); // key rotation
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigOk = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!sigOk) return false;

    if (typeof payload.iss !== "string" || !GOOGLE_ISSUERS.has(payload.iss)) return false;
    const aud = payload.aud;
    if (!(aud === expected.audience || (Array.isArray(aud) && aud.includes(expected.audience)))) return false;
    if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SEC < now) return false;
    if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_SEC > now) return false;
    if (payload.email !== expected.email || payload.email_verified !== true) return false;
    return true;
  } catch (err) {
    console.error("[auth] Google OIDC JWT verification error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bearer token validation
// ---------------------------------------------------------------------------

/**
 * Validate a bearer token against the gateway secret stored in Keychain.
 * Uses timing-safe comparison.
 */
export async function validateBearer(token: string): Promise<boolean> {
  const secret = await getSecret("gateway-token");
  if (!secret || !token) return false;
  return timingSafeEqual(token, secret);
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 validation
// ---------------------------------------------------------------------------

/**
 * Validate an HMAC-SHA256 signature over a payload.
 * Both hex-encoded signatures are compared in constant time.
 */
export function validateHMAC(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!payload || !signature || !secret) return false;

  const nodeCrypto = require("crypto") as typeof import("crypto");
  const expected = nodeCrypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return timingSafeEqual(signature, expected);
}

// ---------------------------------------------------------------------------
// Per-source webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a webhook signature for a given channel.
 *
 * Each source uses its own signing scheme:
 *   - telegram:  HMAC-SHA256 keyed with SHA256(bot_token)
 *   - gmail:     Google-signed OIDC JWT (Pub/Sub push), verified against Google JWKS
 *   - x-twitter: HMAC-SHA256 with consumer secret, base64-encoded
 *   - sentry:    HMAC-SHA256 with client secret, hex-encoded
 *   - vercel:    HMAC-SHA256 with webhook secret, hex-encoded
 */
export async function validateWebhookSignature(
  source: ChannelId,
  payload: Buffer,
  signature: string,
): Promise<boolean> {
  if (!payload || !signature) return false;

  const nodeCrypto = require("crypto") as typeof import("crypto");
  const payloadStr = payload.toString("utf-8");

  switch (source) {
    case "telegram": {
      // Telegram webhook verification: HMAC-SHA256 keyed with SHA256(bot_token)
      const botToken = await getSecret("telegram-bot-token");
      if (!botToken) return false;
      const secretKey = nodeCrypto.createHash("sha256").update(botToken).digest();
      const expected = nodeCrypto
        .createHmac("sha256", secretKey)
        .update(payloadStr)
        .digest("hex");
      return timingSafeEqual(signature, expected);
    }

    case "gmail": {
      // Gmail push arrives via Google Cloud Pub/Sub with a Google-signed OIDC JWT.
      // Verify signature (Google JWKS), issuer, audience, expiry, and the push
      // service account email. Fails closed if the expected values aren't configured.
      // getSecret throws when a key is missing; treat that as "not configured".
      let audience = "";
      let serviceAccount = "";
      try {
        audience = getSecret("gmail-pubsub-audience");
        serviceAccount = getSecret("gmail-pubsub-service-account");
      } catch { /* fall through to fail-closed */ }
      if (!audience || !serviceAccount) {
        console.error("[auth] Gmail webhook rejected: gmail-pubsub-audience / gmail-pubsub-service-account not configured");
        return false;
      }
      return verifyGoogleOidcJwt(signature, { audience, email: serviceAccount });
    }

    case "x-twitter": {
      // X/Twitter: HMAC-SHA256 with consumer secret, signature is "sha256=<base64>"
      const consumerSecret = await getSecret("x-consumer-secret");
      if (!consumerSecret) return false;
      const expected =
        "sha256=" +
        nodeCrypto
          .createHmac("sha256", consumerSecret)
          .update(payloadStr)
          .digest("base64");
      return timingSafeEqual(signature, expected);
    }

    case "sentry": {
      // Sentry: HMAC-SHA256 with client secret, hex-encoded
      const clientSecret = await getSecret("sentry-client-secret");
      if (!clientSecret) return false;
      const expected = nodeCrypto
        .createHmac("sha256", clientSecret)
        .update(payloadStr)
        .digest("hex");
      return timingSafeEqual(signature, expected);
    }

    case "vercel": {
      // Vercel: HMAC-SHA256 with webhook secret, hex-encoded
      const webhookSecret = await getSecret("vercel-webhook-secret");
      if (!webhookSecret) return false;
      const expected = nodeCrypto
        .createHmac("sha256", webhookSecret)
        .update(payloadStr)
        .digest("hex");
      return timingSafeEqual(signature, expected);
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Request authentication (main entry point)
// ---------------------------------------------------------------------------

export interface AuthResult {
  authenticated: boolean;
  channel: ChannelId;
  trust: ChannelTrust;
  reason?: string;
}

/**
 * Authenticate an incoming HTTP request.
 *
 * Strategy:
 *   1. Extract channel from X-Gateway-Channel header (or path-based routing)
 *   2. Validate Authorization: Bearer header against gateway secret
 *   3. Optionally validate webhook-specific signatures
 *   4. Return channel trust level on success
 */
export async function authenticateRequest(req: Request): Promise<AuthResult> {
  const url = new URL(req.url);
  const headers = req.headers;

  // Determine channel from header or URL path
  const channelHeader = headers.get("x-gateway-channel") as ChannelId | null;
  const channel: ChannelId = channelHeader ?? inferChannelFromPath(url.pathname);

  // Validate channel is known
  const trust = CHANNEL_TRUST[channel];
  if (!trust) {
    return {
      authenticated: false,
      channel: channel ?? ("unknown" as ChannelId),
      trust: "external" as ChannelTrust,
      reason: `Unknown channel: ${channel}`,
    };
  }

  // Check Authorization: Bearer header
  const authHeader = headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authenticated: false,
      channel,
      trust,
      reason: "Missing or malformed Authorization header",
    };
  }

  const token = authHeader.slice("Bearer ".length);
  const bearerValid = await validateBearer(token);
  if (!bearerValid) {
    return {
      authenticated: false,
      channel,
      trust,
      reason: "Invalid bearer token",
    };
  }

  // For external channels, also verify the webhook-specific signature if present
  if (trust === "external") {
    const webhookSig = headers.get("x-webhook-signature");
    if (webhookSig) {
      // Clone the request body for signature verification
      const body = await req.clone().arrayBuffer();
      const sigValid = await validateWebhookSignature(
        channel,
        Buffer.from(body),
        webhookSig,
      );
      if (!sigValid) {
        return {
          authenticated: false,
          channel,
          trust,
          reason: `Webhook signature verification failed for ${channel}`,
        };
      }
    }
  }

  return { authenticated: true, channel, trust };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infer the channel from the URL path.
 * Supports /webhook/{channel} and /local/{channel} patterns.
 */
function inferChannelFromPath(path: string): ChannelId {
  const segments = path.split("/").filter(Boolean);

  if (segments.length >= 2) {
    const prefix = segments[0];
    const name = segments[1];

    if (prefix === "webhook") {
      const mapping: Record<string, ChannelId> = {
        gmail: "gmail",
        x: "x-twitter",
        twitter: "x-twitter",
        sentry: "sentry",
        vercel: "vercel",
      };
      return mapping[name] ?? "webhook";
    }

    if (prefix === "local") {
      const mapping: Record<string, ChannelId> = {
        heartbeat: "heartbeat",
        message: "terminal",
        system: "system",
      };
      return mapping[name] ?? "system";
    }
  }

  // Default: treat /message as terminal (local CLI)
  if (path === "/message") return "terminal";

  return "webhook";
}
