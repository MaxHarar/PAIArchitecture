/**
 * Sentinel Gateway — Tamper-Evident Audit Logging
 *
 * Hash-chained JSONL audit logs with:
 *   - SHA-256 hash chaining (each entry includes hash of previous)
 *   - Sensitive pattern scrubbing before writing
 *   - Log rotation (7-day retention)
 *   - File permissions: chmod 0o600
 *   - One JSONL file per day: ~/Sentinel/Logs/audit-YYYY-MM-DD.jsonl
 */

import { createHash } from "crypto";
import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  chmodSync,
  statSync,
} from "fs";
import { join, basename } from "path";

import type { AuditEntry, ChannelId, ChannelTrust } from "./types";

// ---------------------------------------------------------------------------
// Sensitive Pattern Scrubbing
// ---------------------------------------------------------------------------

/**
 * Patterns that must NEVER appear in audit logs.
 * We replace them with redaction markers.
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Anthropic API keys
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, label: "[REDACTED:anthropic-key]" },
  // ElevenLabs keys
  { pattern: /sk_[a-zA-Z0-9]{20,}/g, label: "[REDACTED:elevenlabs-key]" },
  // Google API keys
  { pattern: /AIza[a-zA-Z0-9_-]{30,}/g, label: "[REDACTED:google-key]" },
  // GitHub personal access tokens
  { pattern: /ghp_[a-zA-Z0-9]{30,}/g, label: "[REDACTED:github-pat]" },
  // GitHub OAuth tokens
  { pattern: /gho_[a-zA-Z0-9]{30,}/g, label: "[REDACTED:github-oauth]" },
  // Slack tokens
  { pattern: /xoxb-[a-zA-Z0-9-]{20,}/g, label: "[REDACTED:slack-token]" },
  { pattern: /xoxp-[a-zA-Z0-9-]{20,}/g, label: "[REDACTED:slack-token]" },
  // Telegram bot tokens (digits:alphanumeric)
  { pattern: /\d{8,}:[a-zA-Z0-9_-]{30,}/g, label: "[REDACTED:telegram-token]" },
  // OpenAI keys
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: "[REDACTED:openai-key]" },
  // Generic key=value patterns
  { pattern: /password\s*=\s*\S+/gi, label: "password=[REDACTED]" },
  { pattern: /secret\s*=\s*\S+/gi, label: "secret=[REDACTED]" },
  { pattern: /token\s*=\s*\S+/gi, label: "token=[REDACTED]" },
  { pattern: /api[_-]?key\s*=\s*\S+/gi, label: "apikey=[REDACTED]" },
  // Bearer tokens in headers
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, label: "Bearer [REDACTED]" },
];

/**
 * Scrub all sensitive patterns from a string.
 * Called before any data is written to disk.
 */
function scrubSensitive(text: string): string {
  let scrubbed = text;
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    // Reset lastIndex since these are global regexps
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, label);
  }
  return scrubbed;
}

// ---------------------------------------------------------------------------
// Date Utilities
// ---------------------------------------------------------------------------

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logFileName(date: string): string {
  return `audit-${date}.jsonl`;
}

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------

export class AuditLogger {
  private logDir: string;
  private lastHash: string = "GENESIS"; // Genesis hash for first entry of the day

  constructor(logDir: string) {
    this.logDir = logDir;

    // Ensure log directory exists
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    // Load last hash from today's log if it exists
    this.loadLastHash(todayDateString());

    // Run log rotation on startup
    this.rotateOldLogs();
  }

