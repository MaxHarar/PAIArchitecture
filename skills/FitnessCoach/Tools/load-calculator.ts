#!/usr/bin/env bun
/**
 * Training Load Calculator
 *
 * Implements multiple training load calculation methods:
 * - Banister TRIMP (Training Impulse) - heart rate-based
 * - Edwards' TRIMP - simplified zone-based
 * - Session RPE - rating of perceived exertion
 * - ACWR (Acute:Chronic Workload Ratio) - injury risk predictor
 *
 * Based on sports science research for optimal training load management.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface HRZone {
  zoneNumber: number; // 1-5
  timeSeconds: number;
}

export interface ACWRResult {
  acwr: number;
  riskLevel:
    | "very_low"
    | "low"
    | "optimal"
    | "elevated"
    | "high"
    | "very_high";
  injuryRiskMultiplier: number;
  recommendation: string;
}

export interface LoadCalculationResult {
  load: number;
  method: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// BANISTER TRIMP
// =============================================================================

/**
 * Calculate Banister TRIMP (Training Impulse)
 *
 * Formula: Duration (min) × ΔHR ratio × e^(b × ΔHR ratio)
 * Where ΔHR ratio = (HR_avg - HR_rest) / (HR_max - HR_rest)
 *
 * This method accounts for exponential increase in training stress at higher intensities.
 *
 * @param durationMinutes - Workout duration in minutes
 * @param avgHR - Average heart rate during workout (bpm)
 * @param restingHR - Resting heart rate (bpm)
 * @param maxHR - Maximum heart rate (bpm)
 * @param isMale - Gender affects the exponential coefficient (default: true)
 * @returns TRIMP value (arbitrary units, typically 20-200 for most workouts)
 */
export function calculateBanisterTRIMP(
  durationMinutes: number,
  avgHR: number,
  restingHR: number,
  maxHR: number,
  isMale: boolean = true
): number {
  // Validate inputs
  if (
    durationMinutes <= 0 ||
    avgHR <= 0 ||
    restingHR <= 0 ||
    maxHR <= 0 ||
    avgHR <= restingHR ||
    maxHR <= avgHR
  ) {
    return 0;
  }

  // Calculate fractional elevation in HR (0-1)
  const hrReserve = maxHR - restingHR;
  const deltaHRRatio = (avgHR - restingHR) / hrReserve;

  // Clamp to valid range
  const clampedRatio = Math.max(0, Math.min(1, deltaHRRatio));

  // Gender-specific coefficient for exponential weighting
  // Males: 1.92, Females: 1.67 (Banister 1991)
  const b = isMale ? 1.92 : 1.67;

  // TRIMP = Duration × ΔHR% × e^(b × ΔHR%)
  const trimp = durationMinutes * clampedRatio * Math.exp(b * clampedRatio);

  return Math.round(trimp * 10) / 10; // Round to 1 decimal
}

// =============================================================================
// EDWARDS' TRIMP
// =============================================================================

/**
 * Calculate Edwards' TRIMP (Simplified Zone-Based)
 *
 * Multipliers by HR zone:
 * - Zone 1 (50-60% max HR): 1x
 * - Zone 2 (60-70% max HR): 2x
 * - Zone 3 (70-80% max HR): 3x
 * - Zone 4 (80-90% max HR): 4x
 * - Zone 5 (90-100% max HR): 5x
 *
 * TRIMP = Σ(time_in_zone_minutes × zone_multiplier)
 *
 * Simpler than Banister, good for quick calculations and when you have zone data.
 *
 * @param hrZones - Array of time spent in each HR zone
 * @returns Edwards' TRIMP value
 */
export function calculateEdwardsTRIMP(hrZones: HRZone[]): number {
  let trimp = 0;

  for (const zone of hrZones) {
    const timeMinutes = zone.timeSeconds / 60;
    const multiplier = zone.zoneNumber; // Zone 1 = 1x, Zone 2 = 2x, etc.

    trimp += timeMinutes * multiplier;
  }

  return Math.round(trimp * 10) / 10;
}

// =============================================================================
// SESSION RPE
// =============================================================================

