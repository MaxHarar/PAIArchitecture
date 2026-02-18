#!/usr/bin/env bun
/**
 * Sunday Weekly Planner
 *
 * Analyzes previous week's workout completion and generates next week's plan.
 * Only runs on Sundays as part of the morning briefing.
 *
 * Usage:
 *   bun run SundayWeeklyPlanner.ts          # Run analysis and planning
 *   bun run SundayWeeklyPlanner.ts --test   # Preview without storing
 *   bun run SundayWeeklyPlanner.ts --json   # Output JSON format
 */

import { getDatabase, buildInsert } from '../../../fitness/src/db/client.ts';

// =============================================================================
// TYPES
// =============================================================================

export interface WeekAnalysis {
  weekStart: string;  // Monday YYYY-MM-DD
  weekEnd: string;    // Sunday YYYY-MM-DD
  totalPrescribed: number;
  totalCompleted: number;
  completionRate: number;  // 0-100
  actualLoad: number;
  prescribedLoad: number;
  loadCompliance: number;  // percentage
  avgRecoveryScore: number;
  recoveryTrend: 'improving' | 'stable' | 'declining';
}

export interface DayPlan {
  date: string;          // YYYY-MM-DD
  dayOfWeek: number;     // 0=Sun, 1=Mon, etc.
  dayAbbrev: string;     // M, T, W, R, F, S, U
  sessions: WorkoutSession[];
  isRest: boolean;
}

export interface WorkoutSession {
  name: string;
  type: string;          // run, strength, recovery, rest
  durationMinutes: number;
  slot: 'AM' | 'PM';
  intensityZone: string; // z1, z2, z3, rest
  targetHrMin?: number;
  targetHrMax?: number;
}

export interface WeekPlan {
  weekStart: string;     // Monday YYYY-MM-DD
  weekEnd: string;       // Sunday YYYY-MM-DD
  days: DayPlan[];
  volumeAdjustment: number;  // -20, 0, +10 percentage
  acwr: number;          // Acute:Chronic Workload Ratio
  focus: string;         // Primary training focus
}

export interface SundayBriefingData {
  previousWeek: WeekAnalysis;
  nextWeek: WeekPlan;
  html: string;          // Formatted for Telegram
}

// =============================================================================
// WEEKLY TEMPLATE (Base Plan)
// =============================================================================

/**
 * Default weekly workout template
 * Adjustments applied based on previous week analysis
 */
const WEEKLY_TEMPLATE: Array<{
  dayOfWeek: number;
  dayAbbrev: string;
  sessions: Array<{
    name: string;
    type: string;
    durationMinutes: number;
    slot: 'AM' | 'PM';
    intensityZone: string;
    targetHrMin?: number;
    targetHrMax?: number;
  }>;
}> = [
  // Monday - REST
  {
    dayOfWeek: 1,
    dayAbbrev: 'M',
    sessions: []
  },
  // Tuesday - Legs AM, Recovery PM
  {
    dayOfWeek: 2,
    dayAbbrev: 'T',
    sessions: [
      { name: 'Lower Body Strength', type: 'strength', durationMinutes: 50, slot: 'AM', intensityZone: 'z3' },
      { name: 'Recovery Stretch', type: 'recovery', durationMinutes: 25, slot: 'PM', intensityZone: 'z1' }
    ]
  },
  // Wednesday - Chest AM, Speed Work PM
  {
    dayOfWeek: 3,
    dayAbbrev: 'W',
    sessions: [
      { name: 'Upper Body Push', type: 'strength', durationMinutes: 45, slot: 'AM', intensityZone: 'z3' },
      { name: 'Speed Intervals', type: 'run', durationMinutes: 35, slot: 'PM', intensityZone: 'z4', targetHrMin: 160, targetHrMax: 175 }
    ]
  },
  // Thursday - Easy Run AM, Back PM
  {
    dayOfWeek: 4,
    dayAbbrev: 'R',
    sessions: [
      { name: 'Easy Aerobic Run', type: 'run', durationMinutes: 40, slot: 'AM', intensityZone: 'z2', targetHrMin: 135, targetHrMax: 150 },
      { name: 'Upper Body Pull', type: 'strength', durationMinutes: 45, slot: 'PM', intensityZone: 'z3' }
    ]
  },
  // Friday - Full Body AM, Recovery PM
  {
    dayOfWeek: 5,
    dayAbbrev: 'F',
    sessions: [
      { name: 'Full Body Power', type: 'strength', durationMinutes: 60, slot: 'AM', intensityZone: 'z4' },
      { name: 'Recovery + Sauna', type: 'recovery', durationMinutes: 30, slot: 'PM', intensityZone: 'z1' }
    ]
  },
  // Saturday - Long Run AM
  {
    dayOfWeek: 6,
    dayAbbrev: 'S',
    sessions: [
      { name: 'Long Run', type: 'run', durationMinutes: 75, slot: 'AM', intensityZone: 'z2', targetHrMin: 140, targetHrMax: 160 }
    ]
  },
  // Sunday - REST
  {
    dayOfWeek: 0,
    dayAbbrev: 'U',
    sessions: []
  }
];

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Get the Monday of a given week (for week boundaries)
 */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  return new Date(d.setDate(diff));
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Analyze the previous week's workout performance
 */
