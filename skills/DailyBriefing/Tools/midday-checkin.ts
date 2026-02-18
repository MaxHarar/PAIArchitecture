#!/usr/bin/env bun
/**
 * Midday Check-in Daemon
 *
 * Sends a midday check-in between 12-2 PM to course-correct the afternoon.
 * Polls every 5 minutes and sends once per day when first polled in window.
 *
 * @module midday-checkin
 *
 * Usage:
 *   bun run midday-checkin.ts              # Normal operation (poll via launchd)
 *   bun run midday-checkin.ts --test       # Preview mode
 *   bun run midday-checkin.ts --status     # Show current state
 *   bun run midday-checkin.ts --reset      # Clear state
 *   bun run midday-checkin.ts --force      # Send regardless of conditions
 *   bun run midday-checkin.ts --dry-run    # Execute without sending
 *   bun run midday-checkin.ts --debug      # Verbose logging
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'fs';
import { homedir } from 'os';
import { dirname } from 'path';
import { getDatabase } from '../../../fitness/src/db/client.ts';
import { loadConfig as loadTelegramConfig } from '../Config/config-loader.ts';

// ============================================================================
// Types
// ============================================================================

interface MiddayState {
  date: string;
  checkinSent: boolean;
  checkinSentAt: string | null;
  lastPollTime: string | null;
}

interface MiddayConfig {
  windowStartHour: number;
  windowEndHour: number;
}

interface CliArgs {
  test: boolean;
  dryRun: boolean;
  force: boolean;
  status: boolean;
  reset: boolean;
  debug: boolean;
}

interface GarminData {
  recoveryScore: number;
  bodyBattery: number;
  hrv: number;
  restingHR: number;
}

interface CalendarEvent {
  time: string;
  name: string;
  status: 'completed' | 'in_progress' | 'upcoming';
}

// ============================================================================
// Paths & Configuration
// ============================================================================

const SKILL_DIR = `${homedir()}/.claude/skills/DailyBriefing`;
const STATE_PATH = `${SKILL_DIR}/State/midday-state.json`;
const LOG_FILE_PATH = `${SKILL_DIR}/State/midday-checkin.log`;
const CONFIG_PATH = `${SKILL_DIR}/Config/settings.json`;

const DEFAULT_CONFIG: MiddayConfig = {
  windowStartHour: 12,
  windowEndHour: 14
};

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
  return `[${new Date().toISOString()}] [midday-checkin] ${message}`;
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

function createFreshState(date: string): MiddayState {
  return {
    date,
    checkinSent: false,
    checkinSentAt: null,
    lastPollTime: null
  };
}

function loadState(todayDate: string): MiddayState {
  if (!existsSync(STATE_PATH)) {
    return createFreshState(todayDate);
  }

  try {
    const content = readFileSync(STATE_PATH, 'utf-8');
    const state: MiddayState = JSON.parse(content);

    if (state.date !== todayDate) {
      return createFreshState(todayDate);
    }

    return state;
  } catch {
    return createFreshState(todayDate);
  }
}

function saveState(state: MiddayState): void {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${STATE_PATH}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2));
  renameSync(tempPath, STATE_PATH);
}

// ============================================================================
// Data Collection
// ============================================================================

// DEPRECATED: Removed - now uses config-loader.ts which loads botToken from Keychain
// function loadConfig() - see loadTelegramConfig() imported from ../Config/config-loader.ts

function getGarminData(): GarminData {
  try {
    const db = getDatabase({ readonly: true });
    const today = getTodayDateString();

    const row = db.queryOne<{
      body_battery: number | null;
      recovery_score: number | null;
      hrv_rmssd: number | null;
      resting_heart_rate: number | null;
    }>(
      `SELECT body_battery, recovery_score, hrv_rmssd, resting_heart_rate
       FROM daily_metrics
       WHERE date >= date(?, '-1 day')
       ORDER BY date DESC
       LIMIT 1`,
      [today]
    );

    return {
      recoveryScore: row?.recovery_score || 0,
      bodyBattery: row?.body_battery || 0,
      hrv: row?.hrv_rmssd || 0,
      restingHR: row?.resting_heart_rate || 0
    };
  } catch {
    return { recoveryScore: 0, bodyBattery: 0, hrv: 0, restingHR: 0 };
  }
}

function getMorningRecovery(): number {
  // Get the recovery score from this morning's briefing for delta calculation
  try {
    const wakeStatePath = `${SKILL_DIR}/State/wake-state.json`;
    if (!existsSync(wakeStatePath)) return 0;

    const wakeState = JSON.parse(readFileSync(wakeStatePath, 'utf-8'));
    // We would need to store morning recovery in wake state
    // For now, approximate with current data
    return 0;
  } catch {
    return 0;
  }
}

function getCalendarStatus(): CalendarEvent[] {
  try {
    const todayStr = execSync(`date +%Y-%m-%d`, { encoding: 'utf-8' }).trim();
    const tomorrowStr = execSync(`date -v+1d +%Y-%m-%d`, { encoding: 'utf-8' }).trim();

    const result = execSync(
      `gcalcli agenda ${todayStr} ${tomorrowStr} --tsv 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    const events: CalendarEvent[] = [];
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    for (const line of result.trim().split('\n')) {
      if (line.startsWith('start_date')) continue;

      const parts = line.split('\t');
      if (parts.length >= 5) {
        const startTime = parts[1] || '';
        const title = parts[4] || '';

        if (startTime && title) {
          // Skip workout events - they're handled by the WORKOUT section
          const isWorkoutEvent = title.includes('🏃') ||
                                 title.toLowerCase().includes('run') ||
                                 title.toLowerCase().includes('workout') ||
                                 title.toLowerCase().includes('lift') ||
                                 title.toLowerCase().includes('strength') ||
                                 title.toLowerCase().includes('cardio') ||
                                 title.toLowerCase().includes('training');

          if (isWorkoutEvent) {
            continue; // Skip workout events
          }

          const [hour, min] = startTime.split(':').map(Number);
          let status: 'completed' | 'in_progress' | 'upcoming' = 'upcoming';

          if (hour < currentHour || (hour === currentHour && min < currentMin)) {
            status = 'completed';
          } else if (hour === currentHour) {
            status = 'in_progress';
          }

          events.push({
            time: startTime.split(':').slice(0, 2).join(':'),
            name: title,
            status
          });
        }
      }
    }

    return events;
  } catch {
    return [];
  }
}

// ============================================================================
// Message Formatting
// ============================================================================

function getRecoveryEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  return '🔴';
}

function formatMiddayCheckin(garmin: GarminData, events: CalendarEvent[]): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // Check today's prescribed workout
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format
  const db = getDatabase({ readonly: true });

  const prescribedWorkout = db.queryOne<{
    id: number;
    name: string;
    actual_workout_id: number | null;
  }>(`
    SELECT id, name, actual_workout_id
    FROM workout_prescriptions
    WHERE scheduled_date = ?
      AND slot IN ('primary', 'double_day_am')
    LIMIT 1
  `, [today]);

  db.close();

  // Categorize events
  const completed = events.filter(e => e.status === 'completed');
  const inProgress = events.filter(e => e.status === 'in_progress');
  const upcoming = events.filter(e => e.status === 'upcoming');

  // Build status section
  let statusSection = '';

  if (completed.length > 0) {
    statusSection += completed.slice(-3).map(e => `✅ Completed: ${e.name}`).join('\n') + '\n';
  }
  if (inProgress.length > 0) {
    statusSection += inProgress.map(e => `🔄 In Progress: ${e.name}`).join('\n') + '\n';
  }

  // Next best action (first upcoming event)
  let nextAction = '';
  if (upcoming.length > 0) {
    const next = upcoming[0];
    nextAction = `→ ${next.time}: ${next.name}`;
  } else {
    nextAction = '→ Clear afternoon - focus on deep work';
  }

  // Training update
  const recoveryEmoji = getRecoveryEmoji(garmin.bodyBattery);
  let trainingUpdate = `${recoveryEmoji} Body Battery: ${garmin.bodyBattery}%`;
  if (garmin.recoveryScore > 0) {
    trainingUpdate += ` | Recovery: ${garmin.recoveryScore}`;
  }

  // Recommendation based on recovery
  let recommendation = '';
  if (garmin.bodyBattery < 40) {
    recommendation = '📋 Consider dropping: Non-critical tasks. Prioritize rest.';
  } else if (garmin.bodyBattery < 60) {
    recommendation = '📋 Consider: Lighter afternoon, defer intensive work.';
  } else {
    recommendation = '📋 Green light for remaining tasks.';
  }

  // Workout status
  let workoutSection = '';
  if (prescribedWorkout) {
    const isComplete = prescribedWorkout.actual_workout_id !== null;

    if (isComplete) {
      workoutSection = `<b>WORKOUT</b>
✅ ${prescribedWorkout.name} - Complete!

`;
    } else {
      const hour = now.getHours();
      let actionPrompt = '';

      if (hour < 14) {
        actionPrompt = '💡 Still time to complete it this afternoon';
      } else if (hour < 17) {
        actionPrompt = '💡 Evening session, or reschedule to tomorrow?';
      } else {
        actionPrompt = '💡 Quick evening session, or move to tomorrow?';
      }

      workoutSection = `<b>WORKOUT</b>
⏳ ${prescribedWorkout.name} - Still pending

${actionPrompt}

`;
    }
  }

  // Quick nudge
  const nudges = [
    '💧 Quick check: Have you hydrated recently?',
    '🚶 Quick check: Time for a movement break?',
    '🧘 Quick check: How\'s your posture right now?',
    '🍎 Quick check: Have you eaten a proper meal?',
    '👁️ Quick check: Give your eyes a screen break.'
  ];
  const randomNudge = nudges[Math.floor(Math.random() * nudges.length)];

  return `<b>MIDDAY CHECK-IN</b>
${dateStr} | ${timeStr}

<b>STATUS</b>
${statusSection || '📋 No tracked events this morning'}

<b>NEXT BEST ACTION</b>
${nextAction}

<b>TRAINING UPDATE</b>
${trainingUpdate}

${recommendation}

${workoutSection}<b>QUICK NUDGE</b>
${randomNudge}`;
}

// ============================================================================
// Telegram
// ============================================================================

async function sendTelegram(message: string): Promise<boolean> {
  const config = loadTelegramConfig();
  const { botToken, chatId, parseMode } = config.telegram;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true
      })
    });

    const result = await response.json() as { ok: boolean };
    return result.ok;
  } catch (error) {
    console.error('Telegram send failed:', error);
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

  console.log('\n=== Midday Check-in Status ===\n');
  console.log(`Date:           ${state.date}`);
  console.log(`Check-in Sent:  ${state.checkinSent ? 'Yes' : 'No'}`);
  console.log(`Sent At:        ${state.checkinSentAt || 'N/A'}`);
  console.log(`Last Poll:      ${state.lastPollTime || 'Never'}`);
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

async function poll(args: CliArgs, config: MiddayConfig = DEFAULT_CONFIG): Promise<number> {
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentHour = now.getHours();

  log(`Starting poll at ${now.toISOString()}`, false, args);

  // Check time window (12-2 PM) - bypass with --test or --force
  if (!args.test && !args.force && (currentHour < config.windowStartHour || currentHour >= config.windowEndHour)) {
    log(`Outside time window (${config.windowStartHour}:00-${config.windowEndHour}:00). Exiting.`, false, args);
    return EXIT_CODES.NOT_TIME_YET;
  }

  // Load state
  let state = loadState(todayDate);
  state.lastPollTime = now.toISOString();

  // Check if already sent
  if (!args.force && state.checkinSent) {
    log('Check-in already sent today. Exiting.', false, args);
    saveState(state);
    return EXIT_CODES.ALREADY_SENT;
  }

  // Collect data
  log('Collecting data...', true, args);
  const garmin = getGarminData();
  const events = getCalendarStatus();

  // Format message
  const message = formatMiddayCheckin(garmin, events);

  if (args.test) {
    console.log('\n=== PREVIEW (not sending) ===\n');
    console.log(message.replace(/<\/?b>/g, '**').replace(/<\/?[^>]+>/g, ''));
    console.log('\n=== END PREVIEW ===\n');
    return EXIT_CODES.SENT;
  }

  if (args.dryRun) {
    log('[DRY-RUN] Would send midday check-in', false, args);
    return EXIT_CODES.SENT;
  }

  // Send
  log('Sending midday check-in...', false, args);
  const success = await sendTelegram(message);

  if (success) {
    state.checkinSent = true;
    state.checkinSentAt = now.toISOString();
    saveState(state);
    log('Midday check-in sent successfully.', false, args);
    return EXIT_CODES.SENT;
  } else {
    log('Failed to send midday check-in.', false, args);
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
