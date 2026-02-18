#!/usr/bin/env bun
/**
 * Executive Daily Briefing - Main Orchestrator
 *
 * Aggregates data from Garmin, Calendar, TELOS, and News
 * Sends formatted summary to Telegram
 *
 * Usage:
 *   bun run briefing.ts          # Send real briefing
 *   bun run briefing.ts --test   # Preview without sending
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { getDatabase } from '../../../fitness/src/db/client.ts';
import { getHeroInsight, formatHeroInsightForTelegram, DailyContext, HeroInsight } from './HeroInsight.ts';
import { loadConfig as loadTelegramConfig } from '../Config/config-loader.ts';
import { getDataQualityInfo } from '../../DailyBrief/Bot/sync-coordinator.ts';
import { loadAndFormatTelosGoals } from './TelosParser.ts';
import { isSunday, runSundayPlanning, SundayBriefingData } from './SundayWeeklyPlanner.ts';

const CONFIG_PATH = `${homedir()}/.claude/skills/DailyBriefing/Config/settings.json`;
const STATE_PATH = `${homedir()}/.claude/skills/DailyBriefing/State/last-briefing.json`;
const TELOS_PATH = `${homedir()}/.claude/skills/CORE/USER/TELOS`;

// Calendar health check timeout (10 seconds)
const CALENDAR_HEALTH_TIMEOUT_MS = 10000;

interface Config {
  telegram: { botToken: string; chatId: string; parseMode: string };
  thresholds: { lowSleepHours: number; lowHRV: number; highRecovery: number };
  calendars: { workout: string; running: string };
}

interface GarminData {
  sleepHours: number;
  sleepScore: number;  // Garmin's native sleep score (0-100)
  deepSleepMin: number;
  remSleepMin: number;
  lightSleepMin: number;
  hrv: number;
  hrvStatus: string;
  restingHR: number;
  recoveryScore: number;
  bodyBattery: number;  // Current body battery level
}

interface WorkoutEvent {
  time: string;
  name: string;
  description?: string;
}

interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
}

// TelosGoal interface moved to TelosParser.ts

interface PrescriptionData {
  name: string;
  scheduledTime: string;
  durationMin: number;
  zone: string;
  hrMin: number | null;
  hrMax: number | null;
  reasoning: string;
  readiness: number;
}

interface CalendarHealthStatus {
  healthy: boolean;
  error?: string;
}

// ============================================================================
// Data Collectors
// ============================================================================

function loadConfig(): Config {
  // Load Telegram config from Keychain
  const telegramConfig = loadTelegramConfig();

  // Load other config from settings.json
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const settings = JSON.parse(raw);

  return {
    telegram: telegramConfig.telegram,
    thresholds: settings.thresholds,
    calendars: settings.calendars,
  };
}

function getGarminData(): GarminData {
  try {
    const syncScript = `${homedir()}/.claude/skills/FitnessCoach/Tools/GarminSync.py`;
    // Use --days 7 to ensure we get recent sleep/HRV data (today's data may not be available yet)
    const result = execSync(`python3 ${syncScript} --days 7 --output json`, {
      encoding: 'utf-8',
      timeout: 30000
    });
    const data = JSON.parse(result);

    // Extract sleep data
    const sleep = data.sleep || {};
    const sleepSeconds = sleep.sleepTimeSeconds || 0;
    const deepSeconds = sleep.deepSleepSeconds || 0;
    const remSeconds = sleep.remSleepSeconds || 0;
    const lightSeconds = sleep.lightSleepSeconds || 0;

    // Use Garmin's native sleep score (aligns with FitnessCoach)
    const sleepScore = data.recovery?.sleepScore || 0;

    return {
      sleepHours: sleepSeconds / 3600,
      sleepScore,  // Native Garmin sleep score (0-100)
      deepSleepMin: Math.round(deepSeconds / 60),
      remSleepMin: Math.round(remSeconds / 60),
      lightSleepMin: Math.round(lightSeconds / 60),
      hrv: data.hrv?.lastNightAvg || 50,  // Last night's HRV (more actionable than weekly average)
      hrvStatus: data.hrv?.status || 'Normal',
      restingHR: data.restingHR || 55,
      recoveryScore: data.recovery?.score || 70,
      bodyBattery: data.recovery?.bodyBattery || 0
    };
  } catch (error) {
    if (process.env.DEBUG) console.error('Garmin data fetch failed:', error);
    return {
      sleepHours: 0,
      sleepScore: 0,
      deepSleepMin: 0,
      remSleepMin: 0,
      lightSleepMin: 0,
      hrv: 0,
      hrvStatus: 'Unknown',
      restingHR: 0,
      recoveryScore: 0,
      bodyBattery: 0
    };
  }
}

function getLocalDateString(daysFromNow: number): string {
  // Use shell date command to get correct local date
  const cmd = daysFromNow === 0
    ? `date +%Y-%m-%d`
    : `date -v+${daysFromNow}d +%Y-%m-%d`;
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

/**
 * Pre-flight health check for Google Calendar (gcalcli)
 * Detects OAuth token expiration and other authentication issues.
 * Times out after 10 seconds to prevent hanging.
 *
 * Common errors detected:
 * - "RefreshError" - OAuth token refresh failed
 * - "invalid_grant" - Token expired or revoked
 * - "Token has been expired" - Token needs re-authentication
 *
 * Re-authentication: Run `gcalcli list` in terminal (opens browser)
 */
