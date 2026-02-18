#!/usr/bin/env bun
/**
 * Morning Orchestrator
 *
 * Single pipeline that replaces separate sync + prescription LaunchAgents.
 * Runs sequentially: Garmin sync → Prescription → Telegram delivery.
 *
 * SAFETY: On ANY failure, sends REST day message to Telegram.
 * Never leaves the athlete without guidance.
 *
 * Schedule: 5:30 AM daily via com.pai.fitness-morning LaunchAgent
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// =============================================================================
// CONFIGURATION
// =============================================================================

const HOME = homedir();
const SETTINGS_PATH = join(HOME, ".claude", "settings.json");
const LOG_DIR = join(HOME, ".claude", "fitness", "logs");
const LOG_FILE = join(LOG_DIR, "morning-orchestrator.log");
const SYNC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute timeout for Garmin sync

interface OrchestratorConfig {
  telegramBotToken: string;
  telegramChatId: string;
}

function loadOrchestratorConfig(): OrchestratorConfig {
  if (!existsSync(SETTINGS_PATH)) {
    throw new Error(`Settings file not found: ${SETTINGS_PATH}`);
  }

  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));

  // Use fitnessBot config for Telegram credentials
  const fitnessBot = settings.fitnessBot;
  if (!fitnessBot?.botToken || !fitnessBot?.chatId) {
    throw new Error("fitnessBot.botToken and fitnessBot.chatId required in settings.json");
  }

  return {
    telegramBotToken: fitnessBot.botToken,
    telegramChatId: fitnessBot.chatId,
  };
}

// =============================================================================
// LOGGING
// =============================================================================

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(message);

  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    appendFileSync(LOG_FILE, logLine);
  } catch {
    // Don't fail orchestrator on log write failure
  }
}

// =============================================================================
// TELEGRAM
// =============================================================================

async function sendTelegramMessage(
  config: OrchestratorConfig,
  text: string,
  parseMode: string = "HTML"
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        parse_mode: parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      log(`Telegram API error: ${response.status} - ${error}`);
      return false;
    }

    const result = await response.json() as { result?: { message_id?: number } };
    log(`Telegram message sent (id: ${result.result?.message_id})`);
    return true;
  } catch (error) {
    log(`Telegram send failed: ${error}`);
    return false;
  }
}

// =============================================================================
// STEP 1: GARMIN SYNC
// =============================================================================

async function runGarminSync(): Promise<{ success: boolean; error?: string }> {
  log("Step 1: Running Garmin sync...");

  try {
    // Import sync service dynamically
    const { GarminSyncService } = await import(
      join(HOME, ".claude", "fitness", "src", "services", "garmin", "sync.ts")
    );

    const syncService = new GarminSyncService();

    // Race sync against timeout
    const syncPromise = syncService.sync({ days: 3, verbose: false });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Garmin sync timed out after 5 minutes")), SYNC_TIMEOUT_MS)
    );

    const result = await Promise.race([syncPromise, timeoutPromise]);

    log(`Garmin sync complete: ${result.activitiesSynced} activities, ${result.metricsSynced} metrics`);

    if (result.errors.length > 0) {
      log(`Sync warnings: ${result.errors.slice(0, 3).join("; ")}`);
    }

    return { success: result.success || result.metricsSynced > 0 };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Garmin sync failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =============================================================================
// STEP 2: VERIFY FRESH DATA
// =============================================================================

async function verifyFreshData(): Promise<boolean> {
  log("Step 2: Verifying fresh daily_metrics data...");

  try {
    const { getDatabase } = await import(
      join(HOME, ".claude", "fitness", "src", "db", "client.ts")
    );

    const db = getDatabase();
    const today = new Date().toISOString().split("T")[0]!;

    const row = db.queryOne<{ date: string; sleep_score: number | null }>(
      `SELECT date, sleep_score FROM daily_metrics WHERE date = ?`,
      [today]
    );

    if (row && row.sleep_score !== null) {
      log(`Fresh data found for ${today}: sleep_score=${row.sleep_score}`);
      db.close();
      return true;
    }

    log(`No fresh data for ${today} — prescription engine will handle safely`);
    db.close();
    return false;
  } catch (error) {
    log(`Data verification failed: ${error}`);
    return false;
  }
}

// =============================================================================
// STEP 3: GENERATE PRESCRIPTION
// =============================================================================

interface PrescriptionResult {
  success: boolean;
  message?: { text: string; parseMode: string };
  error?: string;
}

async function generatePrescription(): Promise<PrescriptionResult> {
  log("Step 3: Generating prescription...");

  try {
    const { getDatabase } = await import(
      join(HOME, ".claude", "fitness", "src", "db", "client.ts")
    );
    const { prescribeWorkout } = await import(
      join(HOME, ".claude", "skills", "FitnessCoach", "Tools", "prescription-engine.ts")
    );
    const {
      formatPrescriptionForTelegram,
      formatRestDayMessage,
    } = await import(
      join(HOME, ".claude", "skills", "FitnessCoach", "Notifications", "prescription-formatter.ts")
    );

    const db = getDatabase();
    const today = new Date().toISOString().split("T")[0]!;

    const prescription = await prescribeWorkout(db, today, null);

    // Calculate race countdown
    const goal = db.queryOne<{ name: string; target_date: string | null }>(
      `SELECT name, target_date FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );

    let raceCountdown = "";
    if (goal?.target_date) {
      const daysUntil = Math.ceil(
        (new Date(goal.target_date).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntil > 0 && daysUntil <= 120) {
        raceCountdown = `\n\n🏁 <b>${daysUntil} days to ${goal.name}</b>`;
      }
    }

    // Format message
    let message: { text: string; parseMode: string };

    if (prescription.template.category === "rest" || prescription.targetLoad === 0) {
      // REST day — use rest formatter
      const restMsg = formatRestDayMessage(
        prescription.adaptationReason.primary,
        prescription.readinessScore
      );
      // Add ACWR context if dangerous
      let acwrWarning = "";
      if (prescription.loadContext.acwr > 1.5) {
        acwrWarning = `\n\n⚠️ <b>ACWR: ${prescription.loadContext.acwr.toFixed(2)}</b>\n` +
          `Your recent training load is much higher than what your body is adapted to. ` +
          `This is why rest is prescribed — to prevent injury.`;
      }
      message = {
        text: restMsg.text + acwrWarning + raceCountdown,
        parseMode: restMsg.parseMode,
      };
    } else {
      // Normal workout — use standard formatter
      const workoutMsg = formatPrescriptionForTelegram(prescription);
      message = {
        text: workoutMsg.text + raceCountdown,
        parseMode: workoutMsg.parseMode,
      };
    }

    // Save prescription to database
    const prescriptionDate = new Date(prescription.scheduledDate);
    const dayOfWeek = prescriptionDate.getDay();

    db.queryOne<{ id: number }>(
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

    log(`Prescription generated: ${prescription.template.name} (ACWR: ${prescription.loadContext.acwr.toFixed(2)})`);

    db.close();
    return { success: true, message };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Prescription failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =============================================================================
// MAIN ORCHESTRATOR
// =============================================================================

async function main(): Promise<void> {
  log("═══════════════════════════════════════════════════════");
  log("Morning Orchestrator starting");
  log(`Date: ${new Date().toISOString()}`);
  log("═══════════════════════════════════════════════════════");

  let config: OrchestratorConfig;
  try {
    config = loadOrchestratorConfig();
  } catch (error) {
    console.error(`Fatal: Could not load config: ${error}`);
    process.exit(1);
  }

  // STEP 1: Garmin Sync
  const syncResult = await runGarminSync();

  // STEP 2: Verify fresh data
  const hasData = await verifyFreshData();

  if (!syncResult.success) {
    log("Garmin sync failed — prescription engine will use safety defaults");
  }

  // STEP 3: Generate Prescription
  const prescriptionResult = await generatePrescription();

  // STEP 4: Send to Telegram
  if (prescriptionResult.success && prescriptionResult.message) {
    log("Step 4: Sending prescription to Telegram...");
    const sent = await sendTelegramMessage(
      config,
      prescriptionResult.message.text,
      prescriptionResult.message.parseMode
    );

    if (sent) {
      log("Morning orchestration complete — prescription delivered");
    } else {
      log("WARNING: Prescription generated but Telegram delivery failed");
    }
  } else {
    // Prescription generation failed — send fallback REST message
    log("Step 4: Prescription failed — sending REST fallback to Telegram...");

    const fallbackMessage =
      `🛌 REST DAY PRESCRIBED\n\n` +
      `<b>Reason:</b> Prescription system error\n` +
      `📊 Unable to generate today's prescription.\n\n` +
      `<b>Error:</b> ${prescriptionResult.error}\n\n` +
      `When in doubt, rest. Focus today:\n` +
      `• Sleep 8+ hours\n` +
      `• Hydrate well\n` +
      `• Light movement OK (walking, yoga)\n\n` +
      `The system will be checked and fixed. 💪`;

    await sendTelegramMessage(config, fallbackMessage);
  }

  log("═══════════════════════════════════════════════════════");
  log("Morning Orchestrator finished");
  log("═══════════════════════════════════════════════════════");
}

// Run
if (import.meta.main) {
  main().then(() => process.exit(0)).catch((error) => {
    log(`Fatal error: ${error}`);
    process.exit(1);
  });
}
