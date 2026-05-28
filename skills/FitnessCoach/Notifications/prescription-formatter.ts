#!/usr/bin/env bun
/**
 * Prescription Notification Formatter
 *
 * Formats workout prescriptions for Telegram delivery.
 * Human-readable morning notifications with workout details,
 * reasoning, and load context.
 */

import type {
  WorkoutPrescription,
  RecoveryMetrics,
  LoadContext,
} from "../Tools/prescription-engine.ts";

// =============================================================================
// TYPES
// =============================================================================

export interface TelegramMessage {
  text: string;
  parseMode: "HTML" | "Markdown";
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format duration in human-readable form
 */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format distance in human-readable form
 */
function formatDistance(meters: number | null): string {
  if (!meters) return "";
  const km = meters / 1000;
  if (km >= 1) {
    return `${km.toFixed(1)} km`;
  }
  return `${meters.toFixed(0)} m`;
}

/**
 * Get emoji for workout intensity
 */
function getIntensityEmoji(zone: string): string {
  const zoneMap: Record<string, string> = {
    z1: "🟢", // Recovery
    z2: "🔵", // Aerobic
    z3: "🟡", // Tempo
    z4: "🟠", // Threshold
    z5: "🔴", // VO2max
    varied: "🌈", // Mixed
  };
  return zoneMap[zone] ?? "⚪";
}

/**
 * Get emoji for readiness score
 */
function getReadinessEmoji(score: number): string {
  if (score >= 85) return "💪";
  if (score >= 75) return "✅";
  if (score >= 65) return "⚠️";
  if (score >= 50) return "🟡";
  return "🔴";
}

/**
 * Get emoji for ACWR risk level
 */
function getRiskEmoji(riskLevel: string): string {
  const riskMap: Record<string, string> = {
    very_low: "📉",
    low: "🟢",
    optimal: "✅",
    elevated: "⚠️",
    high: "🔴",
    very_high: "🚨",
  };
  return riskMap[riskLevel] ?? "⚪";
}

/**
 * Format time for display
 */
function formatTime(time: string | null): string {
  if (!time) return "Flexible";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours ?? "0");
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const dayName = days[date.getDay()];
  const month = months[date.getMonth()];
  const day = date.getDate();

  return `${dayName}, ${month} ${day}`;
}

// =============================================================================
// MAIN FORMATTER
// =============================================================================

/**
 * Format workout prescription for Telegram
 */
export function formatPrescriptionForTelegram(
  prescription: WorkoutPrescription,
  userName: string = "User"
): TelegramMessage {
  const intensity = getIntensityEmoji(prescription.intensityZone);
  const readiness = getReadinessEmoji(prescription.readinessScore);
  const risk = getRiskEmoji(prescription.loadContext.riskLevel);

  const duration = formatDuration(prescription.targetDuration);
  const distance = prescription.targetDistance
    ? formatDistance(prescription.targetDistance)
    : null;
  const time = formatTime(prescription.scheduledTime);
  const date = formatDate(prescription.scheduledDate);

  // Build HR zone info if available
  let hrZone = "";
  if (prescription.targetHRMin && prescription.targetHRMax) {
    hrZone = `\n🫀 Heart Rate: ${prescription.targetHRMin}-${prescription.targetHRMax} bpm`;
  }

  // Build distance info if available
  let distanceInfo = "";
  if (distance) {
    distanceInfo = ` • ${distance}`;
  }

  // Build the message
  const lines: string[] = [];

  // Header
  lines.push(`☀️ Good morning ${userName}!`);
  lines.push("");

  // Main workout block
  lines.push(`🏃 TODAY'S WORKOUT`);
  lines.push(`───────────────────────────────────────`);
  lines.push(`${intensity} <b>${prescription.template.name}</b>`);
  lines.push(`⏱️ ${duration}${distanceInfo}`);
  if (hrZone) lines.push(hrZone);
  lines.push(`🕐 Suggested: ${time}`);
  lines.push("");

  // Why block - reasoning
  lines.push(`📊 WHY THIS WORKOUT:`);
  lines.push(`${readiness} Recovery: ${prescription.readinessScore}/100`);
  lines.push(`${risk} Training Load: ${prescription.loadContext.riskLevel}`);
  lines.push(`📈 Phase: ${prescription.loadContext.phase} (week ${prescription.loadContext.weekNumber})`);
  lines.push("");
  lines.push(`<i>${prescription.adaptationReason.explanation}</i>`);
  lines.push("");

  // Load context
  const loadPercent = Math.round(
    (prescription.loadContext.weekToDateLoad / prescription.loadContext.weeklyLoadTarget) * 100
  );
  lines.push(`📉 WEEKLY LOAD STATUS`);
  lines.push(`Target: ${prescription.loadContext.weeklyLoadTarget} | Completed: ${prescription.loadContext.weekToDateLoad} (${loadPercent}%)`);
  lines.push(`ACWR: ${prescription.loadContext.acwr.toFixed(2)}`);
  lines.push("");

  // Alternatives
  if (prescription.alternatives.length > 0) {
    lines.push(`🔀 ALTERNATIVES (if needed):`);
    prescription.alternatives.forEach((alt, i) => {
      lines.push(`${i + 1}. ${alt.name}`);
    });
    lines.push("");
  }

  // Footer
  lines.push(`💡 Reply "done" when complete, "skip" if resting, or "hard"/"easy" for feedback.`);

  return {
    text: lines.join("\n"),
    parseMode: "HTML",
  };
}

