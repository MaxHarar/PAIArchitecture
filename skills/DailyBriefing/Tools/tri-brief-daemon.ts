#!/usr/bin/env bun
/**
 * Tri-Brief Daemon
 *
 * Unified daemon that manages all three daily touchpoints:
 * - Morning Brief (6-10 AM, wake-triggered)
 * - Midday Check-in (12-2 PM)
 * - Evening Recap (8-10 PM)
 *
 * This daemon polls every 5 minutes and determines which briefing
 * to send based on the current time window. It maintains separate
 * state for each briefing type to prevent duplicates.
 *
 * @module tri-brief-daemon
 *
 * Usage:
 *   bun run tri-brief-daemon.ts              # Normal operation
 *   bun run tri-brief-daemon.ts --test       # Preview mode
 *   bun run tri-brief-daemon.ts --status     # Show all states
 *   bun run tri-brief-daemon.ts --reset      # Clear all states
 *   bun run tri-brief-daemon.ts --force      # Force send current window
 *   bun run tri-brief-daemon.ts --debug      # Verbose logging
 */

import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

// ============================================================================
// Types
// ============================================================================

type BriefType = 'morning' | 'midday' | 'evening';

interface TriBriefState {
  date: string;
  morning: {
    sent: boolean;
    sentAt: string | null;
    method: 'wake-triggered' | 'fallback' | null;
  };
  midday: {
    sent: boolean;
    sentAt: string | null;
  };
  evening: {
    sent: boolean;
    sentAt: string | null;
  };
  lastPollTime: string | null;
}

interface TimeWindow {
  type: BriefType;
  startHour: number;
  endHour: number;
  script: string;
}

interface CliArgs {
  test: boolean;
  dryRun: boolean;
  force: boolean;
  status: boolean;
  reset: boolean;
  debug: boolean;
}

// ============================================================================
// Paths & Configuration
// ============================================================================

const SKILL_DIR = `${homedir()}/.claude/skills/DailyBriefing`;
const STATE_PATH = `${SKILL_DIR}/State/tri-brief-state.json`;
const LOG_FILE_PATH = `${SKILL_DIR}/State/tri-brief.log`;

const TIME_WINDOWS: TimeWindow[] = [
  {
    type: 'morning',
    startHour: 6,
    endHour: 10,
    script: `${SKILL_DIR}/Tools/briefing-on-wake.ts`
  },
  {
    type: 'midday',
    startHour: 12,
    endHour: 14,
    script: `${SKILL_DIR}/Tools/midday-checkin.ts`
  },
  {
    type: 'evening',
    startHour: 20,
    endHour: 22,
    script: `${SKILL_DIR}/Tools/evening-recap.ts`
  }
];

// ============================================================================
// Exit Codes
// ============================================================================

const EXIT_CODES = {
  SENT: 0,
  NOT_TIME_YET: 1,
  ALREADY_SENT: 2,
  ERROR: 3
} as const;

// ============================================================================
// Logging
// ============================================================================

function formatLogMessage(message: string): string {
  return `[${new Date().toISOString()}] [tri-brief] ${message}`;
}

function log(message: string, debug: boolean, args: CliArgs): void {
  const formatted = formatLogMessage(message);

  try {
    const dir = dirname(LOG_FILE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(LOG_FILE_PATH, formatted + '\n');
  } catch {
    // Silent fail
  }

  if (args.debug || args.test || args.dryRun) {
    console.log(formatted);
  }
}

// ============================================================================
// State Management
// ============================================================================

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

function createFreshState(date: string): TriBriefState {
  return {
    date,
    morning: { sent: false, sentAt: null, method: null },
    midday: { sent: false, sentAt: null },
    evening: { sent: false, sentAt: null },
    lastPollTime: null
  };
}

function loadState(todayDate: string): TriBriefState {
  if (!existsSync(STATE_PATH)) {
    return createFreshState(todayDate);
  }

  try {
    const content = readFileSync(STATE_PATH, 'utf-8');
    const state: TriBriefState = JSON.parse(content);

    if (state.date !== todayDate) {
      return createFreshState(todayDate);
    }

    // Ensure all fields exist (migration)
    return {
      date: state.date,
      morning: state.morning || { sent: false, sentAt: null, method: null },
      midday: state.midday || { sent: false, sentAt: null },
      evening: state.evening || { sent: false, sentAt: null },
      lastPollTime: state.lastPollTime || null
    };
  } catch {
    return createFreshState(todayDate);
  }
}

function saveState(state: TriBriefState): void {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${STATE_PATH}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2));
  renameSync(tempPath, STATE_PATH);
}

// ============================================================================
// Window Detection
// ============================================================================

function getCurrentWindow(hour: number): TimeWindow | null {
  for (const window of TIME_WINDOWS) {
    if (hour >= window.startHour && hour < window.endHour) {
      return window;
    }
  }
  return null;
}