function checkCalendarHealth(): CalendarHealthStatus {
  try {
    // Use a simple command that requires auth but is fast
    // `gcalcli list` lists calendars - quick way to verify auth
    const result = execSync('gcalcli list 2>&1', {
      encoding: 'utf-8',
      timeout: CALENDAR_HEALTH_TIMEOUT_MS
    });

    // Check for common auth errors in output
    const errorPatterns = [
      'RefreshError',
      'invalid_grant',
      'Token has been expired',
      'Token has been revoked',
      'credentials',
      'Authorization',
      'Traceback'  // Python exception indicator
    ];

    const lowerResult = result.toLowerCase();
    for (const pattern of errorPatterns) {
      if (lowerResult.includes(pattern.toLowerCase())) {
        return {
          healthy: false,
          error: `Calendar auth issue detected: ${pattern}. Re-run: gcalcli list`
        };
      }
    }

    // If we got here without errors, calendar is healthy
    return { healthy: true };
  } catch (error: unknown) {
    // Handle timeout
    if (error && typeof error === 'object' && 'killed' in error && (error as { killed?: boolean }).killed) {
      return {
        healthy: false,
        error: 'Calendar health check timed out after 10s'
      };
    }

    // Handle other exec errors
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check for auth errors in the error message
    if (errorMsg.includes('invalid_grant') ||
        errorMsg.includes('RefreshError') ||
        errorMsg.includes('Token has been expired')) {
      return {
        healthy: false,
        error: `Calendar OAuth expired. Re-run: gcalcli list`
      };
    }

    return {
      healthy: false,
      error: `Calendar check failed: ${errorMsg.substring(0, 100)}`
    };
  }
}

