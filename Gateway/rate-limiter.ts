/**
 * Sentinel Gateway -- Token Bucket Rate Limiter
 *
 * Per-channel and global rate limiting with automatic bucket refill.
 * No external dependencies. All limits are code-enforced constants.
 */

import type { ChannelId } from "./types.ts";

// ---------------------------------------------------------------------------
// Rate limit configuration (hardcoded -- not configurable at runtime)
// ---------------------------------------------------------------------------

interface ChannelLimit {
  /** Maximum requests allowed per minute */
  requestsPerMinute: number;
}

const CHANNEL_LIMITS: Record<string, ChannelLimit> = {
  telegram:    { requestsPerMinute: 30 },
  gmail:       { requestsPerMinute: 10 },
  sentry:      { requestsPerMinute: 5 },
  heartbeat:   { requestsPerMinute: 4 },
  webhook:     { requestsPerMinute: 5 },
  "x-twitter": { requestsPerMinute: 10 },
  vercel:      { requestsPerMinute: 5 },
  terminal:    { requestsPerMinute: 30 },
  system:      { requestsPerMinute: 20 },
};

/** Fallback for any channel not explicitly listed */
const DEFAULT_LIMIT: ChannelLimit = { requestsPerMinute: 10 };

/** Global ceiling across ALL channels combined */
const GLOBAL_REQUESTS_PER_MINUTE = 100;

/** Maximum allowed message body size in bytes */
const MAX_MESSAGE_SIZE_BYTES = 100 * 1024; // 100KB

/** Maximum concurrent WebSocket connections */
const MAX_WS_CONNECTIONS = 5;

// ---------------------------------------------------------------------------
// Token bucket internals
// ---------------------------------------------------------------------------

interface Bucket {
  /** Current available tokens */
  tokens: number;
  /** Timestamp of last refill (ms) */
  lastRefillAt: number;
  /** Max capacity (requests per minute) */
  capacity: number;
  /** Refill rate (tokens per millisecond) */
  refillRatePerMs: number;
}

function createBucket(capacity: number): Bucket {
  return {
    tokens: capacity,
    lastRefillAt: Date.now(),
    capacity,
    refillRatePerMs: capacity / 60_000, // spread evenly across one minute
  };
}

/**
 * Refill a bucket based on elapsed time, then try to consume one token.
 * Returns remaining tokens (>= 0 if allowed) or the deficit (< 0 if denied).
 */
function tryConsume(bucket: Bucket): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const elapsed = now - bucket.lastRefillAt;

  // Refill proportionally
  bucket.tokens = Math.min(
    bucket.capacity,
    bucket.tokens + elapsed * bucket.refillRatePerMs,
  );
  bucket.lastRefillAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  // Not enough tokens -- compute when one token will be available
  const deficit = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil(deficit / bucket.refillRatePerMs);
  return { allowed: false, retryAfterMs };
}

// ---------------------------------------------------------------------------
// Exported rate limiter
// ---------------------------------------------------------------------------

/** Per-channel buckets keyed by ChannelId */
const channelBuckets = new Map<string, Bucket>();

/** Global bucket (all channels combined) */
const globalBucket: Bucket = createBucket(GLOBAL_REQUESTS_PER_MINUTE);

/** Current WebSocket connection count */
let wsConnectionCount = 0;

function getChannelBucket(channel: ChannelId): Bucket {
  let bucket = channelBuckets.get(channel);
  if (!bucket) {
    const limits = CHANNEL_LIMITS[channel] ?? DEFAULT_LIMIT;
    bucket = createBucket(limits.requestsPerMinute);
    channelBuckets.set(channel, bucket);
  }
  return bucket;
}

/**
 * Check whether a request from the given channel is allowed.
 * Enforces both per-channel and global rate limits.
 */
export function checkRateLimit(
  channel: ChannelId,
): { allowed: boolean; retryAfterMs?: number } {
  // Check global limit first
  const globalResult = tryConsume(globalBucket);
  if (!globalResult.allowed) {
    return {
      allowed: false,
      retryAfterMs: globalResult.retryAfterMs,
    };
  }

  // Check per-channel limit
  const channelBucket = getChannelBucket(channel);
  const channelResult = tryConsume(channelBucket);
  if (!channelResult.allowed) {
    // Refund the global token since the channel rejected it
    globalBucket.tokens = Math.min(globalBucket.capacity, globalBucket.tokens + 1);
    return {
      allowed: false,
      retryAfterMs: channelResult.retryAfterMs,
    };
  }

  return { allowed: true };
}

/**
 * Check whether a message body is within the size limit.
 */
export function checkMessageSize(bytes: number): boolean {
  return bytes <= MAX_MESSAGE_SIZE_BYTES;
}

/**
 * Check whether a new WebSocket connection can be accepted.
 */
export function checkConnectionLimit(): boolean {
  return wsConnectionCount < MAX_WS_CONNECTIONS;
}

/**
 * Increment WebSocket connection counter.
 * Call when a new WS connection is established.
 */
export function registerConnection(): void {
  wsConnectionCount++;
}

/**
 * Decrement WebSocket connection counter.
 * Call when a WS connection closes.
 */
export function unregisterConnection(): void {
  wsConnectionCount = Math.max(0, wsConnectionCount - 1);
}

/**
 * Get current WebSocket connection count (for health reporting).
 */
export function getConnectionCount(): number {
  return wsConnectionCount;
}

/**
 * Reset all rate limit state. Only useful for testing.
 */
export function resetAll(): void {
  channelBuckets.clear();
  globalBucket.tokens = globalBucket.capacity;
  globalBucket.lastRefillAt = Date.now();
  wsConnectionCount = 0;
}
