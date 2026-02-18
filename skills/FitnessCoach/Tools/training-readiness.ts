#!/usr/bin/env bun
/**
 * Training Readiness CLI
 *
 * Reads daily metrics from SQLite database and provides
 * training readiness assessment based on sleep, HRV, body battery,
 * and resting heart rate data.
 *
 * Usage:
 *   bun training-readiness.ts                     # Today's assessment
 *   bun training-readiness.ts --days 7            # Include 7-day trend
 *   bun training-readiness.ts --output json       # JSON output
 *   bun training-readiness.ts --db /path/to.db    # Custom DB path
 */

import { Database } from 'bun:sqlite';
import { parseArgs } from 'util';
import { existsSync } from 'fs';

// Types
export interface DailyMetrics {
  date: string;
  sleep_score?: number;
  sleep_duration_seconds?: number;
  deep_sleep_seconds?: number;
  rem_sleep_seconds?: number;
  hrv_rmssd?: number;
  hrv_status?: string;
  resting_heart_rate?: number;
  body_battery?: number;
  training_readiness?: number;
  recovery_score?: number;
}

export interface ReadinessScore {
  overall: number;  // 0-100
  components: {
    sleep: number;
    hrv: number;
    bodyBattery: number;
    restingHR: number;
    wellness: number;  // NEW: subjective wellness score
  };
  recommendation: 'ready' | 'light' | 'rest';
  concerns: string[];
  dataQuality: 'complete' | 'partial' | 'insufficient';
  reasoning?: string;  // NEW: explanation for recommendation, especially for conflicts
}

export interface ReadinessAssessment {
  date: string;
  readinessScore: ReadinessScore;
  recommendation: string;
  workoutSuggestions: string[];
  trend: 'improving' | 'stable' | 'declining' | 'unknown';
  metricsUsed: number;
  recentMetrics?: DailyMetrics[];
}

// Configuration
const DEFAULT_DB_PATH = `${process.env.HOME}/.claude/fitness/workouts.db`;

// Scoring weights (must sum to 1.0)
// Phase 1.1: Updated weights with wellness integration
const WEIGHTS = {
  sleep: 0.25,       // Was 0.30
  hrv: 0.25,         // Was 0.30
  bodyBattery: 0.20, // Was 0.25
  restingHR: 0.10,   // Was 0.15
  wellness: 0.20,    // NEW
};

// HRV-Wellness conflict threshold (>20 points triggers override)
const CONFLICT_THRESHOLD = 20;

// Wellness data interface
interface WellnessRecord {
  date: string;
  sleep_quality: number;
  muscle_soreness: number;
  stress_level: number;
  mood: number;
  wellness_score: number;
  notes?: string;
}

// Thresholds
const THRESHOLDS = {
  sleep: { excellent: 85, good: 70, fair: 55 },
  hrv: { excellent: 90, good: 70, fair: 50 },  // RMSSD in ms
  bodyBattery: { excellent: 85, good: 60, fair: 40 },
  restingHR: { excellent: 45, good: 50, fair: 55 },  // Lower is better
  sleepDuration: { min: 21600, ideal: 28800 },  // 6-8 hours in seconds
};

/**
 * Get wellness data for a specific date from database
 */
