#!/usr/bin/env bun
/**
 * Daily Prescription Sender
 *
 * Triggered by LaunchAgent at 6 AM.
 * Generates prescription, formats for Telegram, sends directly via API.
 *
 * Note: TypeScript may show import errors for cross-project paths,
 * but these resolve correctly at runtime with Bun.
 */

import { join } from "path";

// Use absolute paths for cross-project imports
const HOME = process.env.HOME || process.env.USERPROFILE || "~";

// Dynamic imports for cross-project modules
const { getDatabase } = await import(join(HOME, ".claude/fitness/src/db/client.ts"));
const { prescribeWorkout } = await import(join(HOME, ".claude/skills/FitnessCoach/Tools/prescription-engine.ts"));
const { formatPrescriptionForTelegram } = await import(join(HOME, ".claude/skills/FitnessCoach/Notifications/prescription-formatter.ts"));
const { saveFitnessState } = await import(join(HOME, ".claude/claude-telegram-bot/src/handlers/fitness-state.ts"));

// =============================================================================
// CONFIGURATION
// =============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

if (!TELEGRAM_CHAT_ID) {
  console.error("❌ TELEGRAM_CHAT_ID not set");
  process.exit(1);
}

if (!TELEGRAM_USER_ID) {
  console.error("❌ TELEGRAM_USER_ID not set");
  process.exit(1);
}

// =============================================================================
// TELEGRAM API
// =============================================================================

/**
 * Send message via Telegram API
 */
async function sendTelegramMessage(
  text: string,
  parseMode: "HTML" | "Markdown"
): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: parseMode,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Telegram API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const result = await response.json();
  console.log(`📱 Message sent to chat ${TELEGRAM_CHAT_ID} (message_id: ${result.result.message_id})`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const db = getDatabase();

  try {
    const today = new Date().toISOString().split("T")[0]!;

    console.log(`🏃 Generating prescription for ${today}...`);

    // Check if prescription already sent today
    const existing = db.queryOne<{ id: number }>(
      `SELECT id FROM workout_prescriptions
       WHERE scheduled_date = ? AND status = 'prescribed'`,
      [today]
    );

    if (existing) {
      console.log(
        `✅ Prescription already exists for ${today} (ID: ${existing.id})`
      );
      console.log(`💾 Updating state for user ${TELEGRAM_USER_ID}...`);

      // Update state even if prescription exists (in case state was lost)
      const userId = parseInt(TELEGRAM_USER_ID);
      await saveFitnessState(userId, existing.id);

      console.log(`✅ State updated`);
      return;
    }

    // Generate prescription
    const prescription = await prescribeWorkout(db, today, null);

    console.log(`✅ Prescription generated: ${prescription.template.name}`);

    // Calculate day_of_week (0=Sunday, 6=Saturday)
    const prescriptionDate = new Date(prescription.scheduledDate);
    const dayOfWeek = prescriptionDate.getDay();

    // Save to database
    const result = db.queryOne<{ id: number }>(
      `INSERT INTO workout_prescriptions (
        template_id, scheduled_date, scheduled_time, day_of_week, slot,
        name, description, target_duration_seconds, target_distance_meters,
        target_load, intensity_zone, target_hr_min, target_hr_max,
        adaptation_reason, readiness_at_prescription, load_context,
        status
      ) VALUES (?, ?, ?, ?, 'primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prescribed')
      RETURNING id`,
      [
        prescription.template.id,
        prescription.scheduledDate,
        prescription.scheduledTime,
        dayOfWeek,
        prescription.template.name,
        prescription.template.description,
        prescription.targetDuration,
        prescription.targetDistance,
        prescription.targetLoad,
        prescription.intensityZone,
        prescription.targetHRMin,
        prescription.targetHRMax,
        JSON.stringify(prescription.adaptationReason),
        prescription.readinessScore,
        JSON.stringify(prescription.loadContext),
      ]
    );

    if (!result) {
      throw new Error("Failed to insert prescription into database");
    }

    const prescriptionId = result.id;
    console.log(`✅ Prescription saved (ID: ${prescriptionId})`);

    // NOTE: DailyBriefing bot will handle sending the prescription in the morning briefing
    // This script ONLY generates and saves the prescription to the database
    console.log(`✅ Prescription generated and saved (will be sent via DailyBriefing bot)`);
  } catch (error) {
    console.error("❌ Error sending daily prescription:", error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run main function
main();