function isBriefSent(state: TriBriefState, type: BriefType): boolean {
  return state[type].sent;
}

function markBriefSent(state: TriBriefState, type: BriefType, method?: 'wake-triggered' | 'fallback'): TriBriefState {
  const now = new Date().toISOString();

  if (type === 'morning') {
    state.morning = {
      sent: true,
      sentAt: now,
      method: method || 'fallback'
    };
  } else if (type === 'midday') {
    state.midday = {
      sent: true,
      sentAt: now
    };
  } else {
    state.evening = {
      sent: true,
      sentAt: now
    };
  }

  return state;
}

// ============================================================================
// Brief Execution
// ============================================================================

async function executeBrief(window: TimeWindow, args: CliArgs): Promise<boolean> {
  if (args.dryRun) {
    log(`[DRY-RUN] Would execute: bun ${window.script}`, false, args);
    return true;
  }

  try {
    const flags: string[] = [];
    if (args.test) flags.push('--test');
    if (args.force) flags.push('--force');
    if (args.debug) flags.push('--debug');

    const command = `bun ${window.script} ${flags.join(' ')}`;
    log(`Executing: ${command}`, true, args);

    execSync(command, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: args.debug ? 'inherit' : 'pipe'
    });

    return true;
  } catch (error) {
    log(`Execution failed: ${error}`, false, args);
    return false;
  }
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseCliArgs(argv: string[]): CliArgs {
  return {
    test: argv.includes('--test'),
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    status: argv.includes('--status'),
    reset: argv.includes('--reset'),
    debug: argv.includes('--debug') || process.env.DEBUG === '1'
  };
}

function showStatus(): void {
  const todayDate = getTodayDateString();
  const state = loadState(todayDate);
  const now = new Date();
  const currentHour = now.getHours();
  const currentWindow = getCurrentWindow(currentHour);

  console.log('\n=== Tri-Brief Daemon Status ===\n');
  console.log(`Date:           ${state.date}`);
  console.log(`Current Time:   ${now.toLocaleTimeString()}`);
  console.log(`Current Window: ${currentWindow?.type || 'None (outside briefing hours)'}`);
  console.log(`Last Poll:      ${state.lastPollTime || 'Never'}`);
  console.log('');
  console.log('Briefing Status:');
  console.log(`  Morning (6-10 AM):   ${state.morning.sent ? `✅ Sent at ${state.morning.sentAt} (${state.morning.method})` : '⏳ Pending'}`);
  console.log(`  Midday (12-2 PM):    ${state.midday.sent ? `✅ Sent at ${state.midday.sentAt}` : '⏳ Pending'}`);
  console.log(`  Evening (8-10 PM):   ${state.evening.sent ? `✅ Sent at ${state.evening.sentAt}` : '⏳ Pending'}`);
  console.log('');
}

function resetState(): void {
  if (existsSync(STATE_PATH)) {
    const backup = `${STATE_PATH}.backup.${Date.now()}`;
    renameSync(STATE_PATH, backup);
    console.log(`State reset. Backup: ${backup}`);
  } else {
    console.log('No state file to reset.');
  }
}

// ============================================================================
// Main Poll Function
// ============================================================================

async function poll(args: CliArgs): Promise<number> {
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentHour = now.getHours();

  log(`Starting poll at ${now.toISOString()}`, false, args);

  // Determine current window
  const window = getCurrentWindow(currentHour);

  if (!window) {
    log(`Outside briefing windows. Current hour: ${currentHour}`, false, args);
    return EXIT_CODES.NOT_TIME_YET;
  }

  log(`Current window: ${window.type} (${window.startHour}:00-${window.endHour}:00)`, true, args);

  // Load state
  let state = loadState(todayDate);
  state.lastPollTime = now.toISOString();

  // Check if already sent
  if (!args.force && isBriefSent(state, window.type)) {
    log(`${window.type} brief already sent today. Exiting.`, false, args);
    saveState(state);
    return EXIT_CODES.ALREADY_SENT;
  }

  // Execute the appropriate brief
  log(`Executing ${window.type} brief...`, false, args);
  const success = await executeBrief(window, args);

  if (success && !args.test) {
    state = markBriefSent(state, window.type);
    saveState(state);
    log(`${window.type} brief completed successfully.`, false, args);
    return EXIT_CODES.SENT;
  } else if (args.test) {
    log(`${window.type} brief preview completed.`, false, args);
    return EXIT_CODES.SENT;
  } else {
    log(`${window.type} brief failed.`, false, args);
    saveState(state);
    return EXIT_CODES.ERROR;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.status) {
    showStatus();
    return EXIT_CODES.SENT;
  }

  if (args.reset) {
    resetState();
    return EXIT_CODES.SENT;
  }

  return poll(args);
}

if (import.meta.main) {
  main()
    .then((exitCode) => process.exit(exitCode))
    .catch((err) => {
      console.error('[ERROR]', err);
      process.exit(EXIT_CODES.ERROR);
    });
}
