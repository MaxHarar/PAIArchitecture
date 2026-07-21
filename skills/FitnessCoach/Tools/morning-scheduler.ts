#!/usr/bin/env bun
/**
 * Morning Workout Scheduler
 *
 * Automated daily script that generates workout prescription and sends
 * it to Telegram. Runs at 6:00 AM via LaunchAgent.
 *
 * Flow:
 * 1. Generate prescription using prescription engine
 * 2. Retrieve from database (today's date)
 * 3. Format using prescription-formatter
 * 4. Send via Telegram Bot API
 * 5. Log success/failure
 */

import { getDatabase } from "../../../fitness/src/db/client.ts";
import { prescribeWorkout } from "./prescription-engine.ts";
import {
  formatPrescriptionForTelegram,
  type TelegramMessage,
} from "../Notifications/prescription-formatter.ts";

// =============================================================================
// CONFIGURATION
// =============================================================================

// DEPRECATED: This file is replaced by orchestrate-morning.ts
// Telegram credentials now read from ~/.claude/settings.json (fitnessBot section)
const TELEGRAM_BOT_TOKEN = "REMOVED_USE_SETTINGS_JSON";
const TELEGRAM_CHAT_ID = "REMOVED_USE_SETTINGS_JSON";
const TELEGRAM_USER_ID = 0;
const LOG_FILE = "/tmp/fitness-morning-prescription.log";

// =============================================================================
// LOGGING
// =============================================================================

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(message);

  try {
    Bun.write(LOG_FILE, logLine, { createPath: true, append: true });
  } catch (error) {
    console.error("Failed to write to log file:", error);
  }
}

// =============================================================================
// TELEGRAM API
// =============================================================================

/**
 * Send message via Telegram Bot API
 */
async function sendTelegramMessage(
  chatId: string,
  message: TelegramMessage
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.text,
        parse_mode: message.parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      log(`❌ Telegram API error: ${response.status} - ${error}`);
      return false;
    }

    const result = await response.json();
    log(`✅ Message sent successfully (message_id: ${result.result?.message_id})`);
    return true;
  } catch (error) {
    log(`❌ Failed to send Telegram message: ${error}`);
    return false;
  }
}

// =============================================================================
// PRESCRIPTION RETRIEVAL
// =============================================================================

/**
 * Get today's prescription from database
 */
function getTodaysPrescription(db: any, date: string) {
  const prescription = db.queryOne<{
    id: number;
    name: string;
    description: string;
    scheduled_time: string | null;
    target_duration_seconds: number;
    target_distance_meters: number | null;
    intensity_zone: string;
    target_hr_min: number | null;
    target_hr_max: number | null;
    adaptation_reason: string;
    readiness_at_prescription: number;
    load_context: string;
    template_id: number;
  }>(
    `SELECT id, template_id, name, description, scheduled_time,
            target_duration_seconds, target_distance_meters,
            intensity_zone, target_hr_min, target_hr_max,
            adaptation_reason, readiness_at_prescription, load_context
     FROM workout_prescriptions
     WHERE scheduled_date = ?
     ORDER BY id DESC
     LIMIT 1`,
    [date]
  );

  return prescription;
}

/**
 * Get template for prescription
 */
function getTemplate(db: any, templateId: number) {
  return db.queryOne<{
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
  }>(
    `SELECT id, name, slug, category, duration_range_min, duration_range_max,
            intensity_zone, target_rpe_low, target_rpe_high,
            requires_recovery_days, max_per_week, difficulty,
            estimated_load_factor, description
     FROM workout_templates
     WHERE id = ?`,
    [templateId]
  );
}

/**
 * Get alternative workouts
 */
function getAlternatives(db: any, templateId: number, limit: number = 2) {
  return db.query<{
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
  }>(
    `SELECT id, name, slug, category, duration_range_min, duration_range_max,
            intensity_zone, target_rpe_low, target_rpe_high,
            requires_recovery_days, max_per_week, difficulty,
            estimated_load_factor, description
     FROM workout_templates
     WHERE id != ?
     ORDER BY RANDOM()
     LIMIT ?`,
    [templateId, limit]
  );
}

// =============================================================================
// MAIN LOGIC
// =============================================================================

async function main() {
  const today = new Date().toISOString().split("T")[0]!;
  const db = getDatabase();

  try {
    log("🌅 Starting morning workout scheduler");
    log(`📅 Date: ${today}`);

    // Check if prescription already exists for today
    let prescriptionData = getTodaysPrescription(db, today);

    // If no prescription exists, generate one
    if (!prescriptionData) {
      log("🔄 No prescription found for today - generating new one");

      const prescription = await prescribeWorkout(db, today, null);

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

      log(`✅ Prescription generated (ID: ${result?.id})`);

      // Retrieve the saved prescription
      prescriptionData = getTodaysPrescription(db, today);
    } else {
      log(`✅ Found existing prescription (ID: ${prescriptionData.id})`);
    }

    if (!prescriptionData) {
      log("❌ Failed to retrieve prescription after generation");
      process.exit(1);
    }

    // Get template and alternatives
    const template = getTemplate(db, prescriptionData.template_id);
    if (!template) {
      log("❌ Template not found for prescription");
      process.exit(1);
    }

    const alternatives = getAlternatives(db, prescriptionData.template_id, 2);

    // Reconstruct prescription object for formatter
    const prescription = {
      template,
      scheduledDate: today,
      scheduledTime: prescriptionData.scheduled_time,
      targetDuration: prescriptionData.target_duration_seconds,
      targetDistance: prescriptionData.target_distance_meters,
      targetLoad: 0, // Not stored in DB, not needed for formatting
      intensityZone: prescriptionData.intensity_zone,
      targetHRMin: prescriptionData.target_hr_min,
      targetHRMax: prescriptionData.target_hr_max,
      adaptationReason: JSON.parse(prescriptionData.adaptation_reason),
      readinessScore: prescriptionData.readiness_at_prescription,
      loadContext: JSON.parse(prescriptionData.load_context),
      alternatives,
      nextThreeDays: [], // Not needed for morning notification
    };

    // Format message
    log("📝 Formatting prescription for Telegram");
    const message = formatPrescriptionForTelegram(prescription);

    // Send to Telegram
    log("📤 Sending to Telegram");
    const success = await sendTelegramMessage(TELEGRAM_CHAT_ID, message);

    if (success) {
      log("🎉 Morning workout prescription sent successfully!");
      process.exit(0);
    } else {
      log("❌ Failed to send prescription to Telegram");
      process.exit(1);
    }
  } catch (error) {
    log(`❌ Error in morning scheduler: ${error}`);
    console.error(error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