function getCalendarEvents(): WorkoutEvent[] {
  // Pre-flight health check - detect auth issues before attempting fetch
  const healthStatus = checkCalendarHealth();

  if (!healthStatus.healthy) {
    if (process.env.DEBUG) console.error('Calendar health check failed:', healthStatus.error);
    return [{
      time: '—',
      name: 'Calendar unavailable - Re-run: gcalcli list',
      description: healthStatus.error
    }];
  }

  try {
    // Get TODAY's events (morning briefing shows same day's schedule)
    const todayStr = getLocalDateString(0);
    const tomorrowStr = getLocalDateString(1);

    // Get events with descriptions using TSV format (cleaner than default)
    const cmd = `gcalcli agenda ${todayStr} ${tomorrowStr} --tsv --details description 2>/dev/null || true`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });

    const events: WorkoutEvent[] = [];
    const lines = result.trim().split('\n').filter(l => l.trim());

    for (const line of lines) {
      // Skip header line
      if (line.startsWith('start_date')) continue;

      // TSV format: start_date \t start_time \t end_date \t end_time \t title \t description
      const parts = line.split('\t');
      if (parts.length >= 5) {
        const startTime = parts[1] || '';
        const title = parts[4] || '';
        const description = parts[5] || '';

        if (startTime && title) {
          // Format time (remove seconds if present)
          const timeParts = startTime.split(':');
          const formattedTime = timeParts.slice(0, 2).join(':');

          // Convert \n in description to actual newlines
          const cleanDesc = description.replace(/\\n/g, '\n');

          events.push({
            time: formattedTime,
            name: title,
            description: cleanDesc || undefined
          });
        }
      }
    }

    return events.length > 0 ? events : [{ time: '—', name: 'Rest day' }];
  } catch (error) {
    if (process.env.DEBUG) console.error('Calendar fetch failed:', error);
    return [{
      time: '—',
      name: 'Calendar unavailable',
      description: 'Fetch error - try: gcalcli list'
    }];
  }
}

// getTelosGoals moved to TelosParser.ts as loadAndFormatTelosGoals

function getTelosWisdom(): string {
  try {
    const wisdomPath = `${TELOS_PATH}/WISDOM.md`;
    const content = readFileSync(wisdomPath, 'utf-8');

    // Extract personal aphorisms
    const aphorisms: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.match(/^\s*-\s*\*\*"(.+?)"\*\*/);
      if (match) {
        aphorisms.push(match[1]);
      }
    }

    // Return random aphorism
    return aphorisms.length > 0
      ? aphorisms[Math.floor(Math.random() * aphorisms.length)]
      : 'Discipline over motivation.';
  } catch {
    return 'Discipline over motivation.';
  }
}

function getTodaysPrescription(): PrescriptionData | null {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];

    const rx = db.queryOne<{
      name: string;
      scheduled_time: string;
      target_duration_seconds: number;
      intensity_zone: string;
      target_hr_min: number | null;
      target_hr_max: number | null;
      adaptation_reason: string;
      readiness_at_prescription: number;
    }>(
      `SELECT name, scheduled_time, target_duration_seconds, intensity_zone,
              target_hr_min, target_hr_max, adaptation_reason, readiness_at_prescription
       FROM workout_prescriptions
       WHERE scheduled_date = ? AND status IN ('prescribed', 'notified')
       ORDER BY scheduled_time LIMIT 1`,
      [today]
    );

    if (!rx) return null;

    const reason = JSON.parse(rx.adaptation_reason);

    return {
      name: rx.name,
      scheduledTime: rx.scheduled_time,
      durationMin: Math.round(rx.target_duration_seconds / 60),
      zone: rx.intensity_zone.toUpperCase(),
      hrMin: rx.target_hr_min,
      hrMax: rx.target_hr_max,
      reasoning: reason.primary || "Build fitness systematically",
      readiness: rx.readiness_at_prescription
    };
  } catch (error) {
    if (process.env.DEBUG) console.error("Error fetching prescription:", error);
    return null;
  }
}

function getAINews(): NewsItem[] {
  try {
    const newsScript = `${homedir()}/.claude/skills/DailyBriefing/Tools/FetchAINews.ts`;
    const result = execSync(`bun ${newsScript}`, {
      encoding: 'utf-8',
      timeout: 45000
    });

    const stories = JSON.parse(result);
    return stories;
  } catch (error) {
    if (process.env.DEBUG) console.error('AI news fetch failed:', error);
    return [{
      title: 'AI news temporarily unavailable',
      summary: 'Unable to fetch latest AI news',
      url: 'https://www.anthropic.com/news',
      source: 'System'
    }];
  }
}