export function analyzePreviousWeek(): WeekAnalysis {
  const db = getDatabase();
  const today = new Date();

  // Get last Monday (start of previous week if today is Sunday)
  const lastMonday = getMondayOfWeek(today);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastSunday.getDate() + 6);

  const weekStart = formatDate(lastMonday);
  const weekEnd = formatDate(lastSunday);

  // Query completion stats
  const stats = db.queryOne<{
    total: number;
    completed: number;
    actual_load: number;
    prescribed_load: number;
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN target_load ELSE 0 END), 0) as actual_load,
      COALESCE(SUM(target_load), 0) as prescribed_load
    FROM workout_prescriptions
    WHERE scheduled_date BETWEEN ? AND ?
      AND slot = 'primary'
  `, [weekStart, weekEnd]);

  // Query recovery scores (from daily_metrics if available, else estimate from prescription readiness)
  const recoveryData = db.query<{ recovery: number; day: number }>(`
    SELECT
      readiness_at_prescription as recovery,
      strftime('%w', scheduled_date) as day
    FROM workout_prescriptions
    WHERE scheduled_date BETWEEN ? AND ?
      AND readiness_at_prescription IS NOT NULL
    ORDER BY scheduled_date
  `, [weekStart, weekEnd]);

  // Calculate recovery trend
  let recoveryTrend: 'improving' | 'stable' | 'declining' = 'stable';
  let avgRecovery = 70; // Default

  if (recoveryData.length >= 3) {
    const scores = recoveryData.map(r => r.recovery);
    avgRecovery = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    // Compare first half to second half
    const mid = Math.floor(scores.length / 2);
    const firstHalf = scores.slice(0, mid);
    const secondHalf = scores.slice(mid);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondAvg - firstAvg > 5) recoveryTrend = 'improving';
    else if (firstAvg - secondAvg > 5) recoveryTrend = 'declining';
  }

  const total = stats?.total || 0;
  const completed = stats?.completed || 0;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const prescribedLoad = stats?.prescribed_load || 0;
  const actualLoad = stats?.actual_load || 0;
  const loadCompliance = prescribedLoad > 0 ? Math.round((actualLoad / prescribedLoad) * 100) : 0;

  return {
    weekStart,
    weekEnd,
    totalPrescribed: total,
    totalCompleted: completed,
    completionRate,
    actualLoad,
    prescribedLoad,
    loadCompliance,
    avgRecoveryScore: avgRecovery,
    recoveryTrend
  };
}

/**
 * Calculate ACWR (Acute:Chronic Workload Ratio)
 * Acute = last 7 days, Chronic = last 28 days average
 */
function calculateACWR(): number {
  const db = getDatabase();

  const result = db.queryOne<{ acute: number; chronic: number }>(`
    SELECT
      COALESCE(SUM(CASE
        WHEN scheduled_date >= date('now', '-7 days')
        THEN target_load
        ELSE 0
      END), 0) as acute,
      COALESCE(SUM(CASE
        WHEN scheduled_date >= date('now', '-28 days')
        THEN target_load
        ELSE 0
      END) / 4.0, 1) as chronic
    FROM workout_prescriptions
    WHERE status = 'completed'
  `);

  if (!result || result.chronic === 0) return 0.8; // Safe default

  return Math.round((result.acute / result.chronic) * 100) / 100;
}

// =============================================================================
// PLANNING FUNCTIONS
// =============================================================================

/**
 * Generate next week's workout plan based on template and previous week analysis
 */
export function generateNextWeekPlan(analysis: WeekAnalysis): WeekPlan {
  const acwr = calculateACWR();

  // Determine volume adjustment
  let volumeAdjustment = 0;
  let focus = 'Aerobic base';

  if (analysis.completionRate < 70) {
    // Low completion - reduce volume
    volumeAdjustment = -20;
    focus = 'Recovery focus';
  } else if (acwr > 1.5) {
    // High ACWR - reduce intensity, replace quality with easy
    volumeAdjustment = -10;
    focus = 'Load management';
  } else if (analysis.completionRate > 90 && analysis.recoveryTrend === 'improving') {
    // High performance - slight increase
    volumeAdjustment = 10;
    focus = 'Progressive overload';
  }

  // Calculate next week dates (Monday-Sunday)
  // On Sunday: this week's Monday is 6 days ago, so next Monday is tomorrow (+1 day)
  // On any other day: get this week's Monday, then add 7 days for next Monday
  const today = new Date();
  const thisMonday = getMondayOfWeek(today);

  // Next Monday is always 7 days from this Monday
  const nextMonday = new Date(thisMonday);
  nextMonday.setDate(thisMonday.getDate() + 7);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);

  const weekStart = formatDate(nextMonday);
  const weekEnd = formatDate(nextSunday);

  // Generate daily plans
  const days: DayPlan[] = [];

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(nextMonday);
    dayDate.setDate(dayDate.getDate() + i);

    const dayOfWeek = dayDate.getDay();
    const template = WEEKLY_TEMPLATE.find(t => t.dayOfWeek === dayOfWeek);

    if (!template) continue;

    // Apply volume adjustment to durations
    const adjustedSessions: WorkoutSession[] = template.sessions.map(session => {
      let adjustedDuration = session.durationMinutes;

      if (volumeAdjustment !== 0) {
        adjustedDuration = Math.round(session.durationMinutes * (1 + volumeAdjustment / 100));
      }

      // If ACWR too high, convert hard sessions to easy
      let adjustedZone = session.intensityZone;
      if (acwr > 1.5 && (session.intensityZone === 'z4' || session.intensityZone === 'z3')) {
        adjustedZone = 'z2';
      }

      return {
        ...session,
        durationMinutes: adjustedDuration,
        intensityZone: adjustedZone
      };
    });

    days.push({
      date: formatDate(dayDate),
      dayOfWeek,
      dayAbbrev: template.dayAbbrev,
      sessions: adjustedSessions,
      isRest: adjustedSessions.length === 0
    });
  }

  return {
    weekStart,
    weekEnd,
    days,
    volumeAdjustment,
    acwr,
    focus
  };
}

/**
 * Store next week's prescriptions in database
 */
export function storePrescriptions(plan: WeekPlan): { stored: number; errors: number } {
  const db = getDatabase();
  let stored = 0;
  let errors = 0;

  // First, clear any existing prescriptions for next week
  db.execute(`
    DELETE FROM workout_prescriptions
    WHERE scheduled_date BETWEEN ? AND ?
      AND status = 'prescribed'
  `, [plan.weekStart, plan.weekEnd]);

  for (const day of plan.days) {
    if (day.isRest) {
      // Insert rest day placeholder
      try {
        const data = {
          scheduled_date: day.date,
          scheduled_time: null,
          day_of_week: day.dayOfWeek,
          slot: 'primary',
          name: 'Rest Day',
          description: 'Active recovery or complete rest',
          target_duration_seconds: 0,
          target_load: 0,
          intensity_zone: 'rest',
          adaptation_reason: JSON.stringify({ primary: 'Scheduled rest day for recovery' }),
          status: 'prescribed'
        };

        const { sql, params } = buildInsert('workout_prescriptions', data);
        db.execute(sql, params);
        stored++;
      } catch (err) {
        errors++;
        if (process.env.DEBUG) console.error(`Error storing rest day for ${day.date}:`, err);
      }
    } else {
      // Insert each session
      for (const session of day.sessions) {
        try {
          const scheduledTime = session.slot === 'AM' ? '06:00' : '18:00';

          const data = {
            scheduled_date: day.date,
            scheduled_time: scheduledTime,
            day_of_week: day.dayOfWeek,
            slot: session.slot === 'AM' ? 'primary' : 'secondary',
            name: session.name,
            description: `${session.type} workout - ${session.durationMinutes}min ${session.intensityZone}`,
            target_duration_seconds: session.durationMinutes * 60,
            target_load: calculateLoadScore(session),
            intensity_zone: session.intensityZone,
            target_hr_min: session.targetHrMin || null,
            target_hr_max: session.targetHrMax || null,
            adaptation_reason: JSON.stringify({ primary: `Weekly plan - ${plan.focus}` }),
            status: 'prescribed'
          };

          const { sql, params } = buildInsert('workout_prescriptions', data);
          db.execute(sql, params);
          stored++;
        } catch (err) {
          errors++;
          if (process.env.DEBUG) console.error(`Error storing ${session.name} for ${day.date}:`, err);
        }
      }
    }
  }

  return { stored, errors };
}

/**
 * Calculate a simple load score based on duration and intensity
 */
function calculateLoadScore(session: WorkoutSession): number {
  const zoneMultiplier: Record<string, number> = {
    z1: 1.0,
    z2: 1.5,
    z3: 2.0,
    z4: 2.5,
    z5: 3.0,
    rest: 0
  };

  const multiplier = zoneMultiplier[session.intensityZone] || 1.5;
  return Math.round(session.durationMinutes * multiplier);
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format the Sunday briefing section for Telegram (HTML)
 */
export function formatSundayBriefing(analysis: WeekAnalysis, plan: WeekPlan): string {
  // Format previous week dates
  const prevStart = new Date(analysis.weekStart);
  const prevEnd = new Date(analysis.weekEnd);
  const prevStartStr = `${prevStart.toLocaleDateString('en-US', { month: 'short' })} ${prevStart.getDate()}`;
  const prevEndStr = prevEnd.getDate().toString();

  // Format next week dates
  const nextStart = new Date(plan.weekStart);
  const nextEnd = new Date(plan.weekEnd);
  const nextStartStr = `${nextStart.toLocaleDateString('en-US', { month: 'short' })} ${nextStart.getDate()}`;
  const nextEndStr = nextEnd.getDate().toString();

  // Build day summaries
  const daySummaries = plan.days.map(day => {
    if (day.isRest) {
      return `${day.dayAbbrev}: REST`;
    }

    const sessionSummary = day.sessions.map(s => {
      if (s.type === 'run') return s.name.includes('Long') ? `Long Run ${s.durationMinutes}m` : s.name.split(' ')[0];
      if (s.type === 'recovery') return 'Recovery';
      return s.name.split(' ').slice(0, 2).join(' ').replace('Upper Body', 'Upper').replace('Lower Body', 'Lower');
    }).join(' + ');

    return `${day.dayAbbrev}: ${sessionSummary}`;
  });

  // Recovery trend indicator
  const trendIndicator = analysis.recoveryTrend === 'improving' ? '\u2191' :
                         analysis.recoveryTrend === 'declining' ? '\u2193' : '\u2192';

  return `<b>WEEK REVIEW (${prevStartStr}-${prevEndStr})</b>
