/**
 * Sentinel Gateway — Shared Types
 *
 * Foundation types used across all gateway modules.
 * This file has ZERO dependencies — import freely from anywhere.
 */

// ---------------------------------------------------------------------------
// Channel Trust Levels
// ---------------------------------------------------------------------------

/** Trust tier determines what actions a channel can trigger */
export enum ChannelTrust {
  /** Direct message from verified Max via Telegram */
  OWNER = "owner",
  /** Internal services: cron heartbeat, local tools */
  TRUSTED = "trusted",
  /** External webhooks: Gmail, X, Sentry — untrusted content */
  EXTERNAL = "external",
}

/** Registered channel identifiers */
export type ChannelId =
  | "telegram"
  | "heartbeat"
  | "gmail"
  | "x-twitter"
  | "sentry"
  | "vercel"
  | "webhook"
  | "terminal"
  | "system";

/** Channel trust mapping — hardcoded, not configurable */
export const CHANNEL_TRUST: Record<ChannelId, ChannelTrust> = {
  telegram: ChannelTrust.OWNER,
  terminal: ChannelTrust.OWNER,
  heartbeat: ChannelTrust.TRUSTED,
  system: ChannelTrust.TRUSTED,
  gmail: ChannelTrust.EXTERNAL,
  "x-twitter": ChannelTrust.EXTERNAL,
  sentry: ChannelTrust.EXTERNAL,
  vercel: ChannelTrust.EXTERNAL,
  webhook: ChannelTrust.EXTERNAL,
};

// ---------------------------------------------------------------------------
// Autonomy Tiers (code-enforced, never prompt-only)
// ---------------------------------------------------------------------------

export type AutonomyTier = "AUTONOMOUS" | "ASK_FIRST" | "NEVER";

/** What each channel trust level can invoke */
export const CHANNEL_PERMISSIONS: Record<ChannelTrust, AutonomyTier[]> = {
  [ChannelTrust.OWNER]: ["AUTONOMOUS", "ASK_FIRST"],
  [ChannelTrust.TRUSTED]: ["AUTONOMOUS"],
  [ChannelTrust.EXTERNAL]: [], // Read-only context injection, no actions
};

// ---------------------------------------------------------------------------
// Gateway Messages
// ---------------------------------------------------------------------------

/** Normalized message format — all channels produce this */
export interface GatewayMessage {
  /** Unique message ID */
  id: string;
  /** Which channel sent this */
  channel: ChannelId;
  /** Trust level of the channel */
  trust: ChannelTrust;
  /** The actual message content (sanitized for external channels) */
  content: string;
  /** Raw content before sanitization (for logging, never sent to Claude) */
  rawContent?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Additional metadata from the channel */
  metadata?: Record<string, unknown>;
  /** Whether this message should trigger Claude response */
  requiresResponse: boolean;
  /** HMAC signature of the envelope (for verification) */
  signature?: string;
}

/** Response from the gateway back to a channel */
export interface GatewayResponse {
  /** Original message ID this responds to */
  messageId: string;
  /** Channel to route response to */
  channel: ChannelId;
  /** Response text */
  content: string;
  /** Whether any tool calls were made */
  toolCallsMade: boolean;
  /** Token usage for this response */
  usage?: TokenUsage;
  /** ISO timestamp */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Token Usage & Cost Tracking
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUSD?: number;
}

export interface CostBudget {
  maxTokensPerTurn: number;       // 32,000 output tokens
  maxTurnsPerMessage: number;     // 25 agentic turns
  maxTokensPerHour: number;       // 500,000
  maxTokensPerDay: number;        // 5,000,000
  maxConsecutiveErrors: number;   // 3 tool errors → pause
}

// ---------------------------------------------------------------------------
// Tool Call Interception
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  /** Tool name being invoked */
  tool: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Channel that triggered this conversation */
  sourceChannel: ChannelId;
  /** Trust level of the source */
  sourceTrust: ChannelTrust;
}

export interface ToolCallDecision {
  /** Whether the tool call is allowed */
  allowed: boolean;
  /** Reason for blocking (if not allowed) */
  reason?: string;
  /** Whether to escalate to Max via Telegram */
  escalate?: boolean;
}

