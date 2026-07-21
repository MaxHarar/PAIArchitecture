#!/usr/bin/env bun
/**
 * Periodization Engine
 *
 * Manages training periodization - the systematic planning of training phases
 * to optimize performance and prevent overtraining.
 *
 * Implements block periodization with 4 main phases:
 * - Base: Build aerobic foundation (6-12 weeks)
 * - Build: Increase event-specific training (4-8 weeks)
 * - Peak: Highest training stress (2-4 weeks)
 * - Taper: Reduce volume, maintain intensity (1-3 weeks)
 *
 * Based on sports science principles and coaching best practices.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Phase = "base" | "build" | "peak" | "taper" | "recovery";

export interface Goal {
  id: number;
  name: string;
  goal_type: string;
  target_date: string | null;
  start_date: string;
  target_value: number | null;
  target_unit: string | null;
}

export interface PeriodizationPhase {
  phase: Phase;
  weekNumber: number;
  totalWeeks: number;
  weeksIntoPhase: number;
  weeksRemainingInPhase: number;
  volumeTargetPercent: number;
  intensityTargetPercent: number;
  focusAreas: string[];
  description: string;
}

export interface WeeklyLoadTarget {
  targetLoad: number;
  volumePercent: number;
  intensityDistribution: {
    zone1: number; // % time in recovery
    zone2: number; // % time in aerobic
    zone3: number; // % time in tempo
    zone4: number; // % time in threshold
    zone5: number; // % time in VO2max
  };
  recommendedWorkoutMix: {
    easy: number;
    moderate: number;
    hard: number;
  };
}

// =============================================================================
// PHASE DETERMINATION
// =============================================================================

/**
 * Determine current periodization phase based on goal timeline
 *
 * Standard progression for race goals:
 * - Base Phase: 50% of total plan (building foundation)
 * - Build Phase: 30% of total plan (event-specific training)
 * - Peak Phase: 15% of total plan (maximum training stress)
 * - Taper Phase: 5% of total plan (reduce volume, maintain intensity)
 *
 * Example 12-week half marathon plan:
 * - Weeks 1-6: Base (50%)
 * - Weeks 7-9: Build (25%)
 * - Weeks 10-11: Peak (17%)
 * - Week 12: Taper (8%)
 *
 * @param goal - The primary training goal
 * @param currentDate - Current date (defaults to now)
 * @returns Current phase with week numbers and targets
 */
