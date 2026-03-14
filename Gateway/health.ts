/**
 * Sentinel Gateway -- Health Monitoring
 *
 * Tracks runtime health metrics and exposes them via /health.
 * Other modules import `gatewayState` and update it directly.
 */

import type { HealthStatus } from "./types.ts";
import { getConnectionCount } from "./rate-limiter.ts";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Maximum heap memory before marking unhealthy (MB) */
const MAX_HEALTHY_MEMORY_MB = 512;

/** Maximum pending requests before marking unhealthy */
const MAX_HEALTHY_PENDING = 50;

// ---------------------------------------------------------------------------
// Global mutable state -- updated by other gateway modules
// ---------------------------------------------------------------------------

export interface GatewayState {
  /** ISO timestamp of server start */
  startedAt: string;
  /** Whether the Claude session subprocess is alive */
  claudeSessionAlive: boolean;
  /** Number of in-flight requests being processed */
  pendingRequests: number;
  /** ISO timestamp of the last message received */
  lastMessageAt: string | null;
  /** Token usage in the current hour */
  hourlyTokens: number;
  /** Token usage today */
  dailyTokens: number;
  /** Timestamp when hourly counter was last reset */
  hourlyResetAt: number;
  /** Timestamp when daily counter was last reset */
  dailyResetAt: number;
  /** Per-integration health flags */
  integrations: Record<string, boolean>;
}

/**
 * Shared mutable state object.
 * Gateway modules import this and mutate fields directly.
 * This avoids event-bus overhead for a single-process server.
 */
export const gatewayState: GatewayState = {
  startedAt: new Date().toISOString(),
  claudeSessionAlive: false,
  pendingRequests: 0,
  lastMessageAt: null,
  hourlyTokens: 0,
  dailyTokens: 0,
  hourlyResetAt: Date.now(),
  dailyResetAt: Date.now(),
  integrations: {
    telegram: false,
    gmail: false,
    sentry: false,
    "x-twitter": false,
    vercel: false,
  },
};

// ---------------------------------------------------------------------------
// Token counter auto-reset
// ---------------------------------------------------------------------------

/**
 * Roll over hourly/daily token counters if their windows have elapsed.
 * Called before reading state for health checks.
 */
function rolloverCounters(): void {
  const now = Date.now();

  // Hourly reset
  if (now - gatewayState.hourlyResetAt >= 3_600_000) {
    gatewayState.hourlyTokens = 0;
    gatewayState.hourlyResetAt = now;
  }

  // Daily reset
  if (now - gatewayState.dailyResetAt >= 86_400_000) {
    gatewayState.dailyTokens = 0;
    gatewayState.dailyResetAt = now;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a full HealthStatus snapshot.
 * This is what /health returns.
 */
export function getHealthStatus(): HealthStatus {
  rolloverCounters();

  const uptimeSeconds = (Date.now() - new Date(gatewayState.startedAt).getTime()) / 1000;
  const memoryMB = Math.round(process.memoryUsage.rss() / 1024 / 1024);

  return {
    status: computeStatus(memoryMB),
    uptimeSeconds: Math.floor(uptimeSeconds),
    memoryMB,
    claudeSessionAlive: gatewayState.claudeSessionAlive,
    pendingRequests: gatewayState.pendingRequests,
    lastMessageAt: gatewayState.lastMessageAt,
    wsClients: getConnectionCount(),
    hourlyTokens: gatewayState.hourlyTokens,
    dailyTokens: gatewayState.dailyTokens,
    integrations: { ...gatewayState.integrations },
  };
}

/**
 * Quick boolean health check.
 * Used by the watchdog and internal circuits.
 */
export function isHealthy(): boolean {
  const memoryMB = Math.round(process.memoryUsage.rss() / 1024 / 1024);
  return (
    memoryMB < MAX_HEALTHY_MEMORY_MB &&
    gatewayState.pendingRequests < MAX_HEALTHY_PENDING &&
    gatewayState.claudeSessionAlive
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function computeStatus(memoryMB: number): HealthStatus["status"] {
  // Unhealthy: hard limits breached
  if (memoryMB >= MAX_HEALTHY_MEMORY_MB) return "unhealthy";
  if (gatewayState.pendingRequests >= MAX_HEALTHY_PENDING) return "unhealthy";

  // Degraded: Claude session is down but server is still responding
  if (!gatewayState.claudeSessionAlive) return "degraded";

  // Degraded: approaching limits (80% thresholds)
  if (memoryMB >= MAX_HEALTHY_MEMORY_MB * 0.8) return "degraded";
  if (gatewayState.pendingRequests >= MAX_HEALTHY_PENDING * 0.8) return "degraded";

  return "healthy";
}
