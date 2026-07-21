#!/usr/bin/env bun
/**
 * TelegramClean SessionStart Hook
 *
 * Detects Telegram bot sessions and enables minimal output format.
 * Priority: 1 (runs early in SessionStart)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

interface Settings {
  telegram?: {
    cleanOutput?: boolean;
  };
}

// Detection logic
const isTelegram =
  process.cwd().includes('telegram-bot') ||
  process.env.TELEGRAM_SESSION === 'true';

if (!isTelegram) {
  // Not a Telegram session, exit silently
  process.exit(0);
}

// Load settings
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
let settings: Settings = {};

try {
  const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
  settings = JSON.parse(settingsContent);
} catch (error) {
  // Settings not found or invalid, use defaults
}

// Check if clean output is enabled (default: true)
const cleanOutputEnabled = settings?.telegram?.cleanOutput !== false;

if (!cleanOutputEnabled) {
  // User disabled clean output for Telegram
  process.exit(0);
}

// Set environment flag
process.env.TELEGRAM_CLEAN_OUTPUT = 'true';

// Output system reminder
const reminder = `<system-reminder>
TelegramClean: Telegram session detected. Using minimal output format.

**Output Rules:**
- Skip all algorithm phases (OBSERVE, THINK, PLAN, BUILD, EXECUTE, VERIFY, LEARN)
- Skip ISC tracker tables
- Skip progress bars and emojis
- Skip verbose formatting
- Output ONLY concise responses

**Format for responses:**
- Simple answers: Just the answer, no ceremony
- Complex work: Brief summary + voice line only

This is a Telegram session. Keep responses concise and mobile-friendly.
</system-reminder>`;

console.log(reminder);
process.exit(0);