function getWellnessForDate(dbPath: string, date: string): WellnessRecord | null {
  if (!existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Check if wellness table exists
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='daily_wellness'
    `).get();

    if (!tableCheck) {
      db.close();
      return null;
    }

    const stmt = db.prepare(`
      SELECT date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score, notes
      FROM daily_wellness
      WHERE date = ?
    `);

    const result = stmt.get(date) as WellnessRecord | undefined;
    db.close();

    return result || null;
  } catch (error) {
    console.error('Error reading wellness data:', error);
    return null;
  }
}

/**
 * Calculate component score (0-100) from raw value
 */
function scoreComponent(value: number | undefined, thresholds: { excellent: number; good: number; fair: number }, invert = false): number {
  if (value === undefined || value === null) return 0;

  if (invert) {
    // Lower is better (like RHR)
    if (value <= thresholds.excellent) return 100;
    if (value <= thresholds.good) return 80;
    if (value <= thresholds.fair) return 60;
    return Math.max(0, 100 - (value - thresholds.fair) * 3);
  }

  // Higher is better
  if (value >= thresholds.excellent) return 100;
  if (value >= thresholds.good) return 80;
  if (value >= thresholds.fair) return 60;
  return Math.max(0, value / thresholds.fair * 60);
}

/**
 * Calculate overall readiness score from daily metrics
 * @param metrics - Daily metrics from Garmin
 * @param wellnessScore - Optional wellness score from questionnaire (0-100)
 */
export function calculateReadinessScore(
  metrics: DailyMetrics,
  wellnessScore?: number
): ReadinessScore {
  const concerns: string[] = [];
  let availableWeight = 0;
  let weightedSum = 0;
  let reasoning: string | undefined;

  // Sleep score
  const sleepScore = metrics.sleep_score !== undefined
    ? scoreComponent(metrics.sleep_score, THRESHOLDS.sleep)
    : 0;

  if (metrics.sleep_score !== undefined) {
    weightedSum += sleepScore * WEIGHTS.sleep;
    availableWeight += WEIGHTS.sleep;
    if (metrics.sleep_score < THRESHOLDS.sleep.fair) {
      concerns.push('poor_sleep');
    }
  }

  // Check sleep duration
  if (metrics.sleep_duration_seconds !== undefined) {
    if (metrics.sleep_duration_seconds < THRESHOLDS.sleepDuration.min) {
      concerns.push('insufficient_sleep_duration');
    }
  }

  // HRV score
  const hrvScore = metrics.hrv_rmssd !== undefined
    ? scoreComponent(metrics.hrv_rmssd, THRESHOLDS.hrv)
    : 0;

  if (metrics.hrv_rmssd !== undefined) {
    weightedSum += hrvScore * WEIGHTS.hrv;
    availableWeight += WEIGHTS.hrv;
    if (metrics.hrv_status === 'low' || metrics.hrv_status === 'poor') {
      concerns.push('low_hrv');
    }
    if (metrics.hrv_rmssd < THRESHOLDS.hrv.fair) {
      concerns.push('hrv_below_baseline');
    }
  }

  // Body battery score
  const bodyBatteryScore = metrics.body_battery !== undefined
    ? scoreComponent(metrics.body_battery, THRESHOLDS.bodyBattery)
    : 0;

  if (metrics.body_battery !== undefined) {
    weightedSum += bodyBatteryScore * WEIGHTS.bodyBattery;
    availableWeight += WEIGHTS.bodyBattery;
    if (metrics.body_battery < THRESHOLDS.bodyBattery.fair) {
      concerns.push('low_body_battery');
    }
  }

  // Resting HR score (lower is better)
  const rhrScore = metrics.resting_heart_rate !== undefined
    ? scoreComponent(metrics.resting_heart_rate, THRESHOLDS.restingHR, true)
    : 0;

  if (metrics.resting_heart_rate !== undefined) {
    weightedSum += rhrScore * WEIGHTS.restingHR;
    availableWeight += WEIGHTS.restingHR;
    if (metrics.resting_heart_rate > THRESHOLDS.restingHR.fair) {
      concerns.push('elevated_rhr');
    }
  }

  // NEW: Wellness score integration
  const wellnessComponent = wellnessScore !== undefined ? wellnessScore : 0;
  if (wellnessScore !== undefined) {
    weightedSum += wellnessComponent * WEIGHTS.wellness;
    availableWeight += WEIGHTS.wellness;
    if (wellnessScore < 40) {
      concerns.push('low_wellness');
    }
  }

  // Determine data quality
  let dataQuality: 'complete' | 'partial' | 'insufficient';
  if (availableWeight >= 0.9) {
    dataQuality = 'complete';
  } else if (availableWeight >= 0.5) {
    dataQuality = 'partial';
  } else {
    dataQuality = 'insufficient';
  }

  // Calculate overall score (normalized to available data)
  const overall = availableWeight > 0 ? Math.round(weightedSum / availableWeight) : 0;

  // Determine initial recommendation
  let recommendation: 'ready' | 'light' | 'rest';
  if (overall >= 75 && concerns.length === 0) {
    recommendation = 'ready';
  } else if (overall >= 50 || (overall >= 40 && concerns.length <= 1)) {
    recommendation = 'light';
  } else {
    recommendation = 'rest';
  }

  // HRV-Wellness Conflict Resolution (Phase 1.1)
  // Research shows HRV has 30% error rate - trust wellness when they strongly disagree
  if (wellnessScore !== undefined && hrvScore > 0) {
    const difference = Math.abs(hrvScore - wellnessScore);

    if (difference > CONFLICT_THRESHOLD) {
      // Significant disagreement - trust wellness over HRV
      if (hrvScore >= 80 && wellnessScore < 40) {
        // HRV says "ready" but you feel terrible
        recommendation = 'rest';
        reasoning = `HRV suggests good recovery (${hrvScore}), but subjective wellness is low (${wellnessScore}). ` +
          `Trusting how you actually feel - rest recommended. HRV has ~30% error rate.`;
      } else if (hrvScore <= 60 && wellnessScore >= 75) {
        // HRV says "stressed" but you feel great
        recommendation = 'light';
        reasoning = `HRV indicates stress (${hrvScore}), but you feel good (wellness: ${wellnessScore}). ` +
          `Light training appropriate - HRV may be measurement artifact.`;
      }
    }
  }

  return {
    overall,
    components: {
      sleep: sleepScore,
      hrv: hrvScore,
      bodyBattery: bodyBatteryScore,
      restingHR: rhrScore,
      wellness: wellnessComponent,
    },
    recommendation,
    concerns,
    dataQuality,
    reasoning,
  };
}

/**
 * Get recent metrics from database
 */
export function getRecentMetrics(dbPath: string, days: number): DailyMetrics[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Get column names from the table to handle schema differences
    const tableInfo = db.prepare("PRAGMA table_info(daily_metrics)").all() as { name: string }[];
    const columns = tableInfo.map(col => col.name);

    // Build SELECT with only existing columns
    const selectColumns = [
      'date',
      'sleep_score',
      'sleep_duration_seconds',
      'deep_sleep_seconds',
      'rem_sleep_seconds',
      'hrv_rmssd',
      'hrv_status',
      'resting_heart_rate',
      'body_battery',
    ].filter(col => columns.includes(col));

    // Add optional columns if they exist
    if (columns.includes('training_readiness')) selectColumns.push('training_readiness');
    if (columns.includes('recovery_score')) selectColumns.push('recovery_score');

    const stmt = db.prepare(`
      SELECT ${selectColumns.join(', ')}
      FROM daily_metrics
      WHERE date >= date('now', '-' || ? || ' days')
      ORDER BY date DESC
      LIMIT ?
    `);

    const results = stmt.all(days, days) as DailyMetrics[];
    db.close();

    return results;
  } catch (error) {
    console.error('Error reading database:', error);
    return [];
  }
}

/**
 * Calculate trend from recent metrics
 */
function calculateTrend(metrics: DailyMetrics[]): 'improving' | 'stable' | 'declining' | 'unknown' {
  if (metrics.length < 3) return 'unknown';

  // Calculate average readiness for recent 3 days vs previous 3 days
  const recent = metrics.slice(0, 3);
  const previous = metrics.slice(3, 6);

  if (previous.length < 2) return 'unknown';

  const recentAvg = recent.reduce((sum, m) => {
    const score = calculateReadinessScore(m);
    return sum + score.overall;
  }, 0) / recent.length;

  const previousAvg = previous.reduce((sum, m) => {
    const score = calculateReadinessScore(m);
    return sum + score.overall;
  }, 0) / previous.length;

  const diff = recentAvg - previousAvg;

  if (diff > 10) return 'improving';
  if (diff < -10) return 'declining';
  return 'stable';
}

/**
 * Generate workout suggestions based on readiness
 */
function getWorkoutSuggestions(score: ReadinessScore): string[] {
  const suggestions: string[] = [];

  if (score.recommendation === 'rest') {
    suggestions.push('rest');
    suggestions.push('light_walk');
    suggestions.push('stretching');
    return suggestions;
  }

  if (score.recommendation === 'light') {
    suggestions.push('easy_run');
    suggestions.push('light_strength');
    suggestions.push('yoga');
    suggestions.push('mobility');
    return suggestions;
  }

  // Ready for full training
  suggestions.push('quality_session');
  suggestions.push('tempo_run');
  suggestions.push('speed_work');
  suggestions.push('long_run');
  suggestions.push('heavy_strength');

  // Adjust based on specific component scores
  if (score.components.hrv < 70) {
    suggestions.splice(suggestions.indexOf('speed_work'), 1);
  }

  return suggestions;
}

/**
 * Format recommendation text
 */
function formatRecommendation(score: ReadinessScore): string {
  const { recommendation, concerns, overall, reasoning } = score;

  let text = '';

  if (recommendation === 'ready') {
    text = `You're well-recovered (${overall}/100). Great day for quality training - tempo, intervals, or a long run.`;
  } else if (recommendation === 'light') {
    text = `Moderate recovery (${overall}/100). Stick to easy efforts today - light cardio or mobility work.`;
  } else {
    text = `Low recovery (${overall}/100). Rest day recommended. Focus on sleep and nutrition.`;
  }

  if (concerns.length > 0) {
    const concernsText = concerns.map(c => {
      switch (c) {
        case 'poor_sleep': return 'sleep quality was low';
        case 'insufficient_sleep_duration': return 'you slept less than 6 hours';
        case 'low_hrv': return 'HRV indicates stress';
        case 'hrv_below_baseline': return 'HRV is below your baseline';
        case 'low_body_battery': return 'body battery is depleted';
        case 'elevated_rhr': return 'resting heart rate is elevated';
        case 'low_wellness': return 'subjective wellness is low';
        default: return c;
      }
    }).join(', ');
    text += ` Note: ${concernsText}.`;
  }

  // Add reasoning if there was an HRV-wellness conflict override
  if (reasoning) {
    text += ` (${reasoning})`;
  }

  return text;
}