/**
 * Format short reminder for workout
 */
export function formatWorkoutReminder(
  prescription: WorkoutPrescription,
  hoursUntil: number
): TelegramMessage {
  const intensity = getIntensityEmoji(prescription.intensityZone);
  const duration = formatDuration(prescription.targetDuration);

  const lines: string[] = [];
  lines.push(`⏰ WORKOUT REMINDER`);
  lines.push("");
  lines.push(`${intensity} <b>${prescription.template.name}</b> in ${hoursUntil} hours`);
  lines.push(`⏱️ ${duration}`);
  lines.push("");
  lines.push(`Ready to crush it? 💪`);

  return {
    text: lines.join("\n"),
    parseMode: "HTML",
  };
}

/**
 * Format completion confirmation
 */
export function formatCompletionMessage(
  workoutName: string,
  actualDuration: number,
  targetDuration: number,
  loadEarned: number
): TelegramMessage {
  const durationDiff = actualDuration - targetDuration;
  const durationPercent = Math.round((durationDiff / targetDuration) * 100);

  let durationNote = "";
  if (Math.abs(durationPercent) > 10) {
    if (durationDiff > 0) {
      durationNote = `\n📈 +${Math.abs(durationPercent)}% longer than planned`;
    } else {
      durationNote = `\n📉 ${Math.abs(durationPercent)}% shorter than planned`;
    }
  }

  const lines: string[] = [];
  lines.push(`✅ WORKOUT COMPLETED`);
  lines.push("");
  lines.push(`🎉 Nice work on <b>${workoutName}</b>!`);
  lines.push(`⏱️ Duration: ${formatDuration(actualDuration)}`);
  if (durationNote) lines.push(durationNote);
  lines.push(`📊 Training Load: +${loadEarned.toFixed(0)} TRIMP`);
  lines.push("");
  lines.push(`Recovery metrics will update tomorrow morning.`);

  return {
    text: lines.join("\n"),
    parseMode: "HTML",
  };
}

/**
 * Format feedback acknowledgment
 */