/**
 * Calculate Session RPE (sRPE) Load
 *
 * Formula: Duration (minutes) × RPE (1-10)
 *
 * Simple but effective for strength training where HR is less reliable.
 * User rates entire session on 1-10 scale, multiply by duration.
 *
 * Example:
 * - 60 minute workout rated 7/10 = 420 load units
 * - 45 minute workout rated 8/10 = 360 load units
 *
 * @param durationMinutes - Workout duration in minutes
 * @param rpe - Rate of Perceived Exertion (1-10 scale)
 * @returns sRPE load value
 */
export function calculateSessionRPE(
  durationMinutes: number,
  rpe: number
): number {
  // Validate inputs
  if (durationMinutes <= 0 || rpe < 1 || rpe > 10) {
    return 0;
  }

  return Math.round(durationMinutes * rpe);
}

// =============================================================================
// ACWR (ACUTE:CHRONIC WORKLOAD RATIO)
// =============================================================================

/**
 * Calculate ACWR (Acute:Chronic Workload Ratio)
 *
 * Acute Load: 7-day rolling sum (what you've done recently)
 * Chronic Load: 28-day rolling average (what you're adapted to)
 * ACWR = Acute / Chronic
 *
 * Risk Zones (Gabbett 2016):
 * - < 0.8: Undertraining/detraining risk
 * - 0.8-1.3: OPTIMAL - "sweet spot" for adaptation
 * - 1.3-1.5: Elevated risk - monitor closely
 * - > 1.5: HIGH RISK - 2-4x injury likelihood
 *
 * The ratio indicates if you're doing too much, too soon relative to what
 * your body is adapted to handle.
 *
 * @param last7DaysLoad - Array of daily load values for past 7 days [today, yesterday, ...]
 * @param last28DaysLoad - Array of daily load values for past 28 days
 * @returns ACWR result with risk assessment and recommendations
 */
export function calculateACWR(
  last7DaysLoad: number[],
  last28DaysLoad: number[]
): ACWRResult {
  // Validate inputs
  if (last7DaysLoad.length === 0 || last28DaysLoad.length === 0) {
    return {
      acwr: 0,
      riskLevel: "very_low",
      injuryRiskMultiplier: 1.0,
      recommendation: "Insufficient data to calculate ACWR",
    };
  }

  // Calculate acute load (7-day sum)
  const acuteLoad = last7DaysLoad.reduce((sum, load) => sum + load, 0);

  // Calculate chronic load (28-day average)
  const chronicSum = last28DaysLoad.reduce((sum, load) => sum + load, 0);
  const chronicLoad = chronicSum / last28DaysLoad.length;

  // Avoid division by zero
  if (chronicLoad === 0) {
    return {
      acwr: 0,
      riskLevel: "very_low",
      injuryRiskMultiplier: 1.0,
      recommendation: "No chronic training load baseline - build base first",
    };
  }

  // Calculate ratio
  const acwr = acuteLoad / chronicLoad;

  // Determine risk level and recommendations
  let riskLevel:
    | "very_low"
    | "low"
    | "optimal"
    | "elevated"
    | "high"
    | "very_high";
  let injuryRiskMultiplier: number;
  let recommendation: string;

  if (acwr < 0.5) {
    riskLevel = "very_low";
    injuryRiskMultiplier = 1.2;
    recommendation =
      "Very low training load - significant detraining risk. Consider increasing volume gradually.";
  } else if (acwr < 0.8) {
    riskLevel = "low";
    injuryRiskMultiplier = 1.1;
    recommendation =
      "Below optimal training load. Room to increase volume for better adaptation.";
  } else if (acwr >= 0.8 && acwr <= 1.3) {
    riskLevel = "optimal";
    injuryRiskMultiplier = 1.0;
    recommendation =
      "OPTIMAL - Sweet spot for adaptation. Training load well-balanced with recovery capacity.";
  } else if (acwr > 1.3 && acwr <= 1.5) {
    riskLevel = "elevated";
    injuryRiskMultiplier = 2.0;
    recommendation =
      "Elevated risk - acute spike in training. Consider easy workouts only, monitor recovery closely.";
  } else if (acwr > 1.5 && acwr <= 2.0) {
    riskLevel = "high";
    injuryRiskMultiplier = 4.0;
    recommendation =
      "HIGH RISK - 2-4x injury likelihood. Strong recommendation for rest or very easy recovery only.";
  } else {
    riskLevel = "very_high";
    injuryRiskMultiplier = 5.0;
    recommendation =
      "VERY HIGH RISK - Extreme acute spike. Mandatory rest. Likely overreaching or overtraining.";
  }

  return {
    acwr: Math.round(acwr * 100) / 100, // Round to 2 decimals
    riskLevel,
    injuryRiskMultiplier,
    recommendation,
  };
}

