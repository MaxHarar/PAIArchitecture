/**
 * PAI Heartbeat Logger
 *
 * Structured JSONL logging for all heartbeat activity.
 * Each day gets its own log file at ~/Sentinel/Logs/YYYY-MM-DD.jsonl
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogEntry {
  timestamp: string;
  action_type: string;
  details: string;
  outcome: "success" | "failure" | "skipped" | "escalated";
  escalated: boolean;
  integration?: string;
  error?: string;
  mode?: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const LOGS_DIR = join(homedir(), "Sentinel", "Logs");

function ensureLogsDir(): void {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function todayLogPath(): string {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return join(LOGS_DIR, `${today}.jsonl`);
}

// ---------------------------------------------------------------------------
// Core write
// ---------------------------------------------------------------------------

function writeEntry(entry: LogEntry): void {
  ensureLogsDir();
  const line = JSON.stringify(entry) + "\n";
  appendFileSync(todayLogPath(), line, "utf-8");
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Log a successful or skipped action.
 */
export function logAction(
  actionType: string,
  details: string,
  outcome: LogEntry["outcome"] = "success",
  integration?: string,
  mode?: string
): void {
  writeEntry({
    timestamp: new Date().toISOString(),
    action_type: actionType,
    details,
    outcome,
    escalated: false,
    integration,
    mode,
  });
}

/**
 * Log an action that was escalated to Max for approval.
 */
export function logEscalation(
  actionType: string,
  details: string,
  approved: boolean,
  integration?: string
): void {
  writeEntry({
    timestamp: new Date().toISOString(),
    action_type: actionType,
    details,
    outcome: approved ? "success" : "skipped",
    escalated: true,
    integration,
  });
}

/**
 * Log an error that occurred during heartbeat execution.
 */
export function logError(
  actionType: string,
  error: string,
  integration?: string
): void {
  writeEntry({
    timestamp: new Date().toISOString(),
    action_type: actionType,
    details: `Error: ${error}`,
    outcome: "failure",
    escalated: false,
    integration,
    error,
  });
}

/**
 * Read all log entries for today (or a specific date).
 */
export function getDayLog(date?: string): LogEntry[] {
  const dateStr = date || new Date().toISOString().split("T")[0];
  const path = join(LOGS_DIR, `${dateStr}.jsonl`);

  if (!existsSync(path)) return [];

  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as LogEntry);
}

/**
 * Get summary stats for a day's log.
 */
export function getDaySummary(date?: string): {
  total: number;
  successes: number;
  failures: number;
  escalations: number;
  integrations: Record<string, number>;
} {
  const entries = getDayLog(date);
  const integrations: Record<string, number> = {};

  for (const entry of entries) {
    if (entry.integration) {
      integrations[entry.integration] =
        (integrations[entry.integration] || 0) + 1;
    }
  }

  return {
    total: entries.length,
    successes: entries.filter((e) => e.outcome === "success").length,
    failures: entries.filter((e) => e.outcome === "failure").length,
    escalations: entries.filter((e) => e.escalated).length,
    integrations,
  };
}
