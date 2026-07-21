#!/usr/bin/env bun
/**
 * Evening Recap Daemon
 *
 * Sends an evening recap between 8-10 PM to close the day and set up tomorrow.
 * Polls every 5 minutes and sends once per day when first polled in window.
 *
 * Content includes:
 * - Day's wins and misses
 * - Training summary (prescribed vs actual)
 * - Tomorrow's admin items
 * - Draft priorities for tomorrow
 * - Hero reflection question
 *
 * @module evening-recap
 *
 * Usage:
 *   bun run evening-recap.ts              # Normal operation (poll via launchd)
 *   bun run evening-recap.ts --test       # Preview mode
 *   bun run evening-recap.ts --status     # Show current state
 *   bun run evening-recap.ts --reset      # Clear state
 *   bun run evening-recap.ts --force      # Send regardless of conditions
 *   bun run evening-recap.ts --dry-run    # Execute without sending
 *   bun run evening-recap.ts --debug      # Verbose logging
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'fs';
import { homedir } from 'os';
import { dirname } from 'path';
import { getDatabase } from '../../../fitness/src/db/client.ts';
import { getHeroInsight, formatHeroInsightForTelegram, DailyContext } from './HeroInsight.ts';
import { loadConfig as loadTelegramConfig } from '../Config/config-loader.ts';

// ============================================================================
// Types
// ============================================================================

interface EveningState {
  date: string;
  recapSent: boolean;
  recapSentAt: string | null;
  lastPollTime: string | null;
}

interface EveningConfig {
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
  sleepScore: number;
}

interface WorkoutSummary {
  completed: boolean;
  name: string;
  durationMin: number;
  caloriesBurned: number;
  type: string;
}

interface CalendarEvent {
  time: string;
  name: string;
  status: 'completed' | 'missed';
}

// ============================================================================
// Paths & Configuration
// ============================================================================

const SKILL_DIR = `${homedir()}/.claude/skills/DailyBriefing`;
const STATE_PATH = `${SKILL_DIR}/State/evening-state.json`;
const LOG_FILE_PATH = `${SKILL_DIR}/State/evening-recap.log`;
const CONFIG_PATH = `${SKILL_DIR}/Config/settings.json`;
const TELOS_PATH = `${homedir()}/.claude/skills/CORE/USER/TELOS`;

const DEFAULT_CONFIG: EveningConfig = {
  windowStartHour: 20,
  windowEndHour: 22
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
  return `[${new Date().toISOString()}] [evening-recap] ${message}`;
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

function createFreshState(date: string): EveningState {
  return {
    date,
    recapSent: false,
    recapSentAt: null,
    lastPollTime: null
  };
}

function loadState(todayDate: string): EveningState {
  if (!existsSync(STATE_PATH)) {
    return createFreshState(todayDate);
  }

  try {
    const content = readFileSync(STATE_PATH, 'utf-8');
    const state: EveningState = JSON.parse(content);

    if (state.date !== todayDate) {
      return createFreshState(todayDate);
    }

    return state;
  } catch {
    return createFreshState(todayDate);
  }
}

function saveState(state: EveningState): void {
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
      sleep_score: number | null;
    }>(
      `SELECT body_battery, recovery_score, hrv_rmssd, resting_heart_rate, sleep_score
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
      restingHR: row?.resting_heart_rate || 0,
      sleepScore: row?.sleep_score || 0
    };
  } catch {
    return { recoveryScore: 0, bodyBattery: 0, hrv: 0, restingHR: 0, sleepScore: 0 };
  }
}

function getTodaysWorkouts(): WorkoutSummary[] {
  try {
    const db = getDatabase({ readonly: true });
    const today = getTodayDateString();

    const rows = db.query<{
      activity_type_id: number;
      duration_seconds: number;
      calories: number;
    }>(
      `SELECT activity_type_id, duration_seconds, calories
       FROM workouts
       WHERE date(started_at) = ?`,
      [today]
    );

    // Map activity types
    const activityTypes: Record<number, string> = {
      1: 'Running',
      2: 'Cycling',
      3: 'Strength',
      4: 'Yoga',
      5: 'Walking',
      6: 'Swimming'
    };

    return rows.map(row => ({
      completed: true,
      name: activityTypes[row.activity_type_id] || 'Workout',
      durationMin: Math.round(row.duration_seconds / 60),
      caloriesBurned: row.calories,
      type: activityTypes[row.activity_type_id] || 'other'
    }));
  } catch {
    return [];
  }
}

function getTomorrowCalendar(): string[] {
  try {
    const tomorrowStr = execSync(`date -v+1d +%Y-%m-%d`, { encoding: 'utf-8' }).trim();
    const dayAfterStr = execSync(`date -v+2d +%Y-%m-%d`, { encoding: 'utf-8' }).trim();

    const result = execSync(
      `gcalcli agenda ${tomorrowStr} ${dayAfterStr} --tsv 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    const events: string[] = [];

    for (const line of result.trim().split('\n')) {
      if (line.startsWith('start_date')) continue;

      const parts = line.split('\t');
      if (parts.length >= 5) {
        const startTime = parts[1] || '';
        const title = parts[4] || '';

        if (startTime && title) {
          events.push(`${startTime.split(':').slice(0, 2).join(':')} - ${title}`);
        }
      }
    }

    return events.slice(0, 5); // Top 5 events
  } catch {
    return [];
  }
}

function getReflectionQuestions(): string[] {
  // Collection of reflective questions for evening recap
  return [
    "What's one thing you learned today that you want to remember?",
    "What would you do differently if you could redo today?",
    "Who did you help today? Who helped you?",
    "What are you grateful for from today?",
    "What challenged you today and how did you respond?",
    "What's one small win you can celebrate?",
    "What drained your energy today? What restored it?",
    "Did you live according to your values today?",
    "What's one thing you're looking forward to tomorrow?",
    "What's something you avoided today that you should address?"
  ];
}

function getDailyWins(): string[] {
  // This would ideally pull from a tracking system
  // For now, generate based on workout data
  const workouts = getTodaysWorkouts();
  const wins: string[] = [];

  if (workouts.length > 0) {
    for (const w of workouts) {
      wins.push(`Completed ${w.durationMin}min ${w.name}`);
    }
  }

  return wins;
}

// ============================================================================
// Message Formatting
// ============================================================================

function getBedtimeRecommendation(bodyBattery: number): string {
  const now = new Date();
  const hour = now.getHours();

  if (bodyBattery < 30) {
    return '🛏️ Recovery Plan: Consider an early bedtime tonight (before 10 PM)';
  } else if (bodyBattery < 50) {
    return '🛏️ Recovery Plan: Target 7-8 hours sleep tonight';
  } else {
    return '🛏️ Recovery Plan: Standard bedtime, you\'re recovering well';
  }
}

function formatEveningRecap(
  garmin: GarminData,
  workouts: WorkoutSummary[],
  tomorrowEvents: string[],
  heroInsight: string | null
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // Wins section
  const wins = getDailyWins();
  const winsSection = wins.length > 0
    ? wins.map(w => `✅ ${w}`).join('\n')
    : '✅ Made it through the day';

  // Training summary
  let trainingSection = '';
  if (workouts.length > 0) {
    const totalMin = workouts.reduce((sum, w) => sum + w.durationMin, 0);
    const totalCal = workouts.reduce((sum, w) => sum + w.caloriesBurned, 0);
    trainingSection = `🏃 Completed: ${workouts.map(w => w.name).join(', ')}
📊 Total: ${totalMin} min | ${totalCal} cal burned`;
  } else {
    trainingSection = '📋 Rest day - no workouts logged';
  }

  // Bedtime recommendation
  const bedtimeRec = getBedtimeRecommendation(garmin.bodyBattery);

  // Tomorrow's admin
  const adminSection = tomorrowEvents.length > 0
    ? tomorrowEvents.slice(0, 3).map(e => `📋 ${e}`).join('\n')
    : '📋 No scheduled events tomorrow';

  // Draft priorities (simplified)
  const priorities = [
    '1. Complete morning routine',
    '2. Focus on top priority task',
    '3. Movement/workout as scheduled'
  ];

  // Reflection question
  const questions = getReflectionQuestions();
  const randomQuestion = questions[Math.floor(Math.random() * questions.length)];

  let message = `<b>EVENING RECAP</b>
${dateStr} | ${timeStr}

<b>TODAY'S WINS</b>
${winsSection}

<b>TRAINING SUMMARY</b>
${trainingSection}
${bedtimeRec}

<b>TOMORROW'S ADMIN</b>
${adminSection}

<b>DRAFT PRIORITIES</b>
${priorities.join('\n')}

<b>REFLECTION</b>
"${randomQuestion}"`;

  // Add hero insight if available
  if (heroInsight) {
    message += `\n\n${heroInsight}`;
  }

  return message;
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

  console.log('\n=== Evening Recap Status ===\n');
  console.log(`Date:         ${state.date}`);
  console.log(`Recap Sent:   ${state.recapSent ? 'Yes' : 'No'}`);
  console.log(`Sent At:      ${state.recapSentAt || 'N/A'}`);
  console.log(`Last Poll:    ${state.lastPollTime || 'Never'}`);
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

async function poll(args: CliArgs, config: EveningConfig = DEFAULT_CONFIG): Promise<number> {
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentHour = now.getHours();

  log(`Starting poll at ${now.toISOString()}`, false, args);

  // Check time window (8-10 PM) - bypass with --test or --force
  if (!args.test && !args.force && (currentHour < config.windowStartHour || currentHour >= config.windowEndHour)) {
    log(`Outside time window (${config.windowStartHour}:00-${config.windowEndHour}:00). Exiting.`, false, args);
    return EXIT_CODES.NOT_TIME_YET;
  }

  // Load state
  let state = loadState(todayDate);
  state.lastPollTime = now.toISOString();

  // Check if already sent
  if (!args.force && state.recapSent) {
    log('Recap already sent today. Exiting.', false, args);
    saveState(state);
    return EXIT_CODES.ALREADY_SENT;
  }

  // Collect data
  log('Collecting data...', true, args);
  const garmin = getGarminData();
  const workouts = getTodaysWorkouts();
  const tomorrowEvents = getTomorrowCalendar();

  // Get hero insight for evening context
  let heroInsight: string | null = null;
  try {
    const heroContext: DailyContext = {
      recoveryScore: garmin.recoveryScore,
      sleepScore: garmin.sleepScore,
      hasWorkout: workouts.length > 0,
      workoutType: workouts.length > 0 ? workouts[0].type : null,
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' })
    };
    const insight = getHeroInsight(heroContext);
    if (insight) {
      heroInsight = formatHeroInsightForTelegram(insight);
    }
  } catch (error) {
    log(`Hero insight failed: ${error}`, true, args);
  }

  // Format message
  const message = formatEveningRecap(garmin, workouts, tomorrowEvents, heroInsight);

  if (args.test) {
    console.log('\n=== PREVIEW (not sending) ===\n');
    console.log(message.replace(/<\/?b>/g, '**').replace(/<\/?[^>]+>/g, ''));
    console.log('\n=== END PREVIEW ===\n');
    return EXIT_CODES.SENT;
  }

  if (args.dryRun) {
    log('[DRY-RUN] Would send evening recap', false, args);
    return EXIT_CODES.SENT;
  }

  // Send
  log('Sending evening recap...', false, args);
  const success = await sendTelegram(message);

  if (success) {
    state.recapSent = true;
    state.recapSentAt = now.toISOString();
    saveState(state);
    log('Evening recap sent successfully.', false, args);
    return EXIT_CODES.SENT;
  } else {
    log('Failed to send evening recap.', false, args);
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