export function determinePeriodizationPhase(
  goal: Goal,
  currentDate: Date = new Date()
): PeriodizationPhase {
  // Parse dates
  const startDate = new Date(goal.start_date);
  const targetDate = goal.target_date ? new Date(goal.target_date) : null;

  // Calculate weeks elapsed and total weeks
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksElapsed = Math.floor(
    (currentDate.getTime() - startDate.getTime()) / msPerWeek
  );

  let totalWeeks = 12; // Default 12-week plan
  if (targetDate) {
    totalWeeks = Math.ceil(
      (targetDate.getTime() - startDate.getTime()) / msPerWeek
    );
  }

  // Constrain to reasonable range
  totalWeeks = Math.max(4, Math.min(52, totalWeeks));

  const weekNumber = Math.max(1, Math.min(weeksElapsed + 1, totalWeeks));

  // Determine phase based on progression
  const baseWeeks = Math.ceil(totalWeeks * 0.5);
  const buildWeeks = Math.ceil(totalWeeks * 0.3);
  const peakWeeks = Math.ceil(totalWeeks * 0.15);
  const taperWeeks = Math.max(1, totalWeeks - baseWeeks - buildWeeks - peakWeeks);

  let phase: Phase;
  let weeksIntoPhase: number;
  let weeksRemainingInPhase: number;
  let volumeTargetPercent: number;
  let intensityTargetPercent: number;
  let focusAreas: string[];
  let description: string;

  if (weekNumber <= baseWeeks) {
    // BASE PHASE
    phase = "base";
    weeksIntoPhase = weekNumber;
    weeksRemainingInPhase = baseWeeks - weekNumber;
    volumeTargetPercent = 60 + (weekNumber / baseWeeks) * 20; // 60-80%
    intensityTargetPercent = 60; // Low intensity in base
    focusAreas = ["aerobic_base", "endurance", "consistency"];
    description =
      "Building aerobic foundation. Focus on volume at low intensity. 80% easy pace.";
  } else if (weekNumber <= baseWeeks + buildWeeks) {
    // BUILD PHASE
    phase = "build";
    weeksIntoPhase = weekNumber - baseWeeks;
    weeksRemainingInPhase = baseWeeks + buildWeeks - weekNumber;
    volumeTargetPercent = 80 + (weeksIntoPhase / buildWeeks) * 20; // 80-100%
    intensityTargetPercent = 70 + (weeksIntoPhase / buildWeeks) * 10; // 70-80%
    focusAreas = ["tempo", "threshold", "race_pace", "event_specific"];
    description =
      "Building event-specific fitness. Increase tempo and threshold work. 70% easy, 20% moderate, 10% hard.";
  } else if (weekNumber <= baseWeeks + buildWeeks + peakWeeks) {
    // PEAK PHASE
    phase = "peak";
    weeksIntoPhase = weekNumber - baseWeeks - buildWeeks;
    weeksRemainingInPhase = baseWeeks + buildWeeks + peakWeeks - weekNumber;
    volumeTargetPercent = 90 + (weeksIntoPhase / peakWeeks) * 10; // 90-100%
    intensityTargetPercent = 80 + (weeksIntoPhase / peakWeeks) * 10; // 80-90%
    focusAreas = ["race_pace", "speed", "sharpening", "peak_fitness"];
    description =
      "Peak training stress. Maximum volume and intensity. Final fitness gains before taper.";
  } else {
    // TAPER PHASE
    phase = "taper";
    weeksIntoPhase = weekNumber - baseWeeks - buildWeeks - peakWeeks;
    weeksRemainingInPhase =
      totalWeeks - baseWeeks - buildWeeks - peakWeeks - weeksIntoPhase;

    // Progressive taper: reduce volume but maintain intensity
    const taperProgress = weeksIntoPhase / taperWeeks;
    volumeTargetPercent = 100 - taperProgress * 50; // 100% → 50%
    intensityTargetPercent = 85; // Maintain high intensity

    focusAreas = ["recovery", "sharpness", "race_readiness"];
    description =
      "Taper for race. Reduce volume 20-50%, maintain intensity. Prioritize rest and recovery.";
  }

  return {
    phase,
    weekNumber,
    totalWeeks,
    weeksIntoPhase,
    weeksRemainingInPhase,
    volumeTargetPercent: Math.round(volumeTargetPercent),
    intensityTargetPercent: Math.round(intensityTargetPercent),
    focusAreas,
    description,
  };
}

/**
 * Get weekly load target based on phase and deload schedule
 *
 * Calculates target weekly training load considering:
 * - Current periodization phase
 * - Progressive overload within phase
 * - Deload weeks (every 3-4 weeks, reduce volume 40-60%)
 * - Peak weekly load capacity
 *
 * @param phase - Current periodization phase info
 * @param peakWeeklyLoad - Maximum weekly load user can handle (from historical data)
 * @param currentWeek - Current week number in plan
 * @param isDeloadWeek - Whether this is a scheduled deload week
 * @returns Weekly load target with intensity distribution
 */