// =============================================================================
// TRAINING MONOTONY & STRAIN
// =============================================================================

/**
 * Calculate Training Monotony
 *
 * Monotony = Average Daily Load / Standard Deviation of Daily Load
 *
 * High monotony (>2.0) indicates lack of training variation, which can
 * lead to overtraining even if total load is reasonable.
 *
 * @param dailyLoads - Array of daily load values for the week
 * @returns Monotony score (typically 0.5-3.0)
 */
export function calculateMonotony(dailyLoads: number[]): number {
  if (dailyLoads.length === 0) return 0;

  const mean = dailyLoads.reduce((sum, load) => sum + load, 0) / dailyLoads.length;

  if (mean === 0) return 0;

  // Calculate standard deviation
  const squaredDiffs = dailyLoads.map((load) => Math.pow(load - mean, 2));
  const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / dailyLoads.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 999; // Perfectly monotonous (all same values)

  const monotony = mean / stdDev;

  return Math.round(monotony * 100) / 100;
}

/**
 * Calculate Training Strain
 *
 * Strain = Weekly Load × Monotony
 *
 * Combines total load with variation. High strain (>3000) with high monotony
 * is a red flag for overtraining.
 *
 * @param weeklyLoad - Total load for the week
 * @param monotony - Monotony score from calculateMonotony()
 * @returns Strain score
 */
