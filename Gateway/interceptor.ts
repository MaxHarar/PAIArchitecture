/**
 * Sentinel Gateway — Code-Enforced Tool Call Interceptor
 *
 * HARDCODED permission tiers. Not in a config file. Not in a prompt. IN THE CODE.
 * The NEVER tier is UNCONDITIONAL. No argument, no context, no channel trust
 * level can override it. This is the last line of defense against prompt injection.
 *
 * Also includes: CostGuard (budget enforcement), egress validation, shell validation.
 */

import type {
  ChannelId,
  ChannelTrust,
  ToolCallEvent,
  ToolCallDecision,
  CostBudget,
} from "./types";
import {
  CHANNEL_TRUST,
  CHANNEL_PERMISSIONS,
  ALLOWED_EGRESS_DOMAINS,
  BLOCKED_NETWORK_COMMANDS,
  DEFAULT_CONFIG,
} from "./types";

// ---------------------------------------------------------------------------
// HARDCODED Tool Permission Tiers
// ---------------------------------------------------------------------------

/**
 * AUTONOMOUS: Safe read-only operations. Any trust level with AUTONOMOUS
 * permission can invoke these without confirmation.
 */
const AUTONOMOUS_TOOLS = new Set<string>([
  // Legacy snake_case names
  "read_file",
  "search_code",
  "list_directory",
  "glob",
  "grep",
  "read",
  "web_search",
  // Claude Code PascalCase tool names
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "ToolSearch",
  "Agent",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskUpdate",
  "TaskStop",
]);

/**
 * ASK_FIRST: Potentially destructive or externally-visible operations.
 * Only OWNER trust level can invoke these, and they may require confirmation.
 */
const ASK_FIRST_TOOLS = new Set<string>([
  // Legacy snake_case names
  "write_file",
  "edit_file",
  "bash",
  "web_fetch",
  "git_push",
  "deploy",
  "send_email",
  "post_tweet",
  // Claude Code PascalCase tool names
  "Edit",
  "Write",
  "Bash",
  "WebFetch",
  "Skill",
  "NotebookEdit",
  "TodoWrite",
  "SendMessage",
]);

/**
 * NEVER: Catastrophically dangerous operations.
 * UNCONDITIONALLY BLOCKED. No trust level, no context, no argument can override.
 * This is the hard safety floor.
 */
const NEVER_TOOLS = new Set<string>([
  "delete_file",
  "modify_env",
  "modify_soul",
  "access_keychain",
  "rm_rf",
  "drop_database",
  "force_push",
  "transfer_money",
]);

/**
 * Patterns in tool arguments that escalate a tool to NEVER tier.
 * Even if the tool name is in AUTONOMOUS or ASK_FIRST, these arg patterns
 * cause unconditional blocking.
 */
