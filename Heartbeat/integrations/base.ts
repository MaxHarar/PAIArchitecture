/**
 * Base Integration Class
 *
 * All Heartbeat integrations extend this class.
 * Provides: standard interface, error handling, logging.
 *
 * Pattern: Each integration must implement check(), act(), test().
 * The base class wraps all calls in error handling so a single
 * integration failure never crashes the heartbeat loop.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { existsSync } from "fs";

// Load environment from ~/.claude/.env
const envPath = resolve(process.env.HOME || "~", ".claude", ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntegrationResult {
  success: boolean;
  integration: string;
  timestamp: string;
  data?: unknown;
  error?: string;
}

export interface TestResult {
  integration: string;
  configured: boolean;
  healthy: boolean;
  missing?: string[];
  message: string;
}

export type AutonomyLevel = "AUTONOMOUS" | "ASK_FIRST" | "NEVER";

// ---------------------------------------------------------------------------
// Simple logger (will be replaced when ../logger.ts exists)
// ---------------------------------------------------------------------------

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ""),
};

// ---------------------------------------------------------------------------
// Autonomy stub (will be replaced when ../autonomy.ts exists)
// For ASK_FIRST actions, this gates execution until approval is granted.
// ---------------------------------------------------------------------------

export async function requestApproval(
  integration: string,
  action: string,
  details: string
): Promise<boolean> {
  // In v1, ASK_FIRST actions are blocked by default.
  // The real autonomy framework will replace this with Telegram prompts.
  log.warn(`ASK_FIRST action blocked: ${integration}.${action}`, { details });
  return false;
}

// ---------------------------------------------------------------------------
// Base Class
// ---------------------------------------------------------------------------

export abstract class BaseIntegration {
  abstract readonly name: string;
  abstract readonly requiredEnvKeys: string[];
  enabled: boolean = true;

  /**
   * Check external service for new data/events.
   * Called on every heartbeat tick for enabled integrations.
   */
  abstract check(): Promise<IntegrationResult>;

  /**
   * Perform an action on the external service.
   * Actions with ASK_FIRST autonomy will be gated by requestApproval().
   */
  abstract act(action: string, params: Record<string, unknown>): Promise<IntegrationResult>;

  /**
   * Verify that configuration (API keys, tokens) exists and is valid.
   * Should NOT make real API calls — just validate config presence.
   */
  abstract test(): Promise<TestResult>;

  // -----------------------------------------------------------------------
  // Error-safe wrappers — these are what the heartbeat actually calls
  // -----------------------------------------------------------------------

  async safeCheck(): Promise<IntegrationResult> {
    try {
      if (!this.enabled) {
        return this.skip("disabled");
      }
      return await this.check();
    } catch (err) {
      return this.fail(err);
    }
  }

  async safeAct(action: string, params: Record<string, unknown> = {}): Promise<IntegrationResult> {
    try {
      if (!this.enabled) {
        return this.skip("disabled");
      }
      return await this.act(action, params);
    } catch (err) {
      return this.fail(err);
    }
  }

  async safeTest(): Promise<TestResult> {
    try {
      return await this.test();
    } catch (err) {
      return {
        integration: this.name,
        configured: false,
        healthy: false,
        message: `Test threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Check that all required env keys are present. Returns missing keys. */
  protected checkEnvKeys(): string[] {
    return this.requiredEnvKeys.filter((key) => !process.env[key]);
  }

  /** Get an env value or throw. */
  protected env(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env: ${key}`);
    return val;
  }

  /** Build a success result. */
  protected ok(data?: unknown): IntegrationResult {
    return {
      success: true,
      integration: this.name,
      timestamp: new Date().toISOString(),
      data,
    };
  }

  /** Build a failure result from an error. */
  private fail(err: unknown): IntegrationResult {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`${this.name} integration error`, { error: message });
    return {
      success: false,
      integration: this.name,
      timestamp: new Date().toISOString(),
      error: message,
    };
  }

  /** Build a skipped result. */
  private skip(reason: string): IntegrationResult {
    return {
      success: true,
      integration: this.name,
      timestamp: new Date().toISOString(),
      data: { skipped: true, reason },
    };
  }
}