/**
 * Main assessment function
 */
export function assessTrainingReadiness(dbPath: string, days = 7): ReadinessAssessment {
  const metrics = getRecentMetrics(dbPath, days);

  if (metrics.length === 0) {
    return {
      date: new Date().toISOString().split('T')[0],
      readinessScore: {
        overall: 0,
        components: { sleep: 0, hrv: 0, bodyBattery: 0, restingHR: 0, wellness: 0 },
        recommendation: 'rest',
        concerns: ['no_data'],
        dataQuality: 'insufficient',
      },
      recommendation: 'No metrics data available. Sync Garmin data first.',
      workoutSuggestions: ['rest'],
      trend: 'unknown',
      metricsUsed: 0,
    };
  }

  // Use most recent day's metrics for today's assessment
  const todayMetrics = metrics[0];

  // Fetch wellness data for the same date
  const wellnessData = getWellnessForDate(dbPath, todayMetrics.date);
  const wellnessScore = wellnessData?.wellness_score;

  // Calculate readiness with wellness integration
  const score = calculateReadinessScore(todayMetrics, wellnessScore);
  const trend = calculateTrend(metrics);

  return {
    date: todayMetrics.date,
    readinessScore: score,
    recommendation: formatRecommendation(score),
    workoutSuggestions: getWorkoutSuggestions(score),
    trend,
    metricsUsed: metrics.length,
    recentMetrics: metrics,
  };
}

