/**
 * Sentinel Gateway — Secrets Management
 *
 * macOS Keychain integration with in-memory caching.
 * Secrets are stored via the `security` CLI with account "pai-gateway".
 * Fallback to ~/.claude/.env if Keychain is unavailable (development).
 *
 * NEVER log or expose secret values — only key names.
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Cache Configuration
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const EXEC_TIMEOUT_MS = 5_000; // 5 second timeout for security CLI
const KEYCHAIN_ACCOUNT = "pai-gateway";
const ENV_FALLBACK_PATH = join(
  process.env.HOME ?? "/Users/maxharar",
  ".claude",
  ".env",
);

interface CachedSecret {
  value: string;
  cachedAt: number;
}

const cache = new Map<string, CachedSecret>();

// ---------------------------------------------------------------------------
// .env Fallback Parser
// ---------------------------------------------------------------------------

let envCache: Record<string, string> | null = null;

function loadEnvFallback(): Record<string, string> {
  if (envCache) return envCache;

  envCache = {};
  if (!existsSync(ENV_FALLBACK_PATH)) return envCache;

  try {
    const content = readFileSync(ENV_FALLBACK_PATH, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let val = trimmed.slice(eqIndex + 1).trim();

      // Strip surrounding quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      envCache[key] = val;
    }
  } catch {
    console.error("[secrets] Failed to read .env fallback (key names only)");
  }

  return envCache;
}

// ---------------------------------------------------------------------------
// Core Keychain Operations
// ---------------------------------------------------------------------------

/**
 * Read a secret from macOS Keychain.
 * Falls back to .env if Keychain is unavailable.
 * Caches in memory for 1 hour.
 *
 * @throws Error if secret not found in either Keychain or .env
 */
export function getSecret(name: string): string {
  // Check cache first
  const cached = cache.get(name);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  // Try macOS Keychain
  try {
    const result = execSync(
      `security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${name}" -w 2>/dev/null`,
      {
        timeout: EXEC_TIMEOUT_MS,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const value = result.trim();
    if (value) {
      cache.set(name, { value, cachedAt: Date.now() });
      return value;
    }
  } catch {
    // Keychain lookup failed — try .env fallback
    console.error(
      `[secrets] Keychain lookup failed for key "${name}", trying .env fallback`,
    );
  }

  // Fallback to .env
  const env = loadEnvFallback();
  const envValue = env[name];
  if (envValue) {
    cache.set(name, { value: envValue, cachedAt: Date.now() });
    return envValue;
  }

  throw new Error(
    `[secrets] Secret "${name}" not found in Keychain or .env fallback`,
  );
}

/**
 * Check if a secret exists in Keychain (or .env fallback).
 * Does NOT throw — returns false if not found.
 */
export function hasSecret(name: string): boolean {
  try {
    getSecret(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Store a secret in macOS Keychain.
 * Uses -U flag to update if the entry already exists.
 */
export function setSecret(name: string, value: string): void {
  try {
    execSync(
      `security add-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${name}" -w "${value}" -U`,
      {
        timeout: EXEC_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Update cache immediately
    cache.set(name, { value, cachedAt: Date.now() });

    console.log(`[secrets] Stored secret "${name}" in Keychain`);
  } catch (err) {
    console.error(
      `[secrets] Failed to store secret "${name}" in Keychain:`,
      err instanceof Error ? err.message : "unknown error",
    );
    throw new Error(`Failed to store secret "${name}" in Keychain`);
  }
}

/**
 * Force refresh all cached secrets by clearing the cache.
 * Next access will re-read from Keychain.
 */
export function refreshAll(): void {
  const keyNames = Array.from(cache.keys());
  cache.clear();
  envCache = null;
  console.log(
    `[secrets] Cache cleared. Evicted keys: [${keyNames.join(", ")}]`,
  );
}

// ---------------------------------------------------------------------------
// Specific Secret Getters
// ---------------------------------------------------------------------------

/** Gateway shared secret (for local/cron auth) */
export function getGatewaySecret(): string {
  return getSecret("gateway-secret");
}

/** Telegram bot token */
export function getTelegramBotToken(): string {
  return getSecret("telegram-bot-token");
}

/** Telegram chat ID for the owner (Max) */
export function getTelegramChatId(): string {
  return getSecret("telegram-chat-id");
}

/** Anthropic API key */
export function getAnthropicApiKey(): string {
  return getSecret("anthropic-api-key");
}

/** SQLite encryption key */
export function getSqliteKey(): string {
  return getSecret("sqlite-key");
}
