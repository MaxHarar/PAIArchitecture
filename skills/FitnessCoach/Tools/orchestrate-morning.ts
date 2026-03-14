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
// STEP 3: GENERATE PRESCRIPTION (saves to DB for briefing to read)
// =============================================================================

async function generatePrescription(): Promise<{ success: boolean; error?: string }> {
  log("Step 3: Generating workout prescription...");

  try {
    const { getDatabase } = await import(
      join(HOME, ".claude", "fitness", "src", "db", "client.ts")
    );
    const { prescribeWorkout } = await import(
      join(HOME, ".claude", "skills", "FitnessCoach", "Tools", "prescription-engine.ts")
    );

    const db = getDatabase();
    const today = new Date().toISOString().split("T")[0]!;

    const prescription = await prescribeWorkout(db, today, null);

    // Save prescription to database so briefing.ts can read it
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

    log(`Prescription saved: ${prescription.template.name} (ACWR: ${prescription.loadContext.acwr.toFixed(2)}, readiness: ${prescription.readinessScore})`);
    db.close();
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Prescription generation failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =============================================================================
// STEP 4: RUN FULL DAILY BRIEFING
// =============================================================================
// The DailyBriefing orchestrator (briefing.ts) reads the prescription from the DB
// (saved in Step 3) and assembles the full morning message:
// - Garmin health data display
// - Workout prescription (from DB)
// - Hero insight (wisdom from historical figures)
// - AI news (Hacker News + Reddit ML)
// - TELOS goals with progress bars
// - Calendar events
// - Sends the consolidated message to Telegram

const BRIEFING_SCRIPT = join(
  HOME, ".claude", "skills", "DailyBriefing", "Tools", "briefing.ts"
);

interface BriefingResult {
  success: boolean;
  error?: string;
}

async function runDailyBriefing(): Promise<BriefingResult> {
  log("Step 4: Running full daily briefing (health + prescription + hero + news + TELOS)...");

  try {
    const proc = Bun.spawn(["bun", "run", BRIEFING_SCRIPT], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000, // 2 min timeout for news fetching + AI summarization
      env: { ...process.env, GARMIN_ALREADY_SYNCED: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      log(`Briefing script failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      return { success: false, error: stderr.slice(0, 200) };
    }

    if (stdout.trim()) log(`Briefing output: ${stdout.trim().slice(0, 200)}`);
    log("Full daily briefing sent successfully");
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Briefing failed: ${errorMsg}`);
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
    log("Garmin sync failed — briefing will use safety defaults");
  }

  // STEP 3: Generate prescription (saves to DB for briefing to read)
  const rxResult = await generatePrescription();
  if (!rxResult.success) {
    log("Prescription failed — briefing will show without workout section");
  }

  // STEP 4: Run full daily briefing (reads prescription from DB + health + hero + news + TELOS)
  const briefingResult = await runDailyBriefing();

  if (briefingResult.success) {
    log("Morning orchestration complete — full briefing delivered");
  } else {
    // Briefing failed — send fallback REST message via direct Telegram API
    log("Step 5: Briefing failed — sending REST fallback to Telegram...");

    const fallbackMessage =
      `🛌 REST DAY PRESCRIBED\n\n` +
      `<b>Reason:</b> Morning briefing system error\n` +
      `📊 Unable to generate today's briefing.\n\n` +
      `<b>Error:</b> ${briefingResult.error}\n\n` +
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
