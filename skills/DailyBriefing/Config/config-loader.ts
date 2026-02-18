/**
 * Configuration Loader for DailyBriefing
 *
 * SECURITY: Loads Telegram bot token from macOS Keychain, not plaintext files.
 * This is the ONLY way to access sensitive credentials.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const SKILL_DIR = `${homedir()}/.claude/skills/DailyBriefing`;
const CONFIG_PATH = `${SKILL_DIR}/Config/settings.json`;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  parseMode: string;
}

export interface DailyBriefingConfig {
  telegram: TelegramConfig;
}

/**
 * Retrieve secret from macOS Keychain.
 *
 * SECURITY: This is the ONLY way credentials should be accessed.
 * Never store secrets in plaintext, environment variables, or config files.
 *
 * @param account - Keychain account name (e.g., "telegram-dailybrief")
 * @param service - Keychain service name (default: "com.pai.fitness")
 * @returns Secret string, or empty string if not found
 */
function getKeychainSecret(account: string, service: string = "com.pai.fitness"): string {
  try {
    const result = spawnSync("security", [
      "find-generic-password",
      "-a", account,
      "-s", service,
      "-w", // Output password only
    ], {
      encoding: "utf-8",
      timeout: 5000,
    });

    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }

    // Secret not found in Keychain
    console.error(`[Config] Secret not found in Keychain: account="${account}", service="${service}"`);
    return "";
  } catch (error) {
    console.error(`[Config] Failed to retrieve secret from Keychain:`, error);
    return "";
  }
}

/**
 * Load DailyBriefing configuration.
 *
 * SECURITY: Bot token is ALWAYS loaded from Keychain, never from settings.json.
 * The settings.json file only contains non-sensitive configuration (chatId, parseMode).
 */
export function loadConfig(): DailyBriefingConfig {
  try {
    // Load non-sensitive settings from file
    const settingsContent = readFileSync(CONFIG_PATH, 'utf-8');
    const settings = JSON.parse(settingsContent);

    // Load sensitive credential from Keychain
    const botToken = getKeychainSecret("telegram-dailybrief");

    return {
      telegram: {
        botToken,
        chatId: settings.telegram?.chatId || "",
        parseMode: settings.telegram?.parseMode || "HTML",
      },
    };
  } catch (error) {
    console.error(`[Config] Failed to load configuration:`, error);
    throw new Error(`Configuration load failed: ${error}`);
  }
}