export function formatFeedbackAcknowledgment(
  feedback: "too_hard" | "too_easy" | "perfect",
  workoutName: string
): TelegramMessage {
  const responses: Record<typeof feedback, string[]> = {
    too_hard: [
      `📝 Noted: <b>${workoutName}</b> was too hard`,
      ``,
      `I'll adjust future prescriptions:`,
      `• Reduce intensity slightly`,
      `• Increase recovery time`,
      `• Monitor your readiness closely`,
      ``,
      `Recovery is where adaptation happens. Listen to your body! 💪`,
    ],
    too_easy: [
      `📝 Noted: <b>${workoutName}</b> was too easy`,
      ``,
      `I'll adjust future prescriptions:`,
      `• Increase intensity gradually`,
      `• Add volume when appropriate`,
      `• Push closer to your limits`,
      ``,
      `Great to hear you're ready for more! 🚀`,
    ],
    perfect: [
      `📝 Noted: <b>${workoutName}</b> was just right`,
      ``,
      `Perfect! That's the sweet spot we're aiming for.`,
      `I'll keep prescriptions at this level.`,
      ``,
      `Consistency at the right intensity = results 📈`,
    ],
  };

  return {
    text: responses[feedback].join("\n"),
    parseMode: "HTML",
  };
}

/**
 * Format rest day message
 */
export function formatRestDayMessage(
  reason: string,
  recovery: number
): TelegramMessage {
  const emoji = recovery < 60 ? "🛌" : "🧘";

  const lines: string[] = [];
  lines.push(`${emoji} REST DAY PRESCRIBED`);
  lines.push("");
  lines.push(`<b>Reason:</b> ${reason}`);
  lines.push(`📊 Recovery Score: ${recovery}/100`);
  lines.push("");
  lines.push(`Rest is not weakness—it's strategic adaptation.`);
  lines.push("");
  lines.push(`Focus today:`);
  lines.push(`• Sleep 8+ hours`);
  lines.push(`• Hydrate well`);
  lines.push(`• Light movement OK (walking, yoga)`);
  lines.push(`• Fuel properly`);
  lines.push("");
  lines.push(`Tomorrow's workout will be better for it! 💪`);

  return {
    text: lines.join("\n"),
    parseMode: "HTML",
  };
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (import.meta.main) {
  // Example usage
  const examplePrescription: WorkoutPrescription = {
    template: {
      id: 1,
      name: "Easy Aerobic Run",
      slug: "easy-run",
      category: "base_run",
      duration_range_min: 1800,
      duration_range_max: 3600,
      intensity_zone: "z2",
      target_rpe_low: 4,
      target_rpe_high: 5,
      requires_recovery_days: 0,
      max_per_week: 7,
      difficulty: "beginner",
      estimated_load_factor: 0.6,
      description: "Conversational pace, heart rate in Zone 2. Build aerobic base.",
    },
    scheduledDate: new Date().toISOString().split("T")[0]!,
    scheduledTime: "06:00",
    targetDuration: 2700, // 45 minutes
    targetDistance: 8000, // 8 km
    targetLoad: 150,
    intensityZone: "z2",
    targetHRMin: 130,
    targetHRMax: 145,
    adaptationReason: {
      primary: "Build aerobic base in base phase",
      factors: ["Phase: base week 4", "Recovery: 85/100"],
      explanation: "Conversational pace, heart rate in Zone 2. Build aerobic base.",
    },
    readinessScore: 85,
    loadContext: {
      acwr: 1.1,
      riskLevel: "optimal",
      weeklyLoadTarget: 500,
      weekToDateLoad: 200,
      loadRemaining: 300,
      phase: "base",
      weekNumber: 4,
    },
    alternatives: [
      {
        id: 2,
        name: "Recovery Run",
        slug: "recovery-run",
        category: "recovery",
        duration_range_min: 1200,
        duration_range_max: 1800,
        intensity_zone: "z1",
        target_rpe_low: 2,
        target_rpe_high: 3,
        requires_recovery_days: 0,
        max_per_week: 3,
        difficulty: "beginner",
        estimated_load_factor: 0.3,
        description: "Very easy pace for active recovery.",
      },
    ],
    nextThreeDays: [],
  };

  const message = formatPrescriptionForTelegram(examplePrescription);
  console.log("\n" + "=".repeat(60));
  console.log("TELEGRAM MESSAGE PREVIEW");
  console.log("=".repeat(60) + "\n");
  console.log(message.text);
  console.log("\n" + "=".repeat(60) + "\n");
}