/**
 * Format output for terminal
 */
function formatTextOutput(assessment: ReadinessAssessment): string {
  const { date, readinessScore, recommendation, workoutSuggestions, trend, metricsUsed, recentMetrics } = assessment;
  const { overall, components, dataQuality } = readinessScore;

  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push('  TRAINING READINESS ASSESSMENT');
  lines.push('='.repeat(60));
  lines.push(`  Date: ${date}`);
  lines.push(`  Data Quality: ${dataQuality.toUpperCase()}`);
  lines.push('-'.repeat(60));
  lines.push('');
  lines.push(`  OVERALL READINESS: ${overall}/100`);
  lines.push(`  Status: ${readinessScore.recommendation.toUpperCase()}`);
  lines.push(`  Trend (7d): ${trend.toUpperCase()}`);
  lines.push('');
  lines.push('  COMPONENT SCORES:');
  lines.push(`    Sleep:        ${components.sleep}/100`);
  lines.push(`    HRV:          ${components.hrv}/100`);
  lines.push(`    Body Battery: ${components.bodyBattery}/100`);
  lines.push(`    Resting HR:   ${components.restingHR}/100`);
  lines.push(`    Wellness:     ${components.wellness}/100`);
  lines.push('');
  lines.push('-'.repeat(60));
  lines.push('  RECOMMENDATION:');
  lines.push(`  ${recommendation}`);
  lines.push('');
  lines.push('  SUGGESTED WORKOUTS:');
  for (const workout of workoutSuggestions.slice(0, 4)) {
    lines.push(`    - ${workout.replace(/_/g, ' ')}`);
  }
  lines.push('');

  // Show recent metrics trend
  if (recentMetrics && recentMetrics.length > 1) {
    lines.push('-'.repeat(60));
    lines.push('  RECENT METRICS (last 5 days):');
    lines.push('');
    lines.push('  Date       | Sleep | HRV  | Battery | RHR');
    lines.push('  ' + '-'.repeat(48));

    for (const m of recentMetrics.slice(0, 5)) {
      const sleepStr = m.sleep_score !== undefined ? String(m.sleep_score).padStart(3) : ' - ';
      const hrvStr = m.hrv_rmssd !== undefined ? String(Math.round(m.hrv_rmssd)).padStart(3) : ' - ';
      const battStr = m.body_battery !== undefined ? String(m.body_battery).padStart(3) : ' - ';
      const rhrStr = m.resting_heart_rate !== undefined ? String(m.resting_heart_rate).padStart(3) : ' - ';
      lines.push(`  ${m.date} |  ${sleepStr}  | ${hrvStr}  |   ${battStr}   | ${rhrStr}`);
    }
  }

  lines.push('');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

// CLI entrypoint
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      days: { type: 'string', short: 'd', default: '7' },
      output: { type: 'string', short: 'o', default: 'text' },
      db: { type: 'string', default: DEFAULT_DB_PATH },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(`
Training Readiness CLI

Usage:
  bun training-readiness.ts [options]

Options:
  -d, --days <n>     Days of history to analyze (default: 7)
  -o, --output <fmt> Output format: text, json (default: text)
  --db <path>        Path to SQLite database
  -h, --help         Show this help

Examples:
  bun training-readiness.ts                 # Today's assessment
  bun training-readiness.ts --days 14       # 2-week trend
  bun training-readiness.ts --output json   # JSON for scripts
`);
    process.exit(0);
  }

  const days = parseInt(values.days as string, 10) || 7;
  const dbPath = values.db as string || DEFAULT_DB_PATH;
  const assessment = assessTrainingReadiness(dbPath, days);

  if (values.output === 'json') {
    console.log(JSON.stringify(assessment, null, 2));
  } else {
    console.log(formatTextOutput(assessment));
  }
}