const NEVER_ARG_PATTERNS: Array<{ field: string; pattern: RegExp; reason: string }> = [
  // Recursive deletion via bash
  { field: "command", pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s/i, reason: "Recursive file deletion" },
  { field: "command", pattern: /rm\s+-[a-zA-Z]*f[a-zA-Z]*r\s/i, reason: "Recursive file deletion (flag order)" },
  // Force push
  { field: "command", pattern: /git\s+push\s+.*--force/i, reason: "Git force push" },
  { field: "command", pattern: /git\s+push\s+-f\b/i, reason: "Git force push (-f)" },
  // Database destruction
  { field: "command", pattern: /drop\s+(table|database|schema)/i, reason: "Database DROP operation" },
  { field: "command", pattern: /truncate\s+table/i, reason: "Database TRUNCATE operation" },
  // Soul / env modification
  { field: "file_path", pattern: /soul\.ts$/i, reason: "Attempt to modify soul.ts" },
  { field: "file_path", pattern: /soul\.md$/i, reason: "Attempt to modify SOUL.md" },
  { field: "file_path", pattern: /\.env$/i, reason: "Attempt to modify .env" },
  { field: "file_path", pattern: /settings\.json$/i, reason: "Attempt to modify settings.json" },
  // Sensitive system paths
  { field: "command", pattern: /\/etc\/passwd/i, reason: "Access to /etc/passwd" },
  { field: "command", pattern: /\.ssh\//i, reason: "Access to SSH directory" },
  { field: "command", pattern: /security\s+(find|add|delete)-generic-password/i, reason: "Direct Keychain access" },
  // Pipe-to-shell
  { field: "command", pattern: /curl\s+.*\|\s*(ba)?sh/i, reason: "Pipe to shell (curl)" },
  { field: "command", pattern: /wget\s+.*\|\s*(ba)?sh/i, reason: "Pipe to shell (wget)" },
];

// ---------------------------------------------------------------------------
// Blocked Tool Calls Log (in-memory ring buffer)
// ---------------------------------------------------------------------------

interface BlockedCallRecord {
  timestamp: string;
  tool: string;
  sourceChannel: ChannelId;
  sourceTrust: ChannelTrust;
  reason: string;
}

const MAX_BLOCKED_LOG = 1000;
const blockedCalls: BlockedCallRecord[] = [];

function logBlockedCall(
  event: ToolCallEvent,
  reason: string,
): void {
  const record: BlockedCallRecord = {
    timestamp: new Date().toISOString(),
    tool: event.tool,
    sourceChannel: event.sourceChannel,
    sourceTrust: event.sourceTrust,
    reason,
  };

  blockedCalls.push(record);
  if (blockedCalls.length > MAX_BLOCKED_LOG) {
    blockedCalls.shift();
  }

  console.error(
    `[interceptor] BLOCKED: tool="${event.tool}" channel="${event.sourceChannel}" trust="${event.sourceTrust}" reason="${reason}"`,
  );
}

/** Get recent blocked calls (for audit/debugging). */
export function getBlockedCalls(): ReadonlyArray<BlockedCallRecord> {
  return blockedCalls;
}

// ---------------------------------------------------------------------------
// Main Interceptor
// ---------------------------------------------------------------------------

/**
 * Intercept a tool call and decide whether it should be allowed.
 *
 * Evaluation order:
 *   1. NEVER tier check (unconditional, checked FIRST)
 *   2. NEVER arg pattern check (escalation via argument inspection)
 *   3. EXTERNAL channel check (no tool calls ever)
 *   4. Channel trust vs. tool tier permission check
 */
export function interceptToolCall(event: ToolCallEvent): ToolCallDecision {
  const { tool, args, sourceChannel, sourceTrust } = event;

  // -----------------------------------------------------------------------
  // STEP 1: NEVER tier — UNCONDITIONAL BLOCK
  // No argument, no context, no channel trust level can override this.
  // -----------------------------------------------------------------------
  if (NEVER_TOOLS.has(tool)) {
    const reason = `Tool "${tool}" is in the NEVER tier — unconditionally blocked`;
    logBlockedCall(event, reason);
    return { allowed: false, reason, escalate: true };
  }

  // -----------------------------------------------------------------------
  // STEP 2: NEVER arg patterns — escalate safe tools to NEVER tier
  // -----------------------------------------------------------------------
  for (const check of NEVER_ARG_PATTERNS) {
    const argValue = args[check.field];
    if (typeof argValue === "string" && check.pattern.test(argValue)) {
      const reason = `Argument pattern blocked: ${check.reason}`;
      logBlockedCall(event, reason);
      return { allowed: false, reason, escalate: true };
    }
  }

  // -----------------------------------------------------------------------
  // STEP 3: EXTERNAL channels NEVER trigger tool calls
  // External channels are context injection ONLY.
  // -----------------------------------------------------------------------
  if (sourceTrust === "external") {
    const reason = `External channel "${sourceChannel}" cannot invoke tools — context injection only`;
    logBlockedCall(event, reason);
    return { allowed: false, reason, escalate: false };
  }

  // -----------------------------------------------------------------------
  // STEP 4: Resolve tool tier and check channel permissions
  // -----------------------------------------------------------------------
  const channelPerms = CHANNEL_PERMISSIONS[sourceTrust as ChannelTrust];

  if (AUTONOMOUS_TOOLS.has(tool)) {
    if (channelPerms.includes("AUTONOMOUS")) {
      return { allowed: true };
    }
    const reason = `Channel trust "${sourceTrust}" does not have AUTONOMOUS permission`;
    logBlockedCall(event, reason);
    return { allowed: false, reason };
  }

  if (ASK_FIRST_TOOLS.has(tool)) {
    if (channelPerms.includes("ASK_FIRST")) {
      return { allowed: true };
    }
    const reason = `Tool "${tool}" requires ASK_FIRST permission — channel trust "${sourceTrust}" insufficient`;
    logBlockedCall(event, reason);
    return { allowed: false, reason, escalate: true };
  }

  // MCP tools (mcp__*) — treat as ASK_FIRST for OWNER channels
  if (tool.startsWith("mcp__")) {
    if (channelPerms.includes("ASK_FIRST")) {
      return { allowed: true };
    }
    const reason = `MCP tool "${tool}" requires ASK_FIRST permission — channel trust "${sourceTrust}" insufficient`;
    logBlockedCall(event, reason);
    return { allowed: false, reason, escalate: true };
  }

  // Unknown tool — block by default. Fail closed.
  const reason = `Unknown tool "${tool}" — not in any permission tier. Blocked (fail-closed).`;
  logBlockedCall(event, reason);
  return { allowed: false, reason, escalate: true };
}

// ---------------------------------------------------------------------------
// CostGuard — Token Budget Enforcement & Circuit Breaker
// ---------------------------------------------------------------------------

export class CostGuard {
  private hourlyTokens = 0;
  private dailyTokens = 0;
  private consecutiveErrors = 0;
  private budget: CostBudget;

  private hourlyResetTimer: ReturnType<typeof setInterval> | null = null;
  private dailyResetTimer: ReturnType<typeof setInterval> | null = null;

  constructor(budget?: CostBudget) {
    this.budget = budget ?? DEFAULT_CONFIG.costBudget;

    // Auto-reset hourly
    this.hourlyResetTimer = setInterval(() => this.resetHourly(), 60 * 60 * 1000);
    // Auto-reset daily
    this.dailyResetTimer = setInterval(() => this.resetDaily(), 24 * 60 * 60 * 1000);
  }

  /**
   * Check if a token expenditure is within budget.
   * Returns false if over budget (should pause processing).
   */
  checkBudget(tokensUsed: number): boolean {
    this.hourlyTokens += tokensUsed;
    this.dailyTokens += tokensUsed;

    if (this.hourlyTokens > this.budget.maxTokensPerHour) {
      console.error(
        `[CostGuard] Hourly token limit exceeded: ${this.hourlyTokens}/${this.budget.maxTokensPerHour}`,
      );
      return false;
    }

    if (this.dailyTokens > this.budget.maxTokensPerDay) {
      console.error(
        `[CostGuard] Daily token limit exceeded: ${this.dailyTokens}/${this.budget.maxTokensPerDay}`,
      );
      return false;
    }

    // Reset error streak on successful spend
    this.consecutiveErrors = 0;
    return true;
  }

  /**
   * Record a tool error. Returns false if circuit breaker trips (3+ consecutive errors).
   */
  onToolError(): boolean {
    this.consecutiveErrors++;

    if (this.consecutiveErrors >= this.budget.maxConsecutiveErrors) {
      console.error(
        `[CostGuard] Circuit breaker tripped: ${this.consecutiveErrors} consecutive errors`,
      );
      return false;
    }

    return true;
  }

  /** Reset the consecutive error counter (e.g., after a successful tool call). */
  resetErrors(): void {
    this.consecutiveErrors = 0;
  }

  /** Reset hourly token counter. */
  resetHourly(): void {
    console.log(
      `[CostGuard] Hourly reset. Tokens used this hour: ${this.hourlyTokens}`,
    );
    this.hourlyTokens = 0;
  }

  /** Reset daily token counter. */
  resetDaily(): void {
    console.log(
      `[CostGuard] Daily reset. Tokens used today: ${this.dailyTokens}`,
    );
    this.dailyTokens = 0;
  }

  /** Get current usage stats. */
  getUsage(): {
    hourly: number;
    daily: number;
    consecutiveErrors: number;
  } {
    return {
      hourly: this.hourlyTokens,
      daily: this.dailyTokens,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  /** Dispose timers (for clean shutdown). */
  dispose(): void {
    if (this.hourlyResetTimer) clearInterval(this.hourlyResetTimer);
    if (this.dailyResetTimer) clearInterval(this.dailyResetTimer);
  }
}

// ---------------------------------------------------------------------------
// Network Egress Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an outbound URL targets an allowed domain.
 * Returns true only if the URL's hostname matches ALLOWED_EGRESS_DOMAINS.
 */
export function validateEgressUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Exact match
    if (ALLOWED_EGRESS_DOMAINS.has(hostname)) {
      return true;
    }

    // Subdomain match (e.g., "sheets.googleapis.com" matches "googleapis.com")
    for (const domain of ALLOWED_EGRESS_DOMAINS) {
      if (hostname.endsWith(`.${domain}`)) {
        return true;
      }
    }

    console.error(`[interceptor] Egress blocked: ${hostname} not in allowed domains`);
    return false;
  } catch {
    console.error(`[interceptor] Egress blocked: invalid URL "${url}"`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shell Command Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a shell command does not contain blocked network commands.
 * Returns true if the command is safe, false if it contains blocked patterns.
 */
export function validateShellCommand(cmd: string): boolean {
  if (BLOCKED_NETWORK_COMMANDS.test(cmd)) {
    console.error(
      `[interceptor] Shell command blocked: contains network command pattern`,
    );
    return false;
  }

  return true;
}