// ---------------------------------------------------------------------------
// Session State
// ---------------------------------------------------------------------------

export interface SessionState {
  /** Claude session ID for resume */
  sessionId: string | null;
  /** When the session was created */
  createdAt: number;
  /** When the session was last active */
  lastActiveAt: number;
  /** Total messages in this session */
  messageCount: number;
  /** Total tokens used in this session */
  totalTokens: number;
  /** Whether the session is currently processing */
  isProcessing: boolean;
  /** Process ID that owns this session */
  pid: number;
}

// ---------------------------------------------------------------------------
// Health & Monitoring
// ---------------------------------------------------------------------------

export interface HealthStatus {
  /** Server status */
  status: "healthy" | "degraded" | "unhealthy";
  /** Process uptime in seconds */
  uptimeSeconds: number;
  /** Heap memory usage in MB */
  memoryMB: number;
  /** Whether Claude session is alive */
  claudeSessionAlive: boolean;
  /** Number of pending requests in queue */
  pendingRequests: number;
  /** Last message timestamp */
  lastMessageAt: string | null;
  /** Connected WebSocket clients */
  wsClients: number;
  /** Token usage in current hour */
  hourlyTokens: number;
  /** Token usage today */
  dailyTokens: number;
  /** Integration statuses */
  integrations: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Action type: message_received, tool_call, response_sent, auth_failure, etc. */
  eventType: string;
  /** Channel that triggered the event */
  channel: ChannelId;
  /** Trust level */
  trust: ChannelTrust;
  /** Event details (sanitized — no secrets) */
  details: string;
  /** Outcome: success, blocked, escalated, error */
  outcome: "success" | "blocked" | "escalated" | "error";
  /** SHA-256 hash of this entry (for tamper detection) */
  hash?: string;
  /** Hash of the previous entry (chain) */
  prevHash?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GatewayConfig {
  /** Server bind host */
  host: string;
  /** Server port */
  port: number;
  /** Path to SQLite database */
  dbPath: string;
  /** Path to audit log directory */
  logDir: string;
  /** Path to Sentinel workspace */
  workspacePath: string;
  /** Cost budget configuration */
  costBudget: CostBudget;
  /** Claude model to use (pinned version) */
  claudeModel: string;
  /** Working directory for Claude */
  claudeWorkDir: string;
  /** Max context turns to keep verbatim */
  maxVerbatimTurns: number;
  /** Session rotation interval in ms (24h default) */
  sessionRotationMs: number;
}

/** Default configuration */
export const DEFAULT_CONFIG: GatewayConfig = {
  host: "127.0.0.1",
  port: 18800,
  dbPath: `${process.env.HOME}/Sentinel/gateway.db`,
  logDir: `${process.env.HOME}/Sentinel/Logs`,
  workspacePath: `${process.env.HOME}/Sentinel`,
  costBudget: {
    maxTokensPerTurn: 32_000,
    maxTurnsPerMessage: 25,
    maxTokensPerHour: 500_000,
    maxTokensPerDay: 5_000_000,
    maxConsecutiveErrors: 3,
  },
  claudeModel: "claude-sonnet-4-5",
  claudeWorkDir: `${process.env.HOME}/.claude`,
  maxVerbatimTurns: 30,
  sessionRotationMs: 24 * 60 * 60 * 1000, // 24 hours
};

// ---------------------------------------------------------------------------
// Egress Control
// ---------------------------------------------------------------------------

/** Domains the gateway is allowed to make outbound requests to */
export const ALLOWED_EGRESS_DOMAINS = new Set([
  "api.anthropic.com",
  "api.telegram.org",
  "api.github.com",
  "api.vercel.com",
  "googleapis.com",
  "www.googleapis.com",
  "oauth2.googleapis.com",
  "api.x.com",
  "api.twitter.com",
]);

/** Shell commands that could make network requests — blocked */
export const BLOCKED_NETWORK_COMMANDS =
  /\b(curl|wget|nc|ncat|netcat|ssh|scp|rsync|telnet|ftp)\b/;
