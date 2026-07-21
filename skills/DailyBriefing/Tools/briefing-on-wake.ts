#!/usr/bin/env bun
/**
 * Wake-Triggered Daily Briefing
 *
 * Sends the daily briefing 15 minutes after waking up (detected via Garmin sleep data).
 * Falls back to 8am if no wake data is available.
 *
 * @module briefing-on-wake
 * @description Production daemon for wake-triggered briefings with robust error handling.
 *
 * Usage:
 *   bun run briefing-on-wake.ts              # Normal operation (poll via launchd every 5 min)
 *   bun run briefing-on-wake.ts --test       # Preview mode - show what would happen
 *   bun run briefing-on-wake.ts --status     # Show current state
 *   bun run briefing-on-wake.ts --reset      # Clear state (dangerous!)
 *   bun run briefing-on-wake.ts --force      # Send regardless of conditions
 *   bun run briefing-on-wake.ts --dry-run    # Execute without sending
 *   bun run briefing-on-wake.ts --debug      # Verbose logging
 *   bun run briefing-on-wake.ts --test-wake-time "2026-01-28T06:42:00"  # Simulate wake time
 *   bun run briefing-on-wake.ts --test-current-time "2026-01-28T07:00:00" # Simulate current time
 *
 * Launchd setup (every 5 minutes):
 *   See Config/com.pai.dailybriefing.plist
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { getDatabase, closeDatabase } from '../../../fitness/src/db/client.ts';

// ============================================================================
// Types (Enhanced state schema from architecture)
// ============================================================================

/**
 * Enhanced wake state with comprehensive tracking
 * @interface WakeState
 */
export interface WakeState {
  /** Date string (YYYY-MM-DD) for new day detection */
  date: string;
  /** Whether wake time has been detected today */
  wakeDetected: boolean;
  /** ISO timestamp of detected wake time */
  wakeTime: string | null;
  /** ISO timestamp of calculated trigger time (wake + 15min) */
  triggerTime: string | null;
  /** Whether briefing has been sent today */
  briefingSent: boolean;
  /** ISO timestamp when briefing was sent */
  briefingSentAt: string | null;
  /** How the briefing was triggered */
  sendMethod: 'wake-triggered' | 'fallback' | null;
  /** Count of consecutive Garmin API failures */
  garminConsecutiveFailures: number;
  /** Last Garmin error message */
  lastGarminError: string | null;
  /** ISO timestamp of last poll */
  lastPollTime: string | null;

  // Legacy fields for backwards compatibility
  /** @deprecated Use briefingSentAt instead */
  lastSent: string | null;
  /** @deprecated Use wakeTime instead */
  lastWakeTime: string | null;
  /** @deprecated Use triggerTime instead */
  lastTriggerTime: string | null;
}

/**
 * Configuration for wake-triggered briefing
 * @interface WakeConfig
 */
export interface WakeConfig {
  /** Hour to start polling (default: 6) */
  windowStartHour: number;
  /** Hour to stop polling (default: 10) */
  windowEndHour: number;
  /** Fallback hour if no wake data (default: 8) */
  fallbackHour?: number;
  /** Minutes after wake to trigger briefing (default: 15) */
  wakeOffsetMinutes?: number;
  /** Max Garmin failures before forced fallback (default: 6) */
  maxGarminFailures?: number;
}

/**
 * Garmin sleep data structure
 * @interface GarminSleepData
 */
interface GarminSleepData {
  sleep?: {
    sleepEndTimestampLocal?: number | string;
  };
}

/**
 * CLI arguments
 * @interface CliArgs
 */
export interface CliArgs {
  test: boolean;
  dryRun: boolean;
  force: boolean;
  status: boolean;
  reset: boolean;
  debug: boolean;
  testWakeTime: Date | null;
  testCurrentTime: Date | null;
}

// ============================================================================
// Paths
// ============================================================================