${analysis.totalCompleted}/${analysis.totalPrescribed} done (${analysis.completionRate}%) | Load: ${analysis.loadCompliance}% | Trend: ${analysis.recoveryTrend}${trendIndicator}

<b>NEXT WEEK (${nextStartStr}-${nextEndStr})</b>
${daySummaries.join('\n')}

Focus: ${plan.focus} | ACWR: ${plan.acwr}`;
}

// =============================================================================
// MAIN ENTRY POINTS
// =============================================================================

/**
 * Check if today is Sunday
 */
export function isSunday(): boolean {
  return new Date().getDay() === 0;
}

/**
 * Run the full Sunday planning workflow
 */
export function runSundayPlanning(options?: { test?: boolean }): SundayBriefingData {
  const analysis = analyzePreviousWeek();
  const plan = generateNextWeekPlan(analysis);

  if (!options?.test) {
    const { stored, errors } = storePrescriptions(plan);
    if (process.env.DEBUG) {
      console.log(`Stored ${stored} prescriptions, ${errors} errors`);
    }
  }

  const html = formatSundayBriefing(analysis, plan);

  return { previousWeek: analysis, nextWeek: plan, html };
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.main) {
  const isTest = process.argv.includes('--test');
  const isJson = process.argv.includes('--json');

  console.log('[Sunday Weekly Planner]');
  console.log(`Mode: ${isTest ? 'TEST (no DB writes)' : 'PRODUCTION'}`);
  console.log(`Today is ${isSunday() ? 'Sunday' : 'NOT Sunday'}\n`);

  const result = runSundayPlanning({ test: isTest });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Convert HTML to plain text for terminal
    const plainText = result.html
      .replace(/<b>/g, '')
      .replace(/<\/b>/g, '')
      .replace(/<i>/g, '')
      .replace(/<\/i>/g, '');

    console.log('='.repeat(50));
    console.log(plainText);
    console.log('='.repeat(50));

    if (!isTest) {
      console.log('\nPrescriptions stored in database.');
    }
  }
}
