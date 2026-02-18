#!/usr/bin/env bun
/**
 * Prescription Engine - Core Algorithm
 *
 * The intelligent workout prescription system that eliminates decision fatigue.
 * Combines recovery metrics, training load, periodization, and preferences to
 * prescribe optimal daily workouts.
 *
 * 5-STEP ALGORITHM:
 * 1. Gather Context (recovery, ACWR, phase, goals, calendar)
 * 2. Assess Readiness (can user handle intensity today?)
 * 3. Select Template (filter by constraints, score by preferences)
 * 4. Generate Prescription (specific targets, reasoning)
 * 5. Validate (ACWR limits, recovery days, safety)
 */

import { DatabaseClient } from "../../../fitness/src/db/client.ts";
import {
  calculateBanisterTRIMP,
  calculateACWR,
  type ACWRResult,
} from "./load-calculator.ts";
import {
  determinePeriodizationPhase,
  getWeeklyLoadTarget,
  shouldDeload,
  type PeriodizationPhase,
  type Goal,
} from "./periodization-engine.ts";
// Formatters imported by orchestrate-morning.ts for Telegram delivery
// import { formatRestDayMessage, formatPrescriptionForTelegram } from "../Notifications/prescription-formatter.ts";

// =============================================================================
// TYPES
// =============================================================================

export interface RecoveryMetrics {
  date: string;
  hrvRmssd: number | null;
  hrvBaseline: number;
  hrvRatio: number;
  restingHR: number | null;
  restingHRBaseline: number;
  sleepScore: number | null;
  bodyBattery: number | null;
  trainingReadiness: number | null;
  compositeScore: number; // 0-100
  recommendation: "ready" | "light" | "rest";
  dataQuality: "measured" | "stale" | "missing";
  dataAge: number; // days since last data
  wellnessScore: number | null; // from daily_wellness questionnaire
}

export interface TrainingHistory {
  acuteLoad: number;
  chronicLoad: number;
  acwr: ACWRResult;
  weekToDateLoad: number;
  lastWorkoutDate: string | null;
  daysSinceLastWorkout: number;
  lastHardWorkoutDate: string | null;
  daysSinceLastHard: number;
  recentWorkoutTypes: string[];
}

export interface WorkoutTemplate {
  id: number;
  name: string;
  slug: string;
  category: string;
  duration_range_min: number;
  duration_range_max: number;
  intensity_zone: string | null;
  target_rpe_low: number | null;
  target_rpe_high: number | null;
  requires_recovery_days: number;
  max_per_week: number;
  difficulty: string;
  estimated_load_factor: number;
  description: string;
}

export interface WorkoutPrescription {
  template: WorkoutTemplate;
  scheduledDate: string;
  scheduledTime: string | null;
  targetDuration: number;
  targetDistance: number | null;
  targetLoad: number;
  intensityZone: string;
  targetHRMin: number | null;
  targetHRMax: number | null;
  adaptationReason: AdaptationReason;
  readinessScore: number;
  loadContext: LoadContext;
  alternatives: WorkoutTemplate[];
  nextThreeDays: DayPreview[];
}

export interface AdaptationReason {
  primary: string;
  factors: string[];
  explanation: string;
}

export interface LoadContext {
  acwr: number;
  riskLevel: string;
  weeklyLoadTarget: number;
  weekToDateLoad: number;
  loadRemaining: number;
  phase: string;
  weekNumber: number;
}

export interface DayPreview {
  date: string;
  dayName: string;
  workoutType: string;
  rationale: string;
}

// =============================================================================
// STEP 1: GATHER CONTEXT
// =============================================================================

/**
 * Get latest recovery metrics with composite score
 *
 * SAFETY: When data is missing or stale, defaults to CONSERVATIVE scores
 * that will trigger REST recommendations. Never fabricates optimistic scores.
 */