const SKILL_DIR = `${homedir()}/.claude/skills/DailyBriefing`;
const WAKE_STATE_PATH = `${SKILL_DIR}/State/wake-state.json`;
const LOG_FILE_PATH = `${SKILL_DIR}/State/wake-briefing.log`;
const BRIEFING_SCRIPT = `${SKILL_DIR}/Tools/briefing.ts`;
const GARMIN_SYNC_SCRIPT = `${homedir()}/.claude/skills/FitnessCoach/Tools/GarminSync.py`;

/** Maximum age of DB data before triggering fresh Garmin fetch (24 hours in ms) */
const DB_STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: WakeConfig = {
  windowStartHour: 6,
  windowEndHour: 10,
  fallbackHour: 8,
  wakeOffsetMinutes: 15,
  maxGarminFailures: 6
};

// ============================================================================
// Exit Codes (from architecture requirements)
// ============================================================================

/**
 * Exit codes for daemon status reporting
 * @constant EXIT_CODES
 */
export const EXIT_CODES = {
  /** Briefing sent successfully */
  SENT: 0,
  /** Not time to send yet (outside window or before trigger) */
  NOT_TIME_YET: 1,
  /** Already sent today */
  ALREADY_SENT: 2,
  /** Error occurred */
  ERROR: 3
} as const;

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Format a log message with timestamp and prefix
 * @param message - The message to format
 * @returns Formatted log string with ISO timestamp
 */
export function formatLogMessage(message: string): string {
  return `[${new Date().toISOString()}] [wake-briefing] ${message}`;
}

/**
 * Log to console and file
 * @param message - Message to log
 * @param debug - Whether to only log in debug mode
 * @param args - CLI args for debug flag check
 */
function log(message: string, debug: boolean, args: CliArgs): void {
  const formatted = formatLogMessage(message);

  // Always log to file
  try {
    const dir = dirname(LOG_FILE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(LOG_FILE_PATH, formatted + '\n');
  } catch {
    // Silently fail file logging
  }

  // Console log based on debug/test flags
  if (args.debug || args.test || args.dryRun) {
    console.log(formatted);
  }
}

// ============================================================================
// State Management Functions
// ============================================================================

/**
 * Create a fresh state for a new day
 * @param date - Date string (YYYY-MM-DD)
 * @returns Fresh WakeState
 */
function createFreshState(date: string): WakeState {
  return {
    date,
    wakeDetected: false,
    wakeTime: null,
    triggerTime: null,
    briefingSent: false,
    briefingSentAt: null,
    sendMethod: null,
    garminConsecutiveFailures: 0,
    lastGarminError: null,
    lastPollTime: null,
    // Legacy fields
    lastSent: null,
    lastWakeTime: null,
    lastTriggerTime: null
  };
}

/**
 * Load state from file, creating fresh state if new day or file missing
 * @param statePath - Path to state file
 * @param todayDate - Today's date string (YYYY-MM-DD)
 * @returns WakeState for today
 */
export function loadState(statePath: string, todayDate: string): WakeState {
  if (!existsSync(statePath)) {
    return createFreshState(todayDate);
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    const state: WakeState = JSON.parse(content);

    // Check for new day - reset if date doesn't match
    if (state.date !== todayDate) {
      return createFreshState(todayDate);
    }

    // Ensure all required fields exist (migration)
    return {
      date: state.date || todayDate,
      wakeDetected: state.wakeDetected ?? false,
      wakeTime: state.wakeTime ?? null,
      triggerTime: state.triggerTime ?? null,
      briefingSent: state.briefingSent ?? false,
      briefingSentAt: state.briefingSentAt ?? null,
      sendMethod: state.sendMethod ?? null,
      garminConsecutiveFailures: state.garminConsecutiveFailures ?? 0,
      lastGarminError: state.lastGarminError ?? null,
      lastPollTime: state.lastPollTime ?? null,
      // Legacy fields
      lastSent: state.lastSent ?? state.briefingSentAt ?? null,
      lastWakeTime: state.lastWakeTime ?? state.wakeTime ?? null,
      lastTriggerTime: state.lastTriggerTime ?? state.triggerTime ?? null
    };
  } catch {
    return createFreshState(todayDate);
  }
}

/**
 * Save state to file atomically (write to temp, then rename)
 * @param statePath - Path to state file
 * @param state - State to save
 */
export function saveState(statePath: string, state: WakeState): void {
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${statePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2));
  renameSync(tempPath, statePath);
}