// ============================================================================
// Health Advisor
// ============================================================================

function getHealthRecommendation(garmin: GarminData, config: Config): string {
  const { lowSleepHours, lowHRV, highRecovery } = config.thresholds;

  if (garmin.sleepHours < lowSleepHours) {
    return `Low sleep (${garmin.sleepHours.toFixed(1)}h). Consider lighter intensity or extra recovery today.`;
  }

  if (garmin.hrv < lowHRV) {
    return `HRV below baseline (${garmin.hrv}ms). Your body may need recovery. Listen to how you feel.`;
  }

  if (garmin.recoveryScore >= highRecovery) {
    return `Recovery is high (${garmin.recoveryScore}%). Green light for scheduled intensity.`;
  }

  if (garmin.recoveryScore >= 60) {
    return `Moderate recovery (${garmin.recoveryScore}%). Proceed with planned workout, monitor how you feel.`;
  }

  return `Lower recovery score (${garmin.recoveryScore}%). Consider active recovery or reduced volume.`;
}

// ============================================================================
// Formatter Helpers
// ============================================================================

function getZoneEmoji(zone: string): string {
  const zoneUpper = zone.toUpperCase();
  if (zoneUpper.includes('Z1')) return '🟢';
  if (zoneUpper.includes('Z2')) return '🔵';
  if (zoneUpper.includes('Z3')) return '🟡';
  if (zoneUpper.includes('Z4')) return '🟠';
  if (zoneUpper.includes('Z5')) return '🔴';
  return '🔵'; // default to Z2
}

function formatScheduledTime(time24: string | null | undefined): string {
  // Handle null/undefined gracefully
  if (!time24) return 'TBD';

  // Convert HH:MM to 12-hour format like "6:00 AM"
  const [hourStr, minStr] = time24.split(':');
  let hour = parseInt(hourStr || '0', 10);
  const min = minStr || '00';
  const ampm = hour >= 12 ? 'PM' : 'AM';

  if (hour > 12) hour -= 12;
  if (hour === 0) hour = 12;

  return `${hour}:${min} ${ampm}`;
}

function truncateReasoning(reasoning: string, maxLen: number = 80): string {
  if (reasoning.length <= maxLen) return reasoning;
  return reasoning.substring(0, maxLen - 3) + '...';
}

// ============================================================================
// Formatter
// ============================================================================

interface DataQualityWarnings {
  garminAvailable: boolean;
  garminAge: number | null;
  stravaAvailable: boolean;
  stravaAge: number | null;
  warnings: string[];
}

/**
 * Check if Sunday planning should run
 * Supports --simulate-sunday for testing
 */
function shouldRunSundayPlanning(): boolean {
  if (process.argv.includes('--simulate-sunday')) {
    return true;
  }
  return isSunday();
}