async function getRecoveryMetrics(
  db: DatabaseClient,
  date: string = new Date().toISOString().split("T")[0]!
): Promise<RecoveryMetrics> {
  // Get today's metrics
  const today = db.queryOne<{
    hrv_rmssd: number | null;
    resting_heart_rate: number | null;
    sleep_score: number | null;
    body_battery: number | null;
    training_readiness: number | null;
  }>(
    `SELECT hrv_rmssd, resting_heart_rate, sleep_score, body_battery, training_readiness
     FROM daily_metrics WHERE date = ?`,
    [date]
  );

  // Determine data quality and find most recent data if today's is missing
  let dataQuality: "measured" | "stale" | "missing" = "missing";
  let dataAge = 999;
  let metricsSource = today;

  if (today && (today.sleep_score !== null || today.body_battery !== null)) {
    dataQuality = "measured";
    dataAge = 0;
  } else {
    // Look for yesterday's data
    const recent = db.queryOne<{
      date: string;
      hrv_rmssd: number | null;
      resting_heart_rate: number | null;
      sleep_score: number | null;
      body_battery: number | null;
      training_readiness: number | null;
    }>(
      `SELECT date, hrv_rmssd, resting_heart_rate, sleep_score, body_battery, training_readiness
       FROM daily_metrics
       WHERE date < ? AND (sleep_score IS NOT NULL OR body_battery IS NOT NULL)
       ORDER BY date DESC LIMIT 1`,
      [date]
    );

    if (recent) {
      const daysDiff = Math.floor(
        (new Date(date).getTime() - new Date(recent.date).getTime()) / (1000 * 60 * 60 * 24)
      );
      dataAge = daysDiff;
      metricsSource = recent;

      if (daysDiff <= 1) {
        dataQuality = "stale"; // yesterday's data
      } else if (daysDiff <= 2) {
        dataQuality = "stale";
      } else {
        dataQuality = "missing"; // data > 48h old
      }
    }
  }

  // Get wellness questionnaire data for today (from daily_wellness table)
  const wellness = db.queryOne<{ wellness_score: number | null }>(
    `SELECT wellness_score FROM daily_wellness WHERE date = ?`,
    [date]
  );
  const wellnessScore = wellness?.wellness_score ?? null;

  // Get 7-day baseline for HRV and RHR
  const baseline = db.queryOne<{
    hrv_baseline: number;
    rhr_baseline: number;
  }>(
    `SELECT
      AVG(hrv_rmssd) as hrv_baseline,
      AVG(resting_heart_rate) as rhr_baseline
     FROM daily_metrics
     WHERE date >= date(?, '-7 days') AND date < ?
       AND hrv_rmssd IS NOT NULL
       AND resting_heart_rate IS NOT NULL`,
    [date, date]
  );

  const hrvRmssd = metricsSource?.hrv_rmssd ?? null;
  const hrvBaseline = baseline?.hrv_baseline ?? 50;
  const hrvRatio = hrvRmssd ? hrvRmssd / hrvBaseline : 1.0;

  const restingHR = metricsSource?.resting_heart_rate ?? null;
  const restingHRBaseline = baseline?.rhr_baseline ?? 60;
  const rhrElevation = restingHR ? restingHR - restingHRBaseline : 0;

  // SAFETY: Conservative defaults based on data quality
  let sleepScore: number | null;
  let bodyBattery: number | null;
  let trainingReadiness: number | null;
  let compositeCap: number; // maximum allowed composite score

  switch (dataQuality) {
    case "measured":
      // Use actual values directly
      sleepScore = metricsSource?.sleep_score ?? null;
      bodyBattery = metricsSource?.body_battery ?? null;
      trainingReadiness = metricsSource?.training_readiness ?? null;
      compositeCap = 100;
      break;
    case "stale":
      // Use stale values with 10% penalty, cap composite at 60
      sleepScore = metricsSource?.sleep_score
        ? Math.round(metricsSource.sleep_score * 0.9)
        : null;
      bodyBattery = metricsSource?.body_battery
        ? Math.round(metricsSource.body_battery * 0.9)
        : null;
      trainingReadiness = metricsSource?.training_readiness
        ? Math.round(metricsSource.training_readiness * 0.9)
        : null;
      compositeCap = 60;
      break;
    case "missing":
    default:
      // No data at all — mandatory REST values
      sleepScore = null;
      bodyBattery = null;
      trainingReadiness = null;
      compositeCap = dataAge > 2 ? 40 : 30; // capped very low
      break;
  }

  // Calculate composite score (0-100)
  // Use actual values when available, conservative defaults when not
  const effectiveSleep = sleepScore ?? (dataQuality === "missing" ? 30 : 50);
  const effectiveBattery = bodyBattery ?? (dataQuality === "missing" ? 30 : 50);

  // Weights: Sleep 25%, HRV 25%, Body Battery 20%, RHR 10%, Wellness 20% (if available)
  let compositeScore: number;
  if (wellnessScore !== null) {
    compositeScore = Math.round(
      effectiveSleep * 0.25 +
        hrvRatio * 100 * 0.25 +
        effectiveBattery * 0.20 +
        (rhrElevation > 5 ? 50 : 85) * 0.10 +
        wellnessScore * 0.20
    );
  } else {
    compositeScore = Math.round(
      effectiveSleep * 0.30 +
        hrvRatio * 100 * 0.30 +
        effectiveBattery * 0.25 +
        (rhrElevation > 5 ? 50 : 85) * 0.15
    );
  }

  // Apply quality cap
  compositeScore = Math.min(compositeScore, compositeCap);

  // Readiness recommendation
  let recommendation: "ready" | "light" | "rest";
  if (dataQuality === "missing") {
    recommendation = "rest"; // No data = mandatory rest
  } else if (compositeScore >= 75 && hrvRatio >= 0.95) {
    recommendation = "ready";
  } else if (compositeScore >= 60 && hrvRatio >= 0.85) {
    recommendation = "light";
  } else {
    recommendation = "rest";
  }

  return {
    date,
    hrvRmssd,
    hrvBaseline,
    hrvRatio,
    restingHR,
    restingHRBaseline,
    sleepScore,
    bodyBattery,
    trainingReadiness,
    compositeScore,
    recommendation,
    dataQuality,
    dataAge,
    wellnessScore,
  };
}