export function getWeeklyLoadTarget(
  phase: PeriodizationPhase,
  peakWeeklyLoad: number,
  currentWeek: number,
  isDeloadWeek: boolean = false
): WeeklyLoadTarget {
  // Base target from phase volume percent
  let baseTarget = (phase.volumeTargetPercent / 100) * peakWeeklyLoad;

  // Apply deload reduction if applicable
  if (isDeloadWeek) {
    baseTarget *= 0.5; // 50% reduction for deload
  }

  // Intensity distribution by phase
  let intensityDistribution: WeeklyLoadTarget["intensityDistribution"];
  let recommendedWorkoutMix: WeeklyLoadTarget["recommendedWorkoutMix"];

  switch (phase.phase) {
    case "base":
      // Base: 80% Z1-Z2 (easy), 15% Z3 (moderate), 5% Z4+ (hard)
      intensityDistribution = {
        zone1: 20,
        zone2: 60,
        zone3: 15,
        zone4: 5,
        zone5: 0,
      };
      recommendedWorkoutMix = {
        easy: 5, // 5 easy runs
        moderate: 1, // 1 tempo
        hard: 0, // 0 intervals
      };
      break;

    case "build":
      // Build: 70% Z1-Z2, 20% Z3, 10% Z4+
      intensityDistribution = {
        zone1: 15,
        zone2: 55,
        zone3: 20,
        zone4: 8,
        zone5: 2,
      };
      recommendedWorkoutMix = {
        easy: 4,
        moderate: 2,
        hard: 1,
      };
      break;

    case "peak":
      // Peak: 65% Z1-Z2, 20% Z3, 15% Z4+
      intensityDistribution = {
        zone1: 10,
        zone2: 55,
        zone3: 20,
        zone4: 10,
        zone5: 5,
      };
      recommendedWorkoutMix = {
        easy: 4,
        moderate: 2,
        hard: 2,
      };
      break;

    case "taper":
      // Taper: Reduce volume but maintain intensity
      intensityDistribution = {
        zone1: 10,
        zone2: 50,
        zone3: 20,
        zone4: 15,
        zone5: 5,
      };
      recommendedWorkoutMix = {
        easy: 2,
        moderate: 1,
        hard: 1,
      };
      break;

    case "recovery":
      // Recovery: All easy
      intensityDistribution = {
        zone1: 30,
        zone2: 70,
        zone3: 0,
        zone4: 0,
        zone5: 0,
      };
      recommendedWorkoutMix = {
        easy: 4,
        moderate: 0,
        hard: 0,
      };
      break;
  }

  return {
    targetLoad: Math.round(baseTarget),
    volumePercent: phase.volumeTargetPercent,
    intensityDistribution,
    recommendedWorkoutMix,
  };
}

/**
 * Determine if current week should be a deload week
 *
 * Deload every 3-4 weeks to allow for supercompensation.
 * Avoid deload during peak phase or taper.
 *
 * @param weekNumber - Current week in training plan
 * @param phase - Current phase
 * @param lastDeloadWeek - Week number of last deload (0 if never)
 * @returns True if this week should be a deload
 */
export function shouldDeload(
  weekNumber: number,
  phase: Phase,
  lastDeloadWeek: number = 0
): boolean {
  // Never deload during peak or taper
  if (phase === "peak" || phase === "taper") {
    return false;
  }

  // First 2 weeks of plan, never deload
  if (weekNumber <= 2) {
    return false;
  }

  // Deload every 3-4 weeks
  const weeksSinceDeload = weekNumber - lastDeloadWeek;
  return weeksSinceDeload >= 3;
}

/**
 * Calculate progressive overload multiplier
 *
 * Within each phase, apply progressive overload:
 * - Week 1 of phase: 100% of phase target
 * - Week 2: 105%
 * - Week 3: 110%
 * - Week 4: 115%
 * - Then deload or move to next phase
 *
 * @param weeksIntoPhase - How many weeks into current phase
 * @param isDeloadWeek - Whether this is a deload week
 * @returns Multiplier for base phase target (1.0-1.15)
 */
export function getProgressiveOverloadMultiplier(
  weeksIntoPhase: number,
  isDeloadWeek: boolean
): number {
  if (isDeloadWeek) {
    return 0.5; // 50% reduction
  }

  // 5% increase per week within phase
  const multiplier = 1.0 + (weeksIntoPhase - 1) * 0.05;

  // Cap at 15% increase
  return Math.min(1.15, Math.max(1.0, multiplier));
}

/**
 * Get phase-specific workout recommendations
 *
 * Returns prioritized list of workout types appropriate for current phase.
 *
 * @param phase - Current periodization phase
 * @returns Ordered array of recommended workout types
 */
export function getPhaseWorkoutRecommendations(phase: Phase): string[] {
  switch (phase) {
    case "base":
      return [
        "easy_run",
        "long_run",
        "recovery_run",
        "light_strength",
        "core_mobility",
      ];

    case "build":
      return [
        "tempo_run",
        "easy_run",
        "long_run",
        "fartlek",
        "strength_full",
      ];

    case "peak":
      return [
        "intervals",
        "tempo_run",
        "progression_run",
        "easy_run",
        "hill_repeats",
      ];

    case "taper":
      return [
        "easy_run",
        "short_intervals", // Short, sharp sessions to maintain fitness
        "recovery_run",
        "yoga_flow",
        "rest_day",
      ];

    case "recovery":
      return ["recovery_run", "yoga_flow", "active_recovery", "rest_day"];
  }
}

/**
 * Estimate peak weekly load from historical data
 *
 * Analyzes past training to determine user's capacity for weekly load.
 * Used as baseline for periodization calculations.
 *
 * Takes 95th percentile of historical weekly loads to avoid outliers.
 *
 * @param historicalWeeklyLoads - Array of past weekly training loads
 * @returns Estimated peak weekly load user can handle
 */