  /**
   * Write an audit entry with hash chain.
   * Sensitive patterns are scrubbed before writing.
   */
  log(
    entry: Omit<AuditEntry, "hash" | "prevHash" | "timestamp">,
  ): void {
    const timestamp = new Date().toISOString();
    const date = timestamp.slice(0, 10);

    // If the date changed since last write, reset the chain
    const filePath = join(this.logDir, logFileName(date));
    if (!existsSync(filePath)) {
      this.lastHash = "GENESIS";
    }

    // Scrub sensitive data from details
    const scrubbedDetails = scrubSensitive(entry.details);

    // Build the full entry
    const fullEntry: AuditEntry = {
      timestamp,
      eventType: entry.eventType,
      channel: entry.channel,
      trust: entry.trust,
      details: scrubbedDetails,
      outcome: entry.outcome,
      prevHash: this.lastHash,
    };

    // Compute hash of this entry (without the hash field itself)
    const entryHash = createHash("sha256")
      .update(JSON.stringify(fullEntry))
      .digest("hex");

    fullEntry.hash = entryHash;
    this.lastHash = entryHash;

    // Write as JSONL
    const line = JSON.stringify(fullEntry) + "\n";
    appendFileSync(filePath, line, { encoding: "utf-8" });

    // Set restrictive permissions
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // chmod may fail in some environments; non-fatal
    }
  }

  /**
   * Read all audit entries for a given date (defaults to today).
   */
  getEntries(date?: string): AuditEntry[] {
    const d = date ?? todayDateString();
    const filePath = join(this.logDir, logFileName(d));

    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, "utf-8");
    const entries: AuditEntry[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        entries.push(JSON.parse(trimmed) as AuditEntry);
      } catch {
        // Skip malformed lines
        console.error("[audit] Skipping malformed log line");
      }
    }

    return entries;
  }

  /**
   * Verify the hash chain integrity for a given date.
   * Returns valid=true if the chain is unbroken.
   * If tampered, returns the index where the chain broke.
   */
  verifyChain(date?: string): { valid: boolean; brokenAt?: number } {
    const entries = this.getEntries(date);
    if (entries.length === 0) {
      return { valid: true };
    }

    let expectedPrevHash = "GENESIS";

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Verify prevHash chain
      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAt: i };
      }

      // Recompute hash of this entry
      const entryWithoutHash: AuditEntry = {
        ...entry,
        hash: undefined,
      };

      // Remove hash for recomputation (it was not part of the hashed content)
      // The hash was computed on the entry WITHOUT the hash field
      const recomputedEntryForHash: AuditEntry = { ...entry };
      delete recomputedEntryForHash.hash;

      const recomputedHash = createHash("sha256")
        .update(JSON.stringify(recomputedEntryForHash))
        .digest("hex");

      if (entry.hash !== recomputedHash) {
        return { valid: false, brokenAt: i };
      }

      expectedPrevHash = entry.hash!;
    }

    return { valid: true };
  }

  /**
   * Delete log files older than 7 days.
   * Called on startup.
   */
  private rotateOldLogs(): void {
    const RETENTION_DAYS = 7;
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    try {
      const files = readdirSync(this.logDir);

      for (const file of files) {
        if (!file.startsWith("audit-") || !file.endsWith(".jsonl")) continue;

        // Extract date from filename: audit-YYYY-MM-DD.jsonl
        const dateStr = file.slice(6, 16); // "YYYY-MM-DD"
        const fileDate = new Date(dateStr + "T00:00:00Z").getTime();

        if (isNaN(fileDate)) continue;

        if (fileDate < cutoff) {
          const filePath = join(this.logDir, file);
          try {
            unlinkSync(filePath);
            console.log(`[audit] Rotated old log: ${file}`);
          } catch (err) {
            console.error(`[audit] Failed to rotate ${file}:`, err);
          }
        }
      }
    } catch {
      console.error("[audit] Failed to scan log directory for rotation");
    }
  }

  /**
   * Load the last hash from an existing log file to continue the chain.
   */
  private loadLastHash(date: string): void {
    const filePath = join(this.logDir, logFileName(date));

    if (!existsSync(filePath)) {
      this.lastHash = "GENESIS";
      return;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");
      const lastLine = lines[lines.length - 1];

      if (lastLine) {
        const entry = JSON.parse(lastLine) as AuditEntry;
        if (entry.hash) {
          this.lastHash = entry.hash;
          return;
        }
      }
    } catch {
      console.error("[audit] Failed to load last hash from log, resetting chain");
    }

    this.lastHash = "GENESIS";
  }
}