function formatBriefing(
  garmin: GarminData,
  workouts: WorkoutEvent[],
  telosSection: string,  // Pre-formatted TELOS section from TelosParser
  news: NewsItem[],
  recommendation: string,
  wisdom: string,
  prescription: PrescriptionData | null,
  heroInsight: HeroInsight | null,
  dataQuality: DataQualityWarnings,
  sundayData: SundayBriefingData | null = null
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  // Format data quality warnings if any
  const warningSection = dataQuality.warnings.length > 0
    ? `\n<b>DATA STATUS</b>\n${dataQuality.warnings.map(w => `\u26A0\uFE0F ${w}`).join('\n')}\n`
    : '';

  // Determine health status header based on data availability
  const healthAvailable = garmin.sleepHours > 0 || garmin.hrv > 0 || garmin.recoveryScore > 0;

  const sleepIndicator = garmin.sleepScore >= 80 ? '\uD83D\uDFE2' : garmin.sleepScore >= 60 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
  const hrvIndicator = garmin.hrv >= 50 ? '\uD83D\uDFE2' : garmin.hrv >= 40 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
  const recoveryIndicator = garmin.recoveryScore >= 80 ? '\uD83D\uDFE2' : garmin.recoveryScore >= 60 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
  const bodyBatteryIndicator = garmin.bodyBattery >= 75 ? '\uD83D\uDFE2' : garmin.bodyBattery >= 50 ? '\uD83D\uDFE1' : '\uD83D\uDD34';

  // Health section with graceful degradation
  const healthSection = healthAvailable
    ? `<b>HEALTH STATUS</b>
${sleepIndicator} Sleep: ${garmin.sleepHours.toFixed(1)}h \u2022 Score: ${garmin.sleepScore}/100
   Deep: ${garmin.deepSleepMin}m | REM: ${garmin.remSleepMin}m | Light: ${garmin.lightSleepMin}m
${hrvIndicator} HRV: ${garmin.hrv}ms (${garmin.hrvStatus}) \u2022 Last night
${recoveryIndicator} Recovery: ${garmin.recoveryScore}%
${bodyBatteryIndicator} Body Battery: ${garmin.bodyBattery}/100
   Resting HR: ${garmin.restingHR} bpm`
    : `<b>HEALTH STATUS</b>
\u26A0\uFE0F Health metrics currently unavailable
Check Garmin sync status`;

  return `
<b>GOOD MORNING, MAX</b>
<i>${dateStr} | ${timeStr}</i>
${warningSection}
${healthSection}

<b>RECOMMENDATION</b>
${recommendation}
${prescription ? `

<b>TODAY'S PRESCRIBED WORKOUT</b>
🏃 ${prescription.name}
⏱️ ${prescription.durationMin} min • ${getZoneEmoji(prescription.zone)} ${prescription.zone}${prescription.hrMin && prescription.hrMax ? ` • 🫀 ${prescription.hrMin}-${prescription.hrMax} bpm` : ''}
🕐 ${formatScheduledTime(prescription.scheduledTime)}

💡 WHY: ${truncateReasoning(prescription.reasoning)}
📊 Readiness at prescription: ${prescription.readiness}/100
` : ''}
${heroInsight ? `

${formatHeroInsightForTelegram(heroInsight)}
` : ''}
${sundayData ? `
${sundayData.html}
` : ''}<b>CALENDAR EVENTS</b>
${workouts.map(w => {
  let out = `<b>${w.time}</b> - ${w.name}`;
  if (w.description) {
    out += `\n<i>${w.description}</i>`;
  }
  return out;
}).join('\n\n')}

<b>TOP GOALS (TELOS)</b>
<code>${telosSection}</code>

<b>AI NEWS</b>
${news.map((n, i) => {
  return `${i + 1}. <b>${n.title}</b>
   ${n.summary}
   <a href="${n.url}">Read more →</a>`;
}).join('\n\n')}

<code>════════════════════════════════</code>
<i>"${wisdom}"</i>
<code>════════════════════════════════</code>

Have a great day, Max.
`.trim();
}

// ============================================================================
// Telegram Sender
// ============================================================================

async function sendTelegram(config: Config, message: string): Promise<boolean> {
  const { botToken, chatId, parseMode } = config.telegram;

  if (botToken === 'YOUR_BOT_TOKEN_FROM_BOTFATHER') {
    if (process.env.DEBUG) console.error('Telegram not configured');
    return false;
  }

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

    const result = await response.json();

    if (!result.ok) {
      if (process.env.DEBUG) console.error('Telegram API error:', result.description);
      return false;
    }

    return true;
  } catch (error) {
    if (process.env.DEBUG) console.error('Telegram send failed:', error);
    return false;
  }
}

// ============================================================================
// State Management
// ============================================================================

