/**
 * Sentinel Gateway -- SQLite State Persistence
 *
 * Uses Bun's built-in SQLite for zero-dependency persistence.
 * WAL journal mode for concurrent reads during writes.
 * All writes go through a promise-based mutex to prevent contention.
 *
 * Database file is chmod 0o600 on creation (owner-only read/write).
 */

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { GatewayMessage, SessionState } from "./types.ts";

// ---------------------------------------------------------------------------
// Stored Message (includes role + persistence metadata)
// ---------------------------------------------------------------------------

export interface StoredMessage {
  id: number;
  channel: string;
  trust: string;
  content: string;
  role: string;
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Promise-based Mutex
// ---------------------------------------------------------------------------

class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

// ---------------------------------------------------------------------------
// State Manager
// ---------------------------------------------------------------------------

export class StateManager {
  private db: Database;
  private mutex = new Mutex();

  constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const isNew = !existsSync(dbPath);

    this.db = new Database(dbPath);

    // Set pragmas for performance and durability
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    // Create tables
    this.createTables();

    // Secure the database file (owner-only read/write)
    if (isNew) {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        console.warn("[state] Could not chmod database file");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Table Creation
  // -------------------------------------------------------------------------

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        channel TEXT NOT NULL,
        trust TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        timestamp TEXT NOT NULL,
        metadata TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        pid INTEGER NOT NULL DEFAULT 0,
        is_current BOOLEAN NOT NULL DEFAULT 0
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recovery_queue (
        id INTEGER PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_current ON sessions(is_current)
    `);
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async saveMessage(msg: GatewayMessage, role: string): Promise<void> {
    await this.mutex.acquire();
    try {
      const stmt = this.db.prepare(`
        INSERT INTO messages (channel, trust, content, role, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        msg.channel,
        msg.trust,
        msg.content,
        role,
        msg.timestamp,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
      );
    } finally {
      this.mutex.release();
    }
  }

  getMessages(limit = 100, offset = 0): StoredMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, channel, trust, content, role, timestamp, metadata
      FROM messages
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(limit, offset) as Array<{
      id: number;
      channel: string;
      trust: string;
      content: string;
      role: string;
      timestamp: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      trust: row.trust,
      content: row.content,
      role: row.role,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async saveSession(state: SessionState): Promise<void> {
    await this.mutex.acquire();
    try {
      // Clear any existing "current" flag if this one is current
      if (state.sessionId) {
        this.db.exec("UPDATE sessions SET is_current = 0 WHERE is_current = 1");

        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO sessions (id, created_at, last_active_at, message_count, total_tokens, pid, is_current)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `);
        stmt.run(
          state.sessionId,
          new Date(state.createdAt).toISOString(),
          new Date(state.lastActiveAt).toISOString(),
          state.messageCount,
          state.totalTokens,
          state.pid,
        );
      }
    } finally {
      this.mutex.release();
    }
  }

  getCurrentSession(): SessionState | null {
    const stmt = this.db.prepare(`
      SELECT id, created_at, last_active_at, message_count, total_tokens, pid
      FROM sessions
      WHERE is_current = 1
      LIMIT 1
    `);
    const row = stmt.get() as {
      id: string;
      created_at: string;
      last_active_at: string;
      message_count: number;
      total_tokens: number;
      pid: number;
    } | null;

    if (!row) return null;

    return {
      sessionId: row.id,
      createdAt: new Date(row.created_at).getTime(),
      lastActiveAt: new Date(row.last_active_at).getTime(),
      messageCount: row.message_count,
      totalTokens: row.total_tokens,
      isProcessing: false,
      pid: row.pid,
    };
  }

  // -------------------------------------------------------------------------
  // Recovery Queue
  // -------------------------------------------------------------------------

  async queueForRecovery(payload: string): Promise<void> {
    await this.mutex.acquire();
    try {
      const stmt = this.db.prepare(`
        INSERT INTO recovery_queue (payload, created_at)
        VALUES (?, ?)
      `);
      stmt.run(payload, new Date().toISOString());
    } finally {
      this.mutex.release();
    }
  }

  drainRecoveryQueue(): string[] {
    const stmt = this.db.prepare(`
      SELECT id, payload FROM recovery_queue ORDER BY id ASC
    `);
    const rows = stmt.all() as Array<{ id: number; payload: string }>;

    if (rows.length > 0) {
      this.db.exec("DELETE FROM recovery_queue");
      console.log(`[state] Drained ${rows.length} items from recovery queue`);
    }

    return rows.map((r) => r.payload);
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  getConfig(key: string): string | null {
    const stmt = this.db.prepare("SELECT value FROM config WHERE key = ?");
    const row = stmt.get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.mutex.acquire();
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)
      `);
      stmt.run(key, value);
    } finally {
      this.mutex.release();
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    try {
      this.db.close();
      console.log("[state] Database connection closed");
    } catch {
      console.warn("[state] Error closing database connection");
    }
  }
}
