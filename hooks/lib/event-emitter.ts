/**
 * event-emitter.ts - Unified PAI Event Bus
 *
 * PURPOSE:
 * Single JSONL event stream for all PAI lifecycle events. Unlike TraceEmitter
 * (per-task TRACE.jsonl) or observability.ts (HTTP dashboard), this captures
 * system-wide events to MEMORY/STATE/events.jsonl for offline analysis,
 * trend detection, and debugging across sessions.
 *
 * DESIGN:
 * - Fire-and-forget: never throws, never blocks callers
 * - Atomic appendFileSync: consistent with TraceEmitter/VoiceNotification patterns
 * - ISO-8601 timestamps with timezone offset
 * - Small payloads only (no full transcripts or large blobs)
 * - Session-aware via CLAUDE_SESSION_ID or KITTY_SESSION_ID env
 *
 * USAGE:
 *   import { appendEvent } from '../lib/event-emitter';
 *   appendEvent('voice.sent', { message: 'Task complete', charCount: 14 });
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { paiPath } from './paths';
import { getISOTimestamp } from './time';

// ── Event Type Taxonomy ──

export type EventType =
  | 'session.start' | 'session.end' | 'session.named'
  | 'tool.pre' | 'tool.post' | 'tool.blocked'
  | 'algorithm.start' | 'algorithm.phase' | 'algorithm.complete'
  | 'rating.explicit' | 'rating.implicit'
  | 'security.blocked' | 'security.alert'
  | 'voice.sent' | 'voice.failed'
  | 'work.created' | 'work.completed'
  | 'agent.spawned' | 'agent.completed'
  | 'prd.updated' | 'prd.criteria.passed'
  | 'error';

// ── Event Shape ──

export interface PAIEvent {
  timestamp: string;      // ISO-8601 with timezone offset
  type: EventType;
  sessionId?: string;
  data: Record<string, unknown>;
}

// ── Internals ──

const EVENTS_PATH = paiPath('MEMORY', 'STATE', 'events.jsonl');

/** Track whether we've ensured the parent directory exists (once per process) */
let dirEnsured = false;

function ensureDir(): void {
  if (dirEnsured) return;
  try {
    const dir = dirname(EVENTS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    dirEnsured = true;
  } catch {
    // Best-effort: directory may already exist from another process
    dirEnsured = true;
  }
}

/**
 * Resolve the current session ID from environment.
 * Claude Code sets CLAUDE_SESSION_ID; Kitty terminal sets KITTY_SESSION_ID.
 * Returns undefined if neither is available.
 */
function resolveSessionId(): string | undefined {
  return process.env.CLAUDE_SESSION_ID
    || process.env.KITTY_SESSION_ID
    || undefined;
}

// ── Public API ──

/**
 * Append a typed event to the unified JSONL log.
 *
 * Fire-and-forget: swallows all errors so callers are never blocked.
 * Creates the events file if it doesn't exist (appendFileSync handles this).
 *
 * @param type  - Dot-namespaced event type from the EventType union
 * @param data  - Small key-value payload (keep under 1KB)
 * @param sessionIdOverride - Explicit session ID (falls back to env detection)
 */
export function appendEvent(
  type: EventType,
  data: Record<string, unknown>,
  sessionIdOverride?: string,
): void {
  try {
    ensureDir();

    const event: PAIEvent = {
      timestamp: getISOTimestamp(),
      type,
      sessionId: sessionIdOverride || resolveSessionId(),
      data,
    };

    appendFileSync(EVENTS_PATH, JSON.stringify(event) + '\n');
  } catch {
    // Fire-and-forget: never throw, never block
  }
}

/**
 * Convenience: append an error event with standardized shape.
 */
export function appendError(
  source: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  appendEvent('error', {
    source,
    error: error instanceof Error ? error.message : String(error),
    ...context,
  });
}