function updateState(success: boolean): void {
  const state = {
    lastSent: new Date().toISOString(),
    lastStatus: success ? 'success' : 'failed',
    consecutiveFailures: success ? 0 : (getState().consecutiveFailures || 0) + 1
  };
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getState(): { consecutiveFailures: number } {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { consecutiveFailures: 0 };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const isTest = process.argv.includes('--test');

  const isDebug = process.env.DEBUG === '1' || process.argv.includes('--debug');
  if (isDebug) console.log(`[${new Date().toISOString()}] Starting daily briefing...`);

  // Load configuration
  const config = loadConfig();

  // Collect data from all sources
  if (isDebug) console.log('Fetching Garmin data...');
  const garmin = getGarminData();

  if (isDebug) console.log('Fetching calendar events...');
  const workouts = getCalendarEvents();

  if (isDebug) console.log('Loading TELOS goals...');
  const telosSection = loadAndFormatTelosGoals();

  if (isDebug) console.log('Getting news...');
  const news = getAINews();

  if (isDebug) console.log('Getting wisdom...');
  const wisdom = getTelosWisdom();

  if (isDebug) console.log('Fetching prescription...');
  const prescription = getTodaysPrescription();

  // Generate health recommendation
  const recommendation = getHealthRecommendation(garmin, config);

  // Generate hero insight based on context
  if (isDebug) console.log('Generating hero insight...');
  const heroContext: DailyContext = {
    recoveryScore: garmin.recoveryScore,
    sleepScore: garmin.sleepScore,
    hasWorkout: workouts.some(w =>
      w.name.toLowerCase().includes('workout') ||
      w.name.toLowerCase().includes('run') ||
      w.name.toLowerCase().includes('lift') ||
      w.name.toLowerCase().includes('training') ||
      w.name.toLowerCase().includes('gym')
    ),
    workoutType: prescription?.name || null,
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' })
  };
  const heroInsight = getHeroInsight(heroContext);

  // Get data quality info for graceful degradation warnings
  if (isDebug) console.log('Checking data quality...');
  let dataQuality: DataQualityWarnings;
  try {
    dataQuality = getDataQualityInfo();
  } catch {
    // If sync-coordinator isn't available, use safe defaults
    dataQuality = {
      garminAvailable: true,
      garminAge: null,
      stravaAvailable: true,
      stravaAge: null,
      warnings: [],
    };
  }

  // Sunday weekly planning (only runs on Sundays or with --simulate-sunday)
  let sundayData: SundayBriefingData | null = null;
  if (shouldRunSundayPlanning()) {
    if (isDebug) console.log('Running Sunday weekly planning...');
    try {
      sundayData = runSundayPlanning({ test: isTest });
      if (isDebug) {
        console.log(`  Previous week: ${sundayData.previousWeek.completionRate}% completion`);
        console.log(`  Next week focus: ${sundayData.nextWeek.focus}`);
      }
    } catch (error) {
      if (isDebug) console.error('Sunday planning failed:', error);
      // Don't fail the whole briefing if Sunday planning fails
      sundayData = null;
    }
  }

  // Format the briefing
  const message = formatBriefing(garmin, workouts, telosSection, news, recommendation, wisdom, prescription, heroInsight, dataQuality, sundayData);

  if (isTest) {
    console.log('\n--- TEST OUTPUT (not sent) ---\n');
    // Convert HTML to plain text for terminal
    const plainText = message
      .replace(/<b>/g, '')
      .replace(/<\/b>/g, '')
      .replace(/<i>/g, '')
      .replace(/<\/i>/g, '')
      .replace(/<code>/g, '')
      .replace(/<\/code>/g, '');
    console.log(plainText);
    console.log('\n--- END TEST OUTPUT ---\n');
    return;
  }

  // Send to Telegram
  if (isDebug) console.log('Sending to Telegram...');
  const success = await sendTelegram(config, message);

  // Update state
  updateState(success);

  if (success) {
    if (isDebug) console.log('Briefing sent successfully!');
  } else {
    console.error('Failed to send briefing');
    process.exit(1);
  }
}

main().catch(console.error);