export function estimatePeakWeeklyLoad(
  historicalWeeklyLoads: number[]
): number {
  if (historicalWeeklyLoads.length === 0) {
    return 500; // Default baseline for new users
  }

  // Sort and take 95th percentile to avoid outliers
  const sorted = [...historicalWeeklyLoads].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  const peakLoad = sorted[index] ?? 500;

  // Ensure reasonable minimum
  return Math.max(300, peakLoad);
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "phase") {
    // Example: phase "2026-01-01" "2026-04-01"
    const startDate = args[1] ?? new Date().toISOString().split("T")[0];
    const targetDate = args[2];

    const mockGoal: Goal = {
      id: 1,
      name: "Half Marathon",
      goal_type: "race",
      start_date: startDate,
      target_date: targetDate ?? null,
      target_value: 21.1,
      target_unit: "km",
    };

    const phase = determinePeriodizationPhase(mockGoal);

    console.log(`\n📅 PERIODIZATION PHASE`);
    console.log(`─────────────────────────────────────`);
    console.log(`Phase: ${phase.phase.toUpperCase()}`);
    console.log(`Week: ${phase.weekNumber} of ${phase.totalWeeks}`);
    console.log(
      `Progress: ${phase.weeksIntoPhase} weeks into ${phase.phase}, ${phase.weeksRemainingInPhase} remaining`
    );
    console.log(`Volume Target: ${phase.volumeTargetPercent}%`);
    console.log(`Intensity Target: ${phase.intensityTargetPercent}%`);
    console.log(`Focus: ${phase.focusAreas.join(", ")}`);
    console.log(`\n${phase.description}\n`);
  } else if (command === "load") {
    // Example: load 500 3 base
    const peakLoad = parseFloat(args[1] ?? "500");
    const weekNumber = parseInt(args[2] ?? "1");
    const phaseName = (args[3] ?? "base") as Phase;

    const mockPhase: PeriodizationPhase = {
      phase: phaseName,
      weekNumber,
      totalWeeks: 12,
      weeksIntoPhase: weekNumber % 4 || 1,
      weeksRemainingInPhase: 3,
      volumeTargetPercent: 70,
      intensityTargetPercent: 60,
      focusAreas: [],
      description: "",
    };

    const isDeload = shouldDeload(weekNumber, phaseName, 0);
    const loadTarget = getWeeklyLoadTarget(mockPhase, peakLoad, weekNumber, isDeload);

    console.log(`\n📊 WEEKLY LOAD TARGET`);
    console.log(`─────────────────────────────────────`);
    console.log(`Target Load: ${loadTarget.targetLoad}`);
    console.log(`Volume: ${loadTarget.volumePercent}%`);
    console.log(`Is Deload: ${isDeload ? "Yes" : "No"}`);
    console.log(`\nIntensity Distribution:`);
    console.log(`  Zone 1 (Recovery): ${loadTarget.intensityDistribution.zone1}%`);
    console.log(`  Zone 2 (Aerobic): ${loadTarget.intensityDistribution.zone2}%`);
    console.log(`  Zone 3 (Tempo): ${loadTarget.intensityDistribution.zone3}%`);
    console.log(`  Zone 4 (Threshold): ${loadTarget.intensityDistribution.zone4}%`);
    console.log(`  Zone 5 (VO2max): ${loadTarget.intensityDistribution.zone5}%`);
    console.log(`\nWorkout Mix:`);
    console.log(`  Easy: ${loadTarget.recommendedWorkoutMix.easy}`);
    console.log(`  Moderate: ${loadTarget.recommendedWorkoutMix.moderate}`);
    console.log(`  Hard: ${loadTarget.recommendedWorkoutMix.hard}\n`);
  } else {
    console.log(`Periodization Engine

Usage:
  periodization-engine.ts phase <start_date> <target_date>
    Determine current periodization phase
    Example: periodization-engine.ts phase "2026-01-01" "2026-04-01"

  periodization-engine.ts load <peak_load> <week_number> <phase>
    Calculate weekly load target
    Example: periodization-engine.ts load 500 3 base

Examples:
  periodization-engine.ts phase "2026-01-01" "2026-04-01"
  periodization-engine.ts load 500 3 base
`);
  }
}