/**
 * Get training history with ACWR
 */
async function getTrainingHistory(
  db: DatabaseClient,
  date: string = new Date().toISOString().split("T")[0]!
): Promise<TrainingHistory> {
  // Get last 28 days of training load
  const loads = db.query<{ date: string; load: number }>(
    `SELECT
      date(w.started_at) as date,
      COALESCE(SUM(tl.load_value), 0) as load
     FROM workouts w
     LEFT JOIN training_loads tl ON tl.workout_id = w.id AND tl.load_type = 'trimp'
     WHERE date(w.started_at) >= date(?, '-28 days')
       AND date(w.started_at) < ?
     GROUP BY date(w.started_at)
     ORDER BY date(w.started_at) DESC`,
    [date, date]
  );

  // Fill in missing dates with 0 load
  const loadMap = new Map(loads.map((l) => [l.date, l.load]));
  const last28Days: number[] = [];
  const last7Days: number[] = [];

  for (let i = 0; i < 28; i++) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0]!;
    const load = loadMap.get(dateStr) ?? 0;
    last28Days.push(load);
    if (i < 7) last7Days.push(load);
  }

  // Calculate ACWR
  const acuteLoad = last7Days.reduce((sum, l) => sum + l, 0);
  const chronicLoad = last28Days.reduce((sum, l) => sum + l, 0) / 28;
  const acwr = calculateACWR(last7Days, last28Days);

  // Week-to-date load (this week so far)
  const weekStart = new Date(date);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  const weekToDateLoad = db.queryOne<{ load: number }>(
    `SELECT COALESCE(SUM(tl.load_value), 0) as load
     FROM workouts w
     LEFT JOIN training_loads tl ON tl.workout_id = w.id AND tl.load_type = 'trimp'
     WHERE date(w.started_at) >= ? AND date(w.started_at) < ?`,
    [weekStart.toISOString().split("T")[0], date]
  )?.load ?? 0;

  // Last workout info
  const lastWorkout = db.queryOne<{
    date: string;
    is_hard: number;
    category: string;
  }>(
    `SELECT
      date(w.started_at) as date,
      CASE WHEN wt.difficulty IN ('advanced', 'intermediate') THEN 1 ELSE 0 END as is_hard,
      wt.category
     FROM workouts w
     LEFT JOIN workout_prescriptions wp ON wp.actual_workout_id = w.id
     LEFT JOIN workout_templates wt ON wp.template_id = wt.id
     WHERE date(w.started_at) < ?
     ORDER BY w.started_at DESC
     LIMIT 1`,
    [date]
  );

  const lastWorkoutDate = lastWorkout?.date ?? null;
  const daysSinceLastWorkout = lastWorkoutDate
    ? Math.floor(
        (new Date(date).getTime() - new Date(lastWorkoutDate).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 999;

  // Last hard workout
  const lastHardWorkout = db.queryOne<{ date: string }>(
    `SELECT date(w.started_at) as date
     FROM workouts w
     LEFT JOIN workout_prescriptions wp ON wp.actual_workout_id = w.id
     LEFT JOIN workout_templates wt ON wp.template_id = wt.id
     WHERE date(w.started_at) < ?
       AND wt.difficulty IN ('advanced', 'intermediate')
       AND wt.category IN ('threshold', 'speed_work', 'hill_work', 'intervals')
     ORDER BY w.started_at DESC
     LIMIT 1`,
    [date]
  );

  const lastHardWorkoutDate = lastHardWorkout?.date ?? null;
  const daysSinceLastHard = lastHardWorkoutDate
    ? Math.floor(
        (new Date(date).getTime() - new Date(lastHardWorkoutDate).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 999;

  // Recent workout types (last 7 days)
  const recentTypes = db.query<{ category: string }>(
    `SELECT DISTINCT wt.category
     FROM workouts w
     LEFT JOIN workout_prescriptions wp ON wp.actual_workout_id = w.id
     LEFT JOIN workout_templates wt ON wp.template_id = wt.id
     WHERE date(w.started_at) >= date(?, '-7 days')
       AND date(w.started_at) < ?
       AND wt.category IS NOT NULL`,
    [date, date]
  );

  return {
    acuteLoad,
    chronicLoad,
    acwr,
    weekToDateLoad,
    lastWorkoutDate,
    daysSinceLastWorkout,
    lastHardWorkoutDate,
    daysSinceLastHard,
    recentWorkoutTypes: recentTypes.map((r) => r.category),
  };
}

// =============================================================================
// STEP 2: ASSESS READINESS
// =============================================================================

/**
 * Determine if user can handle intensity training today
 */
function canHandleIntensity(
  recovery: RecoveryMetrics,
  history: TrainingHistory
): { canHandle: boolean; reason: string } {
  // Hard stop conditions
  if (recovery.hrvRatio < 0.85) {
    return {
      canHandle: false,
      reason: "HRV significantly suppressed (< 85% baseline)",
    };
  }

  if (recovery.compositeScore < 60) {
    return {
      canHandle: false,
      reason: "Overall readiness too low (< 60)",
    };
  }

  if (history.acwr.acwr > 1.5) {
    return {
      canHandle: false,
      reason: "ACWR > 1.5 - high injury risk, rest or easy only",
    };
  }

  if (history.daysSinceLastHard < 2) {
    return {
      canHandle: false,
      reason: "Less than 2 days since last hard workout",
    };
  }

  // Caution zone
  if (history.acwr.acwr > 1.3) {
    return {
      canHandle: false,
      reason: "ACWR > 1.3 - elevated risk, easy workouts only",
    };
  }

  if (recovery.compositeScore < 75) {
    return { canHandle: false, reason: "Readiness below optimal (< 75)" };
  }

  // All green
  return { canHandle: true, reason: "Recovery metrics optimal for intensity" };
}

// =============================================================================
// STEP 3: SELECT TEMPLATE
// =============================================================================

/**
 * Get candidate templates filtered by constraints
 */
async function getCandidateTemplates(
  db: DatabaseClient,
  phase: PeriodizationPhase,
  canIntensity: boolean,
  history: TrainingHistory,
  dayOfWeek: number
): Promise<WorkoutTemplate[]> {
  // Build filter conditions
  const conditions: string[] = ["wt.is_active = 1"];
  const params: any[] = [];

  // Filter by intensity capability
  if (!canIntensity) {
    conditions.push("wt.difficulty NOT IN ('advanced')");
    conditions.push(
      "wt.category NOT IN ('threshold', 'speed_work', 'intervals', 'hill_work')"
    );
  }

  // Filter by recovery requirements
  if (history.daysSinceLastHard < 2) {
    conditions.push("wt.requires_recovery_days <= ?");
    params.push(history.daysSinceLastHard);
  }

  // Get templates
  const templates = db.query<WorkoutTemplate>(
    `SELECT * FROM workout_templates wt
     WHERE ${conditions.join(" AND ")}
     ORDER BY wt.estimated_load_factor DESC`,
    params
  );

  return templates;
}

/**
 * Score templates by preference and fit
 */
function scoreTemplates(
  templates: WorkoutTemplate[],
  phase: PeriodizationPhase,
  history: TrainingHistory
): Array<{ template: WorkoutTemplate; score: number }> {
  return templates
    .map((template) => {
      let score = 50; // Base score

      // Phase alignment (+20 pts)
      if (phase.phase === "base" && template.category.includes("base")) {
        score += 20;
      } else if (
        phase.phase === "build" &&
        (template.category.includes("tempo") ||
          template.category.includes("threshold"))
      ) {
        score += 20;
      } else if (
        phase.phase === "peak" &&
        (template.category.includes("speed") ||
          template.category.includes("intervals"))
      ) {
        score += 20;
      }

      // Variety bonus - penalize if done recently (+/- 10 pts)
      if (history.recentWorkoutTypes.includes(template.category)) {
        score -= 10;
      } else {
        score += 10;
      }

      // Difficulty match (+10 pts)
      if (phase.phase === "base" && template.difficulty === "beginner") {
        score += 10;
      } else if (
        phase.phase === "build" &&
        template.difficulty === "intermediate"
      ) {
        score += 10;
      } else if (phase.phase === "peak" && template.difficulty === "advanced") {
        score += 10;
      }

      return { template, score };
    })
    .sort((a, b) => b.score - a.score);
}

// =============================================================================
// STEP 4: GENERATE PRESCRIPTION
// =============================================================================

/**
 * Generate complete workout prescription
 */
/**
 * Get the REST template from the database
 */
function getRestTemplate(db: DatabaseClient): WorkoutTemplate {
  const rest = db.queryOne<WorkoutTemplate>(
    `SELECT * FROM workout_templates WHERE slug = 'rest-day' OR category = 'rest' LIMIT 1`
  );
  if (rest) return rest;

  // Fallback hardcoded rest template if DB doesn't have one
  return {
    id: 16,
    name: "Rest Day",
    slug: "rest-day",
    category: "rest",
    duration_range_min: 0,
    duration_range_max: 0,
    intensity_zone: null,
    target_rpe_low: 0,
    target_rpe_high: 1,
    requires_recovery_days: 0,
    max_per_week: 7,
    difficulty: "beginner",
    estimated_load_factor: 0,
    description: "Complete rest day. Focus on sleep, nutrition, and hydration.",
  };
}

/**
 * ACWR Circuit Breaker — the MOST CRITICAL safety function.
 *
 * Returns a forced prescription if safety thresholds are breached,
 * or null if normal prescription logic can proceed.
 *
 * PRINCIPLE: When data is uncertain, default to REST, not workout.
 */
function acwrCircuitBreaker(
  db: DatabaseClient,
  recovery: RecoveryMetrics,
  history: TrainingHistory,
  date: string,
  phase: PeriodizationPhase,
  weeklyTarget: WeeklyLoadTarget
): WorkoutPrescription | null {
  const acwr = history.acwr.acwr;
  const restTemplate = getRestTemplate(db);

  // Build common load context
  const loadContext: LoadContext = {
    acwr: history.acwr.acwr,
    riskLevel: history.acwr.riskLevel,
    weeklyLoadTarget: weeklyTarget.targetLoad,
    weekToDateLoad: history.weekToDateLoad,
    loadRemaining: weeklyTarget.targetLoad - history.weekToDateLoad,
    phase: phase.phase,
    weekNumber: phase.weekNumber,
  };

  const nextThreeDays: DayPreview[] = [{
    date: new Date(new Date(date).getTime() + 86400000).toISOString().split("T")[0]!,
    dayName: "Tomorrow",
    workoutType: "TBD",
    rationale: "Based on recovery trajectory",
  }];

  // GATE 1: ACWR > 2.0 → MANDATORY REST (extreme injury risk)
  if (acwr > 2.0) {
    const riskMultiple = Math.round(history.acwr.injuryRiskMultiplier);
    return {
      template: restTemplate,
      scheduledDate: date,
      scheduledTime: null,
      targetDuration: 0,
      targetDistance: null,
      targetLoad: 0,
      intensityZone: "rest",
      targetHRMin: null,
      targetHRMax: null,
      adaptationReason: {
        primary: "MANDATORY REST — ACWR dangerously high",
        factors: [
          `ACWR: ${acwr.toFixed(2)} (${riskMultiple}x injury risk)`,
          `Your recent training load is ${riskMultiple}x what your body is adapted to`,
          `Recovery: ${recovery.compositeScore}/100 (data: ${recovery.dataQuality})`,
        ],
        explanation: `Your ACWR is ${acwr.toFixed(2)}, which means you've done ${riskMultiple}x more training ` +
          `recently than your body is adapted to handle. This puts you at extreme injury risk. ` +
          `Rest today is not optional — it's protecting you from injury. Focus on sleep, ` +
          `nutrition, and light movement (walking, stretching).`,
      },
      readinessScore: recovery.compositeScore,
      loadContext,
      alternatives: [],
      nextThreeDays,
    };
  }

  // GATE 2: Body battery < 30 → MANDATORY REST
  if (recovery.bodyBattery !== null && recovery.bodyBattery < 30) {
    return {
      template: restTemplate,
      scheduledDate: date,
      scheduledTime: null,
      targetDuration: 0,
      targetDistance: null,
      targetLoad: 0,
      intensityZone: "rest",
      targetHRMin: null,
      targetHRMax: null,
      adaptationReason: {
        primary: "MANDATORY REST — Body battery critically low",
        factors: [
          `Body Battery: ${recovery.bodyBattery}/100`,
          `ACWR: ${acwr.toFixed(2)} (${history.acwr.riskLevel})`,
          `Recovery: ${recovery.compositeScore}/100`,
        ],
        explanation: `Your body battery is at ${recovery.bodyBattery}/100 — critically low. ` +
          `Training in this state provides minimal benefit and significant injury risk. ` +
          `Rest, hydrate, and sleep well tonight.`,
      },
      readinessScore: recovery.compositeScore,
      loadContext,
      alternatives: [],
      nextThreeDays,
    };
  }

  // GATE 3: No daily_metrics data at all → MANDATORY REST
  if (recovery.dataQuality === "missing") {
    return {
      template: restTemplate,
      scheduledDate: date,
      scheduledTime: null,
      targetDuration: 0,
      targetDistance: null,
      targetLoad: 0,
      intensityZone: "rest",
      targetHRMin: null,
      targetHRMax: null,
      adaptationReason: {
        primary: "REST — No recovery data available",
        factors: [
          `Data status: ${recovery.dataQuality} (${recovery.dataAge} days old)`,
          `ACWR: ${acwr.toFixed(2)} (${history.acwr.riskLevel})`,
          "Cannot safely prescribe without recovery data",
        ],
        explanation: `No recent recovery data available (last data is ${recovery.dataAge}+ days old). ` +
          `Without knowing your sleep quality, HRV, and body battery, I can't safely prescribe ` +
          `a workout. Sync your Garmin, or take a rest day.`,
      },
      readinessScore: recovery.compositeScore,
      loadContext,
      alternatives: [],
      nextThreeDays,
    };
  }

  // GATE 4: ACWR 1.5-2.0 → Active recovery only
  if (acwr > 1.5) {
    const recoveryTemplates = db.query<WorkoutTemplate>(
      `SELECT * FROM workout_templates
       WHERE is_active = 1 AND category IN ('rest', 'recovery', 'yoga', 'mobility')
       ORDER BY estimated_load_factor ASC LIMIT 3`
    );
    const template = recoveryTemplates[0] ?? restTemplate;
    const alternatives = recoveryTemplates.slice(1);

    return {
      template,
      scheduledDate: date,
      scheduledTime: "06:00",
      targetDuration: Math.round((template.duration_range_min + template.duration_range_max) / 2),
      targetDistance: null,
      targetLoad: template.estimated_load_factor * 50,
      intensityZone: template.intensity_zone ?? "z1",
      targetHRMin: null,
      targetHRMax: null,
      adaptationReason: {
        primary: "Active recovery only — ACWR elevated",
        factors: [
          `ACWR: ${acwr.toFixed(2)} (high injury risk)`,
          `Recovery: ${recovery.compositeScore}/100`,
          `Only recovery/mobility work is safe today`,
        ],
        explanation: `Your ACWR is ${acwr.toFixed(2)} — elevated injury risk. ` +
          `Active recovery (light yoga, mobility, easy walking) is the safest option. ` +
          `This helps blood flow and recovery without adding to your training stress.`,
      },
      readinessScore: recovery.compositeScore,
      loadContext,
      alternatives,
      nextThreeDays,
    };
  }

  // GATE 5: ACWR 1.3-1.5 → Easy aerobic only (zone 1-2, max 30 min)
  if (acwr > 1.3) {
    const easyTemplates = db.query<WorkoutTemplate>(
      `SELECT * FROM workout_templates
       WHERE is_active = 1
         AND difficulty IN ('beginner')
         AND category NOT IN ('threshold', 'speed_work', 'intervals', 'hill_work')
         AND estimated_load_factor <= 0.6
       ORDER BY estimated_load_factor ASC LIMIT 3`
    );
    const template = easyTemplates[0] ?? restTemplate;
    const alternatives = easyTemplates.slice(1);

    return {
      template,
      scheduledDate: date,
      scheduledTime: "06:00",
      targetDuration: Math.min(30, Math.round((template.duration_range_min + template.duration_range_max) / 2)),
      targetDistance: null,
      targetLoad: template.estimated_load_factor * 50,
      intensityZone: "z2",
      targetHRMin: Math.round(190 * 0.60),
      targetHRMax: Math.round(190 * 0.70),
      adaptationReason: {
        primary: "Easy aerobic only — ACWR caution zone",
        factors: [
          `ACWR: ${acwr.toFixed(2)} (elevated)`,
          `Recovery: ${recovery.compositeScore}/100`,
          `Max 30 minutes, Zone 1-2 only`,
        ],
        explanation: `Your ACWR is ${acwr.toFixed(2)} — in the caution zone. ` +
          `Easy aerobic work only today. Keep it conversational pace, max 30 minutes. ` +
          `If you feel off at any point, cut it short.`,
      },
      readinessScore: recovery.compositeScore,
      loadContext,
      alternatives,
      nextThreeDays,
    };
  }

  // No circuit breaker triggered — proceed with normal prescription
  return null;
}

export async function prescribeWorkout(
  db: DatabaseClient,
  date: string = new Date().toISOString().split("T")[0]!,
  goalId: number | null = null
): Promise<WorkoutPrescription> {
  // STEP 1: Gather context
  const recovery = await getRecoveryMetrics(db, date);
  const history = await getTrainingHistory(db, date);

  // Get active goal
  const goal = goalId
    ? db.queryOne<Goal>("SELECT * FROM goals WHERE id = ?", [goalId])
    : db.queryOne<Goal>(
        "SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
      );

  if (!goal) {
    throw new Error("No active goal found. Create a goal first.");
  }

  const phase = determinePeriodizationPhase(goal, new Date(date));
  const isDeload = shouldDeload(phase.weekNumber, phase.phase);
  const weeklyTarget = getWeeklyLoadTarget(
    phase,
    500,
    phase.weekNumber,
    isDeload
  );

  // ═══════════════════════════════════════════════════════════════════
  // ACWR CIRCUIT BREAKER — Checks BEFORE any template scoring
  // If triggered, bypasses ALL template selection logic
  // ═══════════════════════════════════════════════════════════════════
  const forcedPrescription = acwrCircuitBreaker(
    db, recovery, history, date, phase, weeklyTarget
  );
  if (forcedPrescription) {
    return forcedPrescription;
  }

  // STEP 2: Assess readiness (only reached if ACWR is in safe range)
  const { canHandle: canIntensity, reason: intensityReason } =
    canHandleIntensity(recovery, history);

  // STEP 3: Select template
  const dayOfWeek = new Date(date).getDay();
  const candidates = await getCandidateTemplates(
    db,
    phase,
    canIntensity,
    history,
    dayOfWeek
  );

  if (candidates.length === 0) {
    throw new Error(
      "No suitable workout templates found. Check your template library."
    );
  }

  const scored = scoreTemplates(candidates, phase, history);
  const selectedTemplate = scored[0]!.template;
  const alternatives = scored.slice(1, 4).map((s) => s.template);

  // STEP 4: Calculate specific targets
  const loadRemaining =
    weeklyTarget.targetLoad - history.weekToDateLoad;
  const targetLoad = Math.max(
    selectedTemplate.estimated_load_factor * 100,
    loadRemaining / (7 - dayOfWeek)
  );

  const targetDuration = Math.round(
    (selectedTemplate.duration_range_min + selectedTemplate.duration_range_max) / 2
  );

  // Estimate HR zones (if applicable)
  const maxHR = 190; // TODO: Get from user preferences
  const targetHRMin = selectedTemplate.intensity_zone
    ? Math.round(maxHR * 0.65)
    : null;
  const targetHRMax = selectedTemplate.intensity_zone
    ? Math.round(maxHR * 0.75)
    : null;

  // STEP 5: Build reasoning
  const factors: string[] = [];
  if (!canIntensity) factors.push(intensityReason);
  if (history.acwr.riskLevel !== "optimal")
    factors.push(`ACWR: ${history.acwr.riskLevel}`);
  if (recovery.compositeScore < 75)
    factors.push(`Recovery: ${recovery.compositeScore}/100`);
  if (recovery.dataQuality !== "measured")
    factors.push(`Data quality: ${recovery.dataQuality}`);
  factors.push(`Phase: ${phase.phase} week ${phase.weekNumber}`);

  const adaptationReason: AdaptationReason = {
    primary: canIntensity
      ? `Build ${phase.focusAreas[0]} in ${phase.phase} phase`
      : "Recovery priority - metrics indicate rest needed",
    factors,
    explanation: selectedTemplate.description,
  };

  const loadContext: LoadContext = {
    acwr: history.acwr.acwr,
    riskLevel: history.acwr.riskLevel,
    weeklyLoadTarget: weeklyTarget.targetLoad,
    weekToDateLoad: history.weekToDateLoad,
    loadRemaining,
    phase: phase.phase,
    weekNumber: phase.weekNumber,
  };

  // Preview next 3 days (placeholder - would use more logic)
  const nextThreeDays: DayPreview[] = [
    {
      date: new Date(
        new Date(date).getTime() + 86400000
      ).toISOString().split("T")[0]!,
      dayName: "Tomorrow",
      workoutType: "TBD",
      rationale: "Based on today's execution",
    },
  ];

  return {
    template: selectedTemplate,
    scheduledDate: date,
    scheduledTime: "06:00",
    targetDuration,
    targetDistance: null,
    targetLoad,
    intensityZone: selectedTemplate.intensity_zone ?? "z2",
    targetHRMin,
    targetHRMax,
    adaptationReason,
    readinessScore: recovery.compositeScore,
    loadContext,
    alternatives,
    nextThreeDays,
  };
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (import.meta.main) {
  console.log("🏃 Prescription Engine - Generating workout...\n");

  // TODO: Implement CLI interface
  console.log("Usage: prescription-engine.ts [date] [goal_id]");
  console.log("\nExample: prescription-engine.ts 2026-01-28 1");
}