export function calculateStrain(weeklyLoad: number, monotony: number): number {
  return Math.round(weeklyLoad * monotony);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Estimate Maximum Heart Rate
 *
 * Multiple formulas available:
 * - Traditional: 220 - age (outdated, often inaccurate)
 * - Tanaka: 208 - (0.7 × age) (more accurate for adults)
 * - Gellish: 207 - (0.7 × age) (similar to Tanaka)
 * - HUNT: 211 - (0.64 × age) (best for sedentary individuals)
 *
 * Note: These are estimates. Actual max HR can vary ±10-15 bpm.
 * Best to use field-tested max HR if available.
 *
 * @param age - Age in years
 * @param formula - Which formula to use (default: 'tanaka')
 * @returns Estimated max HR in bpm
 */
export function estimateMaxHR(
  age: number,
  formula: "traditional" | "tanaka" | "gellish" | "hunt" = "tanaka"
): number {
  switch (formula) {
    case "traditional":
      return 220 - age;
    case "tanaka":
      return Math.round(208 - 0.7 * age);
    case "gellish":
      return Math.round(207 - 0.7 * age);
    case "hunt":
      return Math.round(211 - 0.64 * age);
  }
}

/**
 * Calculate HR Zone from BPM
 *
 * Standard 5-zone model based on % of max HR:
 * - Zone 1: 50-60% (Recovery)
 * - Zone 2: 60-70% (Aerobic base)
 * - Zone 3: 70-80% (Tempo)
 * - Zone 4: 80-90% (Threshold)
 * - Zone 5: 90-100% (VO2max)
 *
 * @param currentHR - Current heart rate in bpm
 * @param maxHR - Maximum heart rate in bpm
 * @returns Zone number (1-5)
 */
export function getHRZone(currentHR: number, maxHR: number): number {
  const percent = (currentHR / maxHR) * 100;

  if (percent < 60) return 1;
  if (percent < 70) return 2;
  if (percent < 80) return 3;
  if (percent < 90) return 4;
  return 5;
}

/**
 * Convert HR zones time distribution to Edwards' TRIMP
 *
 * Helper function to convert workout with HR zone data to TRIMP.
 *
 * @param hrZoneData - Object with time in seconds for each zone
 * @returns Edwards' TRIMP value
 */
export function hrZoneDataToTRIMP(hrZoneData: {
  zone1?: number;
  zone2?: number;
  zone3?: number;
  zone4?: number;
  zone5?: number;
}): number {
  const zones: HRZone[] = [
    { zoneNumber: 1, timeSeconds: hrZoneData.zone1 ?? 0 },
    { zoneNumber: 2, timeSeconds: hrZoneData.zone2 ?? 0 },
    { zoneNumber: 3, timeSeconds: hrZoneData.zone3 ?? 0 },
    { zoneNumber: 4, timeSeconds: hrZoneData.zone4 ?? 0 },
    { zoneNumber: 5, timeSeconds: hrZoneData.zone5 ?? 0 },
  ];

  return calculateEdwardsTRIMP(zones);
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "banister":
    case "trimp": {
      const duration = parseFloat(args[1] ?? "0");
      const avgHR = parseInt(args[2] ?? "0");
      const restingHR = parseInt(args[3] ?? "60");
      const maxHR = parseInt(args[4] ?? "180");
      const isMale = args[5] !== "female";

      const trimp = calculateBanisterTRIMP(
        duration,
        avgHR,
        restingHR,
        maxHR,
        isMale
      );
      console.log(`Banister TRIMP: ${trimp}`);
      break;
    }

    case "edwards": {
      // Example: edwards 10:0 20:300 30:600 40:900 50:300
      const zones: HRZone[] = [];
      for (let i = 1; i < args.length; i++) {
        const [zone, time] = args[i]?.split(":") ?? [];
        if (zone && time) {
          zones.push({
            zoneNumber: parseInt(zone) / 10,
            timeSeconds: parseInt(time),
          });
        }
      }
      const trimp = calculateEdwardsTRIMP(zones);
      console.log(`Edwards' TRIMP: ${trimp}`);
      break;
    }

    case "rpe":
    case "srpe": {
      const duration = parseFloat(args[1] ?? "0");
      const rpe = parseInt(args[2] ?? "0");
      const load = calculateSessionRPE(duration, rpe);
      console.log(`Session RPE Load: ${load}`);
      break;
    }

    case "acwr": {
      const acute = args[1]?.split(",").map((x) => parseFloat(x)) ?? [];
      const chronic = args[2]?.split(",").map((x) => parseFloat(x)) ?? [];

      const result = calculateACWR(acute, chronic);
      console.log(`ACWR: ${result.acwr}`);
      console.log(`Risk Level: ${result.riskLevel}`);
      console.log(`Injury Risk: ${result.injuryRiskMultiplier}x`);
      console.log(`Recommendation: ${result.recommendation}`);
      break;
    }

    case "monotony": {
      const loads = args[1]?.split(",").map((x) => parseFloat(x)) ?? [];
      const monotony = calculateMonotony(loads);
      console.log(`Training Monotony: ${monotony}`);
      break;
    }

    default:
      console.log(`Training Load Calculator

Usage:
  load-calculator.ts banister <duration> <avgHR> <restingHR> <maxHR> [male|female]
    Calculate Banister TRIMP

  load-calculator.ts edwards <zone:time> ...
    Calculate Edwards' TRIMP from zone data
    Example: edwards 1:0 2:300 3:600 4:900 5:300

  load-calculator.ts rpe <duration> <rpe>
    Calculate Session RPE load

  load-calculator.ts acwr <acute_loads> <chronic_loads>
    Calculate ACWR with injury risk
    Example: acwr "50,60,70,80,90,100,110" "60,65,70,75,80,..."

  load-calculator.ts monotony <daily_loads>
    Calculate training monotony
    Example: monotony "50,60,70,80,90,100,110"

Examples:
  load-calculator.ts banister 45 160 60 190
  load-calculator.ts rpe 60 7
  load-calculator.ts acwr "50,60,70,80,90,100,110" "55,58,62,65,68,70,72,..."
`);
  }
}
