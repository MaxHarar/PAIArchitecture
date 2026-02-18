#!/usr/bin/env bun
/**
 * TRIMP Backfill Script
 *
 * Calculates and stores Banister TRIMP values for all existing workouts
 * that have heart rate data but no training_loads entry.
 *
 * This fixes the bug where ACWR shows 0.00 because training_loads table is empty.
 *
 * Usage:
 *   bun run trimp-backfill.ts              # Dry run - show what would be inserted
 *   bun run trimp-backfill.ts --execute    # Actually insert into database
 *   bun run trimp-backfill.ts --stats      # Show current database statistics
 */

import { Database } from "bun:sqlite";
import { calculateBanisterTRIMP, calculateSessionRPE, getHRZone } from "./load-calculator";

// =============================================================================
// CONFIGURATION
// =============================================================================

const DB_PATH = "/Users/maxharar/.claude/fitness/workouts.db";

// Default values when data is missing
const DEFAULTS = {
  restingHR: 60, // bpm - conservative default if no daily_metrics
  maxHR: 190, // bpm - will be overridden by observed max from workouts
  isMale: true, // affects TRIMP coefficient
  minValidHR: 60, // ignore workouts with avg HR below this (likely sensor errors)
};

// Activity type mappings for RPE estimation (when no HR data)
// Maps activity_type_id to estimated RPE based on typical intensity
const ACTIVITY_RPE_ESTIMATES: Record<number, number> = {
  // Running activities tend to be moderate-high intensity
  1: 6, // Running
  // Cycling
  2: 5, // Cycling
  // Weight training is highly variable
  3: 6, // Strength Training
  // Recovery activities
  4: 3, // Walking
  5: 3, // Yoga
  // HIIT is high intensity
  6: 8, // HIIT
  // Swimming
  7: 6, // Swimming
  // Default
  0: 5,
};

// =============================================================================
// TYPES
// =============================================================================

interface Workout {
  id: number;
  name: string;
  started_at: string;
  duration_seconds: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  perceived_exertion: number | null;
  activity_type_id: number | null;
}

interface DailyMetric {
  date: string;
  resting_heart_rate: number | null;
}

interface TRIMPResult {
  workout_id: number;
  load_value: number;
  calculation_method: string;
  hr_zones_used: string | null;
  metadata: {
    avg_hr: number | null;
    max_hr: number | null;
    resting_hr: number;
    duration_min: number;
    workout_name: string;
  };
}

// =============================================================================
// DATABASE HELPERS
// =============================================================================

function getDatabase(): Database {
  return new Database(DB_PATH);
}

function getWorkoutsWithoutTRIMP(db: Database): Workout[] {
  return db
    .prepare<[], Workout>(
      `
      SELECT
        w.id,
        w.name,
        w.started_at,
        w.duration_seconds,
        w.avg_heart_rate,
        w.max_heart_rate,
        w.perceived_exertion,
        w.activity_type_id
      FROM workouts w
      WHERE w.is_duplicate = 0
      AND NOT EXISTS (
        SELECT 1 FROM training_loads tl
        WHERE tl.workout_id = w.id AND tl.load_type = 'trimp'
      )
      ORDER BY w.started_at ASC
      `
    )
    .all();
}

function getDailyRestingHR(db: Database): Map<string, number> {
  const metrics = db
    .prepare<[], DailyMetric>(
      `
      SELECT date, resting_heart_rate
      FROM daily_metrics
      WHERE resting_heart_rate > 0
      ORDER BY date ASC
      `
    )
    .all();

  const map = new Map<string, number>();
  for (const m of metrics) {
    map.set(m.date, m.resting_heart_rate!);
  }
  return map;
}

function getObservedMaxHR(db: Database): number {
  const result = db
    .prepare<[], { max_hr: number }>(
      `SELECT MAX(max_heart_rate) as max_hr FROM workouts WHERE max_heart_rate > 0`
    )
    .get();

  return result?.max_hr || DEFAULTS.maxHR;
}

function getAverageRestingHR(restingHRMap: Map<string, number>): number {
  if (restingHRMap.size === 0) return DEFAULTS.restingHR;

  let sum = 0;
  for (const hr of restingHRMap.values()) {
    sum += hr;
  }
  return Math.round(sum / restingHRMap.size);
}

// =============================================================================
// TRIMP CALCULATION
// =============================================================================