/**
 * Check if briefing was already sent today (legacy compatibility)
 * @param statePath - Path to state file
 * @returns true if sent today
 */
export function checkAlreadySentToday(statePath: string): boolean {
  if (!existsSync(statePath)) {
    return false;
  }

  try {
    const state: WakeState = JSON.parse(readFileSync(statePath, 'utf-8'));

    // Check new-style briefingSent flag
    if (state.briefingSent && state.date === getTodayDateString()) {
      return true;
    }

    // Check legacy lastSent field
    if (!state.lastSent) {
      return false;
    }

    const lastSentDate = new Date(state.lastSent);
    const today = new Date();

    return (
      lastSentDate.getFullYear() === today.getFullYear() &&
      lastSentDate.getMonth() === today.getMonth() &&
      lastSentDate.getDate() === today.getDate()
    );
  } catch {
    return false;
  }
}

/**
 * Update wake state file (legacy compatibility)
 * @param statePath - Path to state file
 * @param state - Partial state to update
 */
export function updateWakeState(statePath: string, state: WakeState): void {
  saveState(statePath, state);
}

/**
 * Get current wake state (legacy compatibility)
 * @param statePath - Path to state file
 * @returns WakeState or null if not found/invalid
 */
export function getWakeState(statePath: string): WakeState | null {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ============================================================================
// Three Guards for Duplicate Prevention
// ============================================================================

/**
 * Check if briefing should be skipped based on all three guards
 * @param state - Current state
 * @param todayDate - Today's date string
 * @returns true if briefing should be skipped
 */
export function shouldSkipBriefing(state: WakeState, todayDate: string): boolean {
  // Guard 1: briefingSent flag for same day
  if (state.briefingSent && state.date === todayDate) {
    return true;
  }

  // Guard 2: date comparison - different day means fresh start
  if (state.date !== todayDate) {
    return false;
  }

  // Guard 3: briefingSentAt timestamp check
  if (state.briefingSentAt) {
    const sentDate = new Date(state.briefingSentAt).toISOString().split('T')[0];
    if (sentDate === todayDate) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Garmin Error Handling
// ============================================================================

/**
 * Increment Garmin failure counter and record error
 * @param state - Current state
 * @param error - Error message
 * @returns Updated state
 */
export function incrementGarminFailure(state: WakeState, error: string): WakeState {
  return {
    ...state,
    garminConsecutiveFailures: state.garminConsecutiveFailures + 1,
    lastGarminError: error,
    lastPollTime: new Date().toISOString()
  };
}

/**
 * Reset Garmin failure counter on success
 * @param state - Current state
 * @returns Updated state
 */
export function resetGarminFailures(state: WakeState): WakeState {
  return {
    ...state,
    garminConsecutiveFailures: 0,
    lastGarminError: null,
    lastPollTime: new Date().toISOString()
  };
}

/**
 * Check if fallback should be forced due to consecutive Garmin failures
 * @param state - Current state
 * @param config - Configuration
 * @returns true if fallback should be forced
 */
export function shouldForceFallback(state: WakeState, config: WakeConfig): boolean {
  const maxFailures = config.maxGarminFailures ?? 6;
  return state.garminConsecutiveFailures >= maxFailures;
}

// ============================================================================
// Garmin Sleep Data Functions
// ============================================================================

/**
 * Database row structure for daily_metrics
 */
interface DailyMetricsRow {
  date: string;
  sleep_duration_seconds: number | null;
  sleep_end: string | null;
  deep_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  sleep_score: number | null;
  hrv_rmssd: number | null;
  hrv_status: string | null;
  resting_heart_rate: number | null;
  body_battery: number | null;
  recovery_score: number | null;
  raw_data: string | null;
  updated_at: string;
}

/**
 * Result of sleep data fetch with source tracking
 */
export interface SleepDataResult {
  data: GarminSleepData | null;
  source: 'database' | 'garmin_api' | 'fallback';
  stale: boolean;
  fetchTimeMs: number;
}

/**
 * Check if data is stale (older than 24 hours)
 * @param updatedAt - ISO timestamp string
 * @returns true if data is stale
 */
export function isDataStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;

  try {
    const updateTime = new Date(updatedAt).getTime();
    // Check for invalid date (NaN)
    if (isNaN(updateTime)) return true;

    const now = Date.now();
    return (now - updateTime) > DB_STALENESS_THRESHOLD_MS;
  } catch {
    return true;
  }
}

/**
 * Fetch sleep data from fitness database (optimized path)
 * @returns GarminSleepData or null if not found/stale
 */
export function getSleepDataFromDB(): { data: GarminSleepData | null; stale: boolean; updatedAt: string | null } {
  try {
    const db = getDatabase({ readonly: true });
    const today = new Date().toISOString().split('T')[0];

    // Get the most recent sleep data (today or yesterday if today not available yet)
    const row = db.queryOne<DailyMetricsRow>(
      `SELECT date, sleep_duration_seconds, sleep_end, deep_sleep_seconds,
              rem_sleep_seconds, light_sleep_seconds, sleep_score, hrv_rmssd,
              hrv_status, resting_heart_rate, body_battery, recovery_score,
              raw_data, updated_at
       FROM daily_metrics
       WHERE date >= date(?, '-1 day')
       ORDER BY date DESC
       LIMIT 1`,
      [today]
    );

    if (!row) {
      return { data: null, stale: true, updatedAt: null };
    }

    // Extract wake timestamp from raw_data JSON
    let wakeTimestamp: number | null = null;
    if (row.raw_data) {
      try {
        const rawData = JSON.parse(row.raw_data);
        wakeTimestamp = rawData?.sleep?.dailySleepDTO?.sleepEndTimestampLocal || null;
      } catch {
        // Failed to parse raw_data, will use null
      }
    }

    const stale = isDataStale(row.updated_at);

    // Convert to GarminSleepData format
    const data: GarminSleepData = {
      sleep: {
        sleepEndTimestampLocal: wakeTimestamp || undefined
      }
    };

    return { data, stale, updatedAt: row.updated_at };
  } catch (error) {
    if (process.env.DEBUG) {
      console.error('[DEBUG] Fitness DB read failed:', error);
    }
    return { data: null, stale: true, updatedAt: null };
  }
}

/**
 * Fetch sleep data from Garmin via GarminSync.py (fallback path)
 * @returns GarminSleepData or null on error
 */
export function getSleepDataFromGarmin(): GarminSleepData | null {
  try {
    const result = execSync(`python3 ${GARMIN_SYNC_SCRIPT} --days 7 --output json`, {
      encoding: 'utf-8',
      timeout: 30000
    });

    return JSON.parse(result);
  } catch (error) {
    if (process.env.DEBUG) {
      console.error('[DEBUG] Garmin data fetch failed:', error);
    }
    return null;
  }
}

/**
 * Fetch sleep data with DB-first strategy
 *
 * Optimization: Read from fitness DB first (fast, ~10ms)
 * Fallback: Call GarminSync.py if DB data is stale or missing (slow, ~3-5s)
 *
 * @returns SleepDataResult with data, source, and timing info
 */
export function getSleepDataWithFallback(): SleepDataResult {
  const startTime = Date.now();

  // Try database first (fast path)
  const dbResult = getSleepDataFromDB();

  if (dbResult.data && !dbResult.stale) {
    // Database has fresh data - use it
    return {
      data: dbResult.data,
      source: 'database',
      stale: false,
      fetchTimeMs: Date.now() - startTime
    };
  }

  // Database data is missing or stale - fall back to Garmin API
  if (process.env.DEBUG) {
    console.log(`[DEBUG] DB data ${dbResult.data ? 'stale' : 'missing'}, fetching from Garmin API...`);
  }

  const garminData = getSleepDataFromGarmin();

  if (garminData) {
    return {
      data: garminData,
      source: 'garmin_api',
      stale: false,
      fetchTimeMs: Date.now() - startTime
    };
  }

  // Both failed - return stale DB data if available, otherwise null
  return {
    data: dbResult.data,
    source: 'fallback',
    stale: true,
    fetchTimeMs: Date.now() - startTime
  };
}

/**
 * Fetch sleep data from Garmin (legacy function, uses DB-first strategy)
 * @returns GarminSleepData or null on error
 * @deprecated Use getSleepDataWithFallback() for better diagnostics
 */
export function getSleepData(): GarminSleepData | null {
  const result = getSleepDataWithFallback();
  return result.data;
}

/**
 * Parse wake time from Garmin sleep data
 * @param garminData - Data from GarminSync.py
 * @returns Wake time as Date, or null if not available
 */
export function parseWakeTime(garminData: GarminSleepData | null): Date | null {
  if (!garminData?.sleep?.sleepEndTimestampLocal) {
    return null;
  }

  const timestamp = garminData.sleep.sleepEndTimestampLocal;

  if (typeof timestamp === 'number') {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

// ============================================================================
// Time Calculation Functions
// ============================================================================

/**
 * Get today's date as YYYY-MM-DD string
 * @returns Date string
 */
function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calculate trigger time (wake time + offset)
 * @param wakeTime - Detected wake time
 * @param offsetMinutes - Minutes to add (default 15)
 * @returns Trigger time
 */
export function calculateTriggerTime(wakeTime: Date, offsetMinutes: number): Date {
  const trigger = new Date(wakeTime.getTime());
  trigger.setMinutes(trigger.getMinutes() + offsetMinutes);
  return trigger;
}

/**
 * Check if current time is at or past trigger time
 * @param triggerTime - Calculated trigger time
 * @param currentTime - Current time
 * @returns true if should trigger
 */
export function shouldTriggerBriefing(triggerTime: Date, currentTime: Date): boolean {
  return currentTime.getTime() >= triggerTime.getTime();
}

/**
 * Check if time is within polling window
 * @param time - Time to check
 * @param config - Configuration with window hours
 * @returns true if within window
 */
export function isWithinTimeWindow(time: Date, config: WakeConfig): boolean {
  const hour = time.getHours();
  return hour >= config.windowStartHour && hour < config.windowEndHour;
}

// ============================================================================
// Briefing Execution
// ============================================================================

/**
 * Execute the main briefing script
 * @param dryRun - If true, don't actually execute
 * @param test - If true, run in test mode
 * @returns true on success
 */
function executeBriefing(dryRun: boolean, test: boolean): boolean {
  if (dryRun) {
    console.log('[DRY-RUN] Would execute: bun', BRIEFING_SCRIPT);
    return true;
  }

  try {
    const testFlag = test ? ' --test' : '';
    execSync(`bun ${BRIEFING_SCRIPT}${testFlag}`, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'inherit'
    });
    return true;
  } catch (error) {
    console.error('[ERROR] Briefing execution failed:', error);
    return false;
  }
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

/**
 * Parse command line arguments
 * @param argv - Process arguments (without node/bun and script path)
 * @returns Parsed CliArgs
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    test: false,
    dryRun: false,
    force: false,
    status: false,
    reset: false,
    debug: process.env.DEBUG === '1',
    testWakeTime: null,
    testCurrentTime: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--test':
        args.test = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--status':
        args.status = true;
        break;
      case '--reset':
        args.reset = true;
        break;
      case '--debug':
        args.debug = true;
        break;
      case '--test-wake-time':
        if (argv[i + 1]) {
          const date = new Date(argv[i + 1]);
          if (!isNaN(date.getTime())) {
            args.testWakeTime = date;
          }
          i++;
        }
        break;
      case '--test-current-time':
        if (argv[i + 1]) {
          const date = new Date(argv[i + 1]);
          if (!isNaN(date.getTime())) {
            args.testCurrentTime = date;
          }
          i++;
        }
        break;
    }
  }

  return args;
}

// ============================================================================
// Status Display
// ============================================================================

/**
 * Display current state status
 * @param statePath - Path to state file
 */
function showStatus(statePath: string): void {
  const state = getWakeState(statePath);

  console.log('\n=== Wake-Triggered Briefing Status ===\n');

  if (!state) {
    console.log('No state file found. Briefing not yet triggered today.\n');
    return;
  }

  console.log(`Date:                    ${state.date}`);
  console.log(`Wake Detected:           ${state.wakeDetected ? 'Yes' : 'No'}`);
  console.log(`Wake Time:               ${state.wakeTime || 'Not detected'}`);
  console.log(`Trigger Time:            ${state.triggerTime || 'Not calculated'}`);
  console.log(`Briefing Sent:           ${state.briefingSent ? 'Yes' : 'No'}`);
  console.log(`Sent At:                 ${state.briefingSentAt || 'N/A'}`);
  console.log(`Send Method:             ${state.sendMethod || 'N/A'}`);
  console.log(`Garmin Failures:         ${state.garminConsecutiveFailures}`);
  console.log(`Last Garmin Error:       ${state.lastGarminError || 'None'}`);
  console.log(`Last Poll:               ${state.lastPollTime || 'Never'}`);
  console.log('');
}

/**
 * Reset state (clear state file)
 * @param statePath - Path to state file
 */
function resetState(statePath: string): void {
  if (existsSync(statePath)) {
    const backup = `${statePath}.backup.${Date.now()}`;
    renameSync(statePath, backup);
    console.log(`State reset. Backup saved to: ${backup}`);
  } else {
    console.log('No state file to reset.');
  }
}

// ============================================================================
// Poll Function (Main Orchestration)
// ============================================================================

/**
 * Main polling function - orchestrates the entire wake-triggered briefing flow
 * @param args - CLI arguments
 * @param config - Configuration
 * @returns Exit code
 */
export async function poll(args: CliArgs, config: WakeConfig = DEFAULT_CONFIG): Promise<number> {
  const now = args.testCurrentTime || new Date();
  const todayDate = now.toISOString().split('T')[0];

  log(`Starting poll at ${now.toISOString()}`, false, args);

  // Step 1: Check time window (6am-10am)
  if (!isWithinTimeWindow(now, config)) {
    log(`Outside time window (${config.windowStartHour}:00-${config.windowEndHour}:00). Exiting.`, false, args);
    return EXIT_CODES.NOT_TIME_YET;
  }

  // Step 2: Load state (creates fresh state on new day)
  let state = loadState(WAKE_STATE_PATH, todayDate);
  log(`Loaded state for ${todayDate}`, true, args);

  // Step 3: Check if already sent today (three guards)
  if (!args.force && shouldSkipBriefing(state, todayDate)) {
    log('Briefing already sent today. Exiting.', false, args);
    return EXIT_CODES.ALREADY_SENT;
  }

  // Step 4: Get wake time (from test arg or Garmin)
  let wakeTime: Date | null = null;
  let garminError: string | null = null;

  if (args.testWakeTime) {
    wakeTime = args.testWakeTime;
    log(`Using test wake time: ${wakeTime.toISOString()}`, true, args);
    state = resetGarminFailures(state);
  } else {
    log('Fetching sleep data (DB-first strategy)...', true, args);
    const sleepResult = getSleepDataWithFallback();
    log(`Data source: ${sleepResult.source} (${sleepResult.fetchTimeMs}ms)`, true, args);

    if (sleepResult.data) {
      wakeTime = parseWakeTime(sleepResult.data);
      if (wakeTime) {
        log(`Detected wake time: ${wakeTime.toISOString()}`, true, args);
        state = resetGarminFailures(state);
        state.wakeDetected = true;
        state.wakeTime = wakeTime.toISOString();
        state.lastWakeTime = wakeTime.toISOString();
      } else {
        log('Wake time not available in sleep data.', true, args);
      }
    } else {
      garminError = sleepResult.source === 'fallback' ? 'Both DB and Garmin API failed' : 'Garmin API fetch failed';
      log(`Sleep data fetch failed. Consecutive failures: ${state.garminConsecutiveFailures + 1}`, true, args);
      state = incrementGarminFailure(state, garminError);
    }
  }

  // Step 5: Determine if we should send
  let shouldSend = false;
  let sendMethod: 'wake-triggered' | 'fallback' = 'fallback';
  let triggerTime: Date | null = null;

  if (wakeTime) {
    // Calculate trigger time (wake + offset)
    triggerTime = calculateTriggerTime(wakeTime, config.wakeOffsetMinutes || 15);
    state.triggerTime = triggerTime.toISOString();
    state.lastTriggerTime = triggerTime.toISOString();
    log(`Trigger time: ${triggerTime.toISOString()}`, true, args);

    if (shouldTriggerBriefing(triggerTime, now)) {
      shouldSend = true;
      sendMethod = 'wake-triggered';
      log('Current time is past trigger time. Will send briefing.', true, args);
    } else {
      log(`Not yet time to send. Trigger at ${triggerTime.toLocaleTimeString()}`, true, args);
      saveState(WAKE_STATE_PATH, state);
      return EXIT_CODES.NOT_TIME_YET;
    }
  } else {
    // Fallback logic
    const fallbackHour = config.fallbackHour || 8;
    const forceFallback = shouldForceFallback(state, config);

    if (forceFallback) {
      log(`Forcing fallback due to ${state.garminConsecutiveFailures} consecutive Garmin failures.`, true, args);
      shouldSend = true;
      sendMethod = 'fallback';
    } else if (now.getHours() >= fallbackHour) {
      shouldSend = true;
      sendMethod = 'fallback';
      log(`No wake data and past ${fallbackHour}:00. Using fallback.`, true, args);
    } else {
      log(`No wake data. Waiting for fallback time (${fallbackHour}:00).`, true, args);
      saveState(WAKE_STATE_PATH, state);
      return EXIT_CODES.NOT_TIME_YET;
    }
  }

  // Step 6: Execute briefing if needed
  if (shouldSend) {
    log(`Sending briefing via ${sendMethod}...`, false, args);

    const success = executeBriefing(args.dryRun, args.test);

    if (success && !args.dryRun && !args.test) {
      // Update state on success
      state.briefingSent = true;
      state.briefingSentAt = now.toISOString();
      state.sendMethod = sendMethod;
      state.lastSent = now.toISOString();

      saveState(WAKE_STATE_PATH, state);
      log('State updated successfully.', true, args);
      return EXIT_CODES.SENT;
    } else if (success && (args.dryRun || args.test)) {
      log('Dry run/test completed successfully.', true, args);
      return EXIT_CODES.SENT;
    } else {
      log('Briefing failed - NOT marking as sent.', false, args);
      saveState(WAKE_STATE_PATH, state);
      return EXIT_CODES.ERROR;
    }
  }

  return EXIT_CODES.NOT_TIME_YET;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));

  // Handle --status flag
  if (args.status) {
    showStatus(WAKE_STATE_PATH);
    return EXIT_CODES.SENT;
  }

  // Handle --reset flag
  if (args.reset) {
    resetState(WAKE_STATE_PATH);
    return EXIT_CODES.SENT;
  }

  // Run poll
  return poll(args);
}

// Run if executed directly
if (import.meta.main) {
  main()
    .then((exitCode) => process.exit(exitCode))
    .catch((err) => {
      console.error('[ERROR]', err);
      process.exit(EXIT_CODES.ERROR);
    });
}