function calculateTRIMPForWorkout(
  workout: Workout,
  restingHRMap: Map<string, number>,
  observedMaxHR: number,
  avgRestingHR: number
): TRIMPResult | null {
  const durationSeconds = workout.duration_seconds;

  // Skip workouts without duration
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  const durationMinutes = durationSeconds / 60;
  const workoutDate = workout.started_at.split("T")[0];

  // Get resting HR for this date, or use 7-day lookback, or use average
  let restingHR = restingHRMap.get(workoutDate);
  if (!restingHR) {
    // Try to find closest date within 7 days
    const date = new Date(workoutDate);
    for (let i = 1; i <= 7; i++) {
      const lookbackDate = new Date(date);
      lookbackDate.setDate(date.getDate() - i);
      const lookbackStr = lookbackDate.toISOString().split("T")[0];
      if (restingHRMap.has(lookbackStr)) {
        restingHR = restingHRMap.get(lookbackStr);
        break;
      }
    }
  }
  restingHR = restingHR || avgRestingHR;

  // Try Banister TRIMP first (requires HR data)
  if (
    workout.avg_heart_rate &&
    workout.avg_heart_rate >= DEFAULTS.minValidHR &&
    workout.max_heart_rate
  ) {
    // Use observed max HR from workouts, or per-workout max if higher
    const maxHR = Math.max(observedMaxHR, workout.max_heart_rate);

    // Validate that avg HR makes sense relative to max
    if (workout.avg_heart_rate < maxHR) {
      const trimp = calculateBanisterTRIMP(
        durationMinutes,
        workout.avg_heart_rate,
        restingHR,
        maxHR,
        DEFAULTS.isMale
      );

      if (trimp > 0) {
        // Calculate approximate zone for metadata
        const avgZone = getHRZone(workout.avg_heart_rate, maxHR);

        return {
          workout_id: workout.id,
          load_value: trimp,
          calculation_method: "banister_trimp",
          hr_zones_used: JSON.stringify({
            estimated_avg_zone: avgZone,
            avg_hr: workout.avg_heart_rate,
            max_hr: maxHR,
            resting_hr: restingHR,
          }),
          metadata: {
            avg_hr: workout.avg_heart_rate,
            max_hr: maxHR,
            resting_hr: restingHR,
            duration_min: Math.round(durationMinutes),
            workout_name: workout.name,
          },
        };
      }
    }
  }

  // Fallback to Session RPE if available
  if (workout.perceived_exertion && workout.perceived_exertion >= 1) {
    const load = calculateSessionRPE(durationMinutes, workout.perceived_exertion);

    if (load > 0) {
      return {
        workout_id: workout.id,
        load_value: load,
        calculation_method: "session_rpe",
        hr_zones_used: null,
        metadata: {
          avg_hr: workout.avg_heart_rate,
          max_hr: workout.max_heart_rate,
          resting_hr: restingHR,
          duration_min: Math.round(durationMinutes),
          workout_name: workout.name,
        },
      };
    }
  }

  // Final fallback: estimate RPE based on activity type
  const estimatedRPE = ACTIVITY_RPE_ESTIMATES[workout.activity_type_id || 0] || 5;
  const load = calculateSessionRPE(durationMinutes, estimatedRPE);

  if (load > 0) {
    return {
      workout_id: workout.id,
      load_value: load,
      calculation_method: "session_rpe_estimated",
      hr_zones_used: JSON.stringify({
        estimated_rpe: estimatedRPE,
        activity_type_id: workout.activity_type_id,
      }),
      metadata: {
        avg_hr: workout.avg_heart_rate,
        max_hr: workout.max_heart_rate,
        resting_hr: restingHR,
        duration_min: Math.round(durationMinutes),
        workout_name: workout.name,
      },
    };
  }

  return null;
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

function showStats(): void {
  const db = getDatabase();

  const workoutCount = db
    .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM workouts WHERE is_duplicate = 0")
    .get()!.count;

  const withHR = db
    .prepare<[], { count: number }>(
      "SELECT COUNT(*) as count FROM workouts WHERE is_duplicate = 0 AND avg_heart_rate > 0 AND max_heart_rate > 0"
    )
    .get()!.count;

  const trainingLoadsCount = db
    .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM training_loads")
    .get()!.count;

  const withTRIMP = db
    .prepare<[], { count: number }>(
      "SELECT COUNT(DISTINCT workout_id) as count FROM training_loads WHERE load_type = 'trimp'"
    )
    .get()!.count;

  console.log("\n=== Database Statistics ===\n");
  console.log(`Total workouts (non-duplicate): ${workoutCount}`);
  console.log(`Workouts with HR data:          ${withHR}`);
  console.log(`Training loads entries:         ${trainingLoadsCount}`);
  console.log(`Workouts with TRIMP:            ${withTRIMP}`);
  console.log(`Missing TRIMP:                  ${workoutCount - withTRIMP}`);

  if (trainingLoadsCount > 0) {
    const loadStats = db
      .prepare<[], { min_load: number; avg_load: number; max_load: number }>(
        "SELECT MIN(load_value) as min_load, AVG(load_value) as avg_load, MAX(load_value) as max_load FROM training_loads WHERE load_type = 'trimp'"
      )
      .get();

    if (loadStats) {
      console.log(`\n=== TRIMP Statistics ===\n`);
      console.log(`Min TRIMP:  ${loadStats.min_load?.toFixed(1) || "N/A"}`);
      console.log(`Avg TRIMP:  ${loadStats.avg_load?.toFixed(1) || "N/A"}`);
      console.log(`Max TRIMP:  ${loadStats.max_load?.toFixed(1) || "N/A"}`);
    }

    // Check ACWR
    const acuteLoad = db
      .prepare<[], { total: number }>(
        `
        SELECT COALESCE(SUM(tl.load_value), 0) as total
        FROM workouts w
        JOIN training_loads tl ON w.id = tl.workout_id AND tl.load_type = 'trimp'
        WHERE w.is_duplicate = 0
        AND date(w.started_at) >= date('now', '-7 days')
        `
      )
      .get()!.total;

    const chronicLoad = db
      .prepare<[], { total: number; days: number }>(
        `
        SELECT
          COALESCE(SUM(tl.load_value), 0) as total,
          COUNT(DISTINCT date(w.started_at)) as days
        FROM workouts w
        JOIN training_loads tl ON w.id = tl.workout_id AND tl.load_type = 'trimp'
        WHERE w.is_duplicate = 0
        AND date(w.started_at) >= date('now', '-28 days')
        `
      )
      .get()!;

    const chronicWeeklyAvg = chronicLoad.total / 4; // 4 weeks

    console.log(`\n=== ACWR Calculation ===\n`);
    console.log(`Acute Load (7 days):    ${acuteLoad.toFixed(1)}`);
    console.log(`Chronic Load (28 days): ${chronicLoad.total.toFixed(1)}`);
    console.log(`Chronic Weekly Avg:     ${chronicWeeklyAvg.toFixed(1)}`);
    if (chronicWeeklyAvg > 0) {
      const acwr = acuteLoad / chronicWeeklyAvg;
      console.log(`ACWR:                   ${acwr.toFixed(2)}`);
    } else {
      console.log(`ACWR:                   N/A (no chronic load)`);
    }
  }

  db.close();
}

function runBackfill(execute: boolean): void {
  const db = getDatabase();

  console.log("\n=== TRIMP Backfill ===\n");
  console.log(`Mode: ${execute ? "EXECUTE (writing to database)" : "DRY RUN (no changes)"}\n`);

  // Get data needed for calculations
  const workouts = getWorkoutsWithoutTRIMP(db);
  const restingHRMap = getDailyRestingHR(db);
  const observedMaxHR = getObservedMaxHR(db);
  const avgRestingHR = getAverageRestingHR(restingHRMap);

  console.log(`Workouts missing TRIMP: ${workouts.length}`);
  console.log(`Days with resting HR:   ${restingHRMap.size}`);
  console.log(`Observed max HR:        ${observedMaxHR} bpm`);
  console.log(`Average resting HR:     ${avgRestingHR} bpm\n`);

  // Calculate TRIMP for each workout
  const results: TRIMPResult[] = [];
  const skipped: { id: number; name: string; reason: string }[] = [];

  for (const workout of workouts) {
    const result = calculateTRIMPForWorkout(workout, restingHRMap, observedMaxHR, avgRestingHR);

    if (result) {
      results.push(result);
    } else {
      skipped.push({
        id: workout.id,
        name: workout.name,
        reason: "No duration or invalid data",
      });
    }
  }

  // Summary by method
  const byMethod: Record<string, number> = {};
  for (const r of results) {
    byMethod[r.calculation_method] = (byMethod[r.calculation_method] || 0) + 1;
  }

  console.log("=== Calculation Summary ===\n");
  console.log(`Total to insert: ${results.length}`);
  console.log(`Skipped:         ${skipped.length}`);
  console.log("\nBy method:");
  for (const [method, count] of Object.entries(byMethod)) {
    console.log(`  ${method}: ${count}`);
  }

  // Show sample results
  if (results.length > 0) {
    console.log("\n=== Sample Results (first 5) ===\n");
    for (const r of results.slice(0, 5)) {
      console.log(
        `  #${r.workout_id}: ${r.metadata.workout_name.slice(0, 30).padEnd(30)} ` +
          `| ${r.load_value.toFixed(1).padStart(6)} | ${r.calculation_method}`
      );
    }
  }

  // Execute if requested
  if (execute && results.length > 0) {
    console.log("\n=== Inserting into database ===\n");

    const insertStmt = db.prepare(`
      INSERT INTO training_loads (workout_id, load_type, load_value, calculation_method, hr_zones_used)
      VALUES (?, 'trimp', ?, ?, ?)
    `);

    let inserted = 0;
    let errors = 0;

    db.exec("BEGIN TRANSACTION");

    try {
      for (const r of results) {
        try {
          insertStmt.run(r.workout_id, r.load_value, r.calculation_method, r.hr_zones_used);
          inserted++;
        } catch (e) {
          errors++;
          console.error(`Error inserting workout ${r.workout_id}: ${e}`);
        }
      }

      db.exec("COMMIT");
      console.log(`Inserted: ${inserted}`);
      console.log(`Errors:   ${errors}`);
    } catch (e) {
      db.exec("ROLLBACK");
      console.error(`Transaction failed: ${e}`);
    }
  }

  db.close();
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--stats")) {
    showStats();
  } else if (args.includes("--execute")) {
    runBackfill(true);
    console.log("\n");
    showStats();
  } else {
    runBackfill(false);
    console.log("\n--- Dry run complete. Use --execute to apply changes. ---\n");
  }
}
