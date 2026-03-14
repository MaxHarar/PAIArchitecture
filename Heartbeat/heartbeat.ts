#!/usr/bin/env bun
/**
 * PAI Heartbeat - Autonomous Execution Loop
 *
 * The core "pulse" of Sentinel. Runs on three schedules:
 *
 *   REGULAR  (every 15 min) - Check integrations, run pending jobs, log
 *   DAILY    (6:00 AM)      - Morning report with metrics and focus items
 *   NIGHTLY  (11:00 PM)     - Reflect on day, identify automation opportunities
 *
 * Usage:
 *   bun run heartbeat.ts                          # Regular tick
 *   bun run heartbeat.ts --mode daily-review      # Morning report
 *   bun run heartbeat.ts --mode nightly-reflection # Evening reflection
 *   bun run heartbeat.ts --dry-run                # Log without acting
 *   bun run heartbeat.ts --test                   # Verify configuration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { logAction, logError, getDaySummary, getDayLog } from "./logger.ts";
import { canDo, escalate } from "./autonomy.ts";
import { sendTelegramMessage } from "./telegram.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

// Load .env from the claude directory (where secrets live)
const ENV_PATH = join(homedir(), ".claude", ".env");
if (existsSync(ENV_PATH)) {
  const envContent = readFileSync(ENV_PATH, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Also load the Telegram bot's .env for bot token and chat ID
const TELEGRAM_ENV_PATH = join(
  homedir(),
  ".claude",
  "claude-telegram-bot",
  ".env"
);
if (existsSync(TELEGRAM_ENV_PATH)) {
  const envContent = readFileSync(TELEGRAM_ENV_PATH, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_ALLOWED_USERS || "";
const SENTINEL_DIR = join(homedir(), "Sentinel");
const THOUGHTS_DIR = join(SENTINEL_DIR, "Thoughts");
const LOGS_DIR = join(SENTINEL_DIR, "Logs");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

type HeartbeatMode = "regular" | "daily-review" | "nightly-reflection";

interface CliArgs {
  mode: HeartbeatMode;
  dryRun: boolean;
  test: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let mode: HeartbeatMode = "regular";
  let dryRun = false;
  let test = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      const m = args[i + 1];
      if (
        m === "daily-review" ||
        m === "nightly-reflection" ||
        m === "regular"
      ) {
        mode = m;
      } else {
        console.error(`Unknown mode: ${m}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--test") {
      test = true;
    }
  }

  return { mode, dryRun, test };
}

// ---------------------------------------------------------------------------
// Configuration test
// ---------------------------------------------------------------------------

async function runConfigTest(): Promise<void> {
  console.log("=== PAI Heartbeat Configuration Test ===\n");

  // Check directories
  const dirs = [SENTINEL_DIR, THOUGHTS_DIR, LOGS_DIR];
  for (const dir of dirs) {
    const exists = existsSync(dir);
    console.log(`  ${exists ? "OK" : "MISSING"} ${dir}`);
    if (!exists) mkdirSync(dir, { recursive: true });
  }

  // Check Telegram credentials
  console.log(
    `\n  Telegram Bot Token: ${BOT_TOKEN ? "SET (" + BOT_TOKEN.slice(0, 8) + "...)" : "MISSING"}`
  );
  console.log(`  Telegram Chat ID:  ${CHAT_ID ? "SET" : "MISSING"}`);

  // Check Claude CLI
  const claudePath = Bun.which("claude");
  console.log(
    `\n  Claude CLI: ${claudePath ? "FOUND at " + claudePath : "NOT FOUND"}`
  );

  // Check autonomy framework
  console.log("\n  Autonomy framework:");
  console.log(`    read email       -> ${canDo("read email")}`);
  console.log(`    deploy to prod   -> ${canDo("deploy to production")}`);
  console.log(`    delete user data -> ${canDo("delete user data")}`);
  console.log(`    send briefing    -> ${canDo("send briefing")}`);
  console.log(`    post to X        -> ${canDo("post to twitter")}`);
  console.log(`    unknown action   -> ${canDo("something unknown")}`);

  // Check today's log
  const summary = getDaySummary();
  console.log(`\n  Today's log: ${summary.total} entries`);

  console.log("\n=== Configuration test complete ===");
}

// ---------------------------------------------------------------------------
// Claude inference helper
// ---------------------------------------------------------------------------

/**
 * Run a prompt through Claude CLI and return the text output.
 * Uses `claude -p` (print mode, no interactive session).
 */
async function claudeInfer(prompt: string, dryRun: boolean): Promise<string> {
  if (dryRun) {
    console.log(`[DRY RUN] Would run Claude inference: ${prompt.slice(0, 80)}...`);
    return "[dry run - no inference]";
  }

  try {
    const proc = Bun.spawn(["claude", "-p", prompt], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: homedir() },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      console.error(`Claude CLI error (exit ${proc.exitCode}): ${stderr}`);
      return `[inference error: exit ${proc.exitCode}]`;
    }

    return stdout.trim();
  } catch (err) {
    console.error(`Claude inference failed: ${err}`);
    return `[inference failed: ${err}]`;
  }
}

// ---------------------------------------------------------------------------
// Regular tick (every 15 minutes)
// ---------------------------------------------------------------------------

async function regularTick(dryRun: boolean): Promise<void> {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Regular heartbeat tick`);
  logAction("heartbeat_tick", "Regular 15-minute tick started", "success", undefined, "regular");

  // 1. Check integration health
  await checkIntegrationHealth(dryRun);

  // 2. Check for pending jobs / items needing attention
  await checkPendingItems(dryRun);

  const elapsed = Date.now() - startTime;
  logAction("heartbeat_complete", `Regular tick completed in ${elapsed}ms`, "success", undefined, "regular");
  console.log(`Heartbeat tick completed in ${elapsed}ms`);
}

/**
 * Service definitions for health monitoring.
 * Each service has a health check URL and a launchd label for restart.
 */
interface ServiceDef {
  name: string;
  url: string;
  launchdLabel: string;
  critical: boolean;  // Critical = alert Max immediately if restart fails
}

const SERVICES: ServiceDef[] = [
  {
    name: "gateway",
    url: "http://127.0.0.1:18800/health",
    launchdLabel: "com.pai.gateway",
    critical: true,
  },
  {
    name: "voice-server",
    url: "http://127.0.0.1:8888/health",
    launchdLabel: "com.pai.voice-server",
    critical: false,
  },
  {
    name: "kokoro-tts",
    url: "http://127.0.0.1:8000/health",
    launchdLabel: "",  // Started by voice server's start.sh
    critical: false,
  },
  {
    name: "telegram-bot",
    url: "",  // No HTTP endpoint — check via process
    launchdLabel: "com.claude-telegram-bot",
    critical: true,
  },
];

/**
 * Check if a service is healthy via HTTP or process check.
 */
async function isServiceHealthy(service: ServiceDef): Promise<boolean> {
  if (service.url) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(service.url, { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  // Process-based check for services without HTTP endpoints
  if (service.launchdLabel) {
    try {
      const proc = Bun.spawn(["launchctl", "list", service.launchdLabel], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Attempt to restart a service via launchctl.
 */
async function restartService(service: ServiceDef): Promise<boolean> {
  if (!service.launchdLabel) {
    console.log(`  No launchd label for ${service.name} — cannot auto-restart`);
    return false;
  }

  try {
    const uid = process.getuid?.() ?? 501;
    const proc = Bun.spawn(
      ["launchctl", "kickstart", "-k", `gui/${uid}/${service.launchdLabel}`],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;

    if (proc.exitCode === 0) {
      console.log(`  Restarted ${service.name} via launchctl`);
      return true;
    } else {
      const stderr = await new Response(proc.stderr).text();
      console.error(`  Failed to restart ${service.name}: ${stderr.trim()}`);
      return false;
    }
  } catch (err) {
    console.error(`  Restart error for ${service.name}: ${err}`);
    return false;
  }
}

/**
 * Send an alert to Max via the gateway /outbound endpoint.
 * Falls back to direct Telegram API if gateway is down.
 */
async function alertMax(message: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`[DRY RUN] Would alert Max: ${message}`);
    return;
  }

  // Try gateway first (preferred — consistent with all other notifications)
  try {
    const token = Bun.spawnSync([
      "security", "find-generic-password",
      "-a", "pai-gateway", "-s", "gateway-token", "-w",
    ]);
    const gatewayToken = new TextDecoder().decode(token.stdout).trim();

    if (gatewayToken) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch("http://127.0.0.1:18800/outbound", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({ text: message, voice: false }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) return;
    }
  } catch {
    // Gateway down — fall back to direct Telegram
  }

  // Fallback: direct Telegram API
  if (BOT_TOKEN && CHAT_ID) {
    await sendTelegramMessage(BOT_TOKEN, CHAT_ID, message);
  }
}

/**
 * Check that core PAI services are responsive.
 * Auto-restarts failed services and alerts Max if they stay down.
 */
async function checkIntegrationHealth(dryRun: boolean): Promise<void> {
  const failures: ServiceDef[] = [];

  for (const service of SERVICES) {
    if (dryRun) {
      console.log(`[DRY RUN] Would check ${service.name}`);
      logAction("health_check", `[dry run] ${service.name}`, "skipped", service.name, "regular");
      continue;
    }

    const healthy = await isServiceHealthy(service);

    if (healthy) {
      logAction("health_check", `${service.name} healthy`, "success", service.name, "regular");
      continue;
    }

    // Service is down — attempt restart
    console.log(`  ${service.name} is DOWN — attempting restart...`);
    logError("health_check", `${service.name} unreachable`, service.name);

    const restarted = await restartService(service);

    if (restarted) {
      // Wait 5 seconds then re-check
      await new Promise((r) => setTimeout(r, 5000));
      const nowHealthy = await isServiceHealthy(service);

      if (nowHealthy) {
        logAction("auto_restart", `${service.name} restarted successfully`, "success", service.name, "regular");
        console.log(`  ${service.name} is back up after restart`);
      } else {
        failures.push(service);
        logError("auto_restart", `${service.name} still down after restart`, service.name);
      }
    } else {
      failures.push(service);
    }
  }

  // Alert Max about persistent failures
  if (failures.length > 0 && !dryRun) {
    const failNames = failures.map((f) => f.name).join(", ");
    const critical = failures.some((f) => f.critical);
    const prefix = critical ? "CRITICAL" : "Warning";

    await alertMax(
      `${prefix}: ${failNames} still down after auto-restart attempt. Manual intervention may be needed.`,
      dryRun,
    );
  }
}

/**
 * Check for items that might need attention.
 */
async function checkPendingItems(dryRun: boolean): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const thoughtsFile = join(THOUGHTS_DIR, `${today}.md`);

  if (existsSync(thoughtsFile)) {
    logAction("pending_check", "Today's thoughts file exists", "success", "thoughts", "regular");
  }

  logAction("pending_check", "Pending items check complete", "success", undefined, "regular");
}

// ---------------------------------------------------------------------------
// Daily review (6:00 AM)
// ---------------------------------------------------------------------------

async function dailyReview(dryRun: boolean): Promise<void> {
  console.log(`[${new Date().toISOString()}] Daily review started`);
  logAction("daily_review", "Morning daily review started", "success", undefined, "daily-review");

  // Gather yesterday's metrics
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdaySummary = getDaySummary(yesterdayStr);

  // Build context for Claude
  const prompt = `You are Sentinel, Max's personal AI assistant. Generate a concise morning briefing.

Yesterday's heartbeat stats:
- Total actions: ${yesterdaySummary.total}
- Successes: ${yesterdaySummary.successes}
- Failures: ${yesterdaySummary.failures}
- Escalations: ${yesterdaySummary.escalations}
- Active integrations: ${Object.keys(yesterdaySummary.integrations).join(", ") || "none tracked"}

Today's date: ${new Date().toISOString().split("T")[0]}

Generate a brief morning report with:
1. Yesterday's system health summary (2-3 sentences)
2. Any issues that need attention
3. Top 5 focus suggestions for today based on what you know
4. A motivational note

Keep it under 300 words. Be direct and actionable.`;

  const report = await claudeInfer(prompt, dryRun);

  // Send to Telegram
  const level = canDo("send briefing");
  if (level === "autonomous") {
    if (!dryRun) {
      const header = `Good morning, Max.\n\n`;
      const sent = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, header + report);
      if (sent) {
        logAction("daily_review", "Morning report sent to Telegram", "success", "telegram", "daily-review");
      } else {
        logError("daily_review", "Failed to send morning report to Telegram", "telegram");
      }
    } else {
      console.log(`[DRY RUN] Would send daily review to Telegram:\n${report}`);
      logAction("daily_review", "[dry run] Morning report generated", "skipped", "telegram", "daily-review");
    }
  } else {
    // This should never happen since "send briefing" is autonomous, but just in case
    await escalate("send daily review", "Morning briefing report", BOT_TOKEN, CHAT_ID, dryRun);
  }

  logAction("daily_review", "Morning daily review completed", "success", undefined, "daily-review");
}

// ---------------------------------------------------------------------------
// Nightly reflection (11:00 PM)
// ---------------------------------------------------------------------------

async function nightlyReflection(dryRun: boolean): Promise<void> {
  console.log(`[${new Date().toISOString()}] Nightly reflection started`);
  logAction("nightly_reflection", "Nightly reflection started", "success", undefined, "nightly-reflection");

  // Gather today's full log
  const todayEntries = getDayLog();
  const todaySummary = getDaySummary();

  // Find entries where escalation happened (Max had to step in)
  const escalatedEntries = todayEntries.filter((e) => e.escalated);
  const failedEntries = todayEntries.filter((e) => e.outcome === "failure");

  const prompt = `You are Sentinel, Max's personal AI assistant. Perform an end-of-day reflection.

Today's heartbeat stats:
- Total actions: ${todaySummary.total}
- Successes: ${todaySummary.successes}
- Failures: ${todaySummary.failures}
- Escalations: ${todaySummary.escalations}

Escalated actions (Max had to decide):
${escalatedEntries.length > 0 ? escalatedEntries.map((e) => `- ${e.action_type}: ${e.details}`).join("\n") : "None today"}

Failed actions:
${failedEntries.length > 0 ? failedEntries.map((e) => `- ${e.action_type}: ${e.details}`).join("\n") : "None today"}

Active integrations: ${Object.entries(todaySummary.integrations).map(([k, v]) => `${k} (${v} actions)`).join(", ") || "none tracked"}

Write a nightly reflection covering:
1. Day summary (what went well, what didn't)
2. Patterns in escalations (could any be automated?)
3. Failure analysis (what broke and why)
4. Proposed automation improvements (specific, actionable)
5. System health assessment

Keep it focused and under 400 words. Use markdown formatting.`;

  const reflection = await claudeInfer(prompt, dryRun);

  // Write reflection to Thoughts directory
  const today = new Date().toISOString().split("T")[0];
  const thoughtsFile = join(THOUGHTS_DIR, `${today}.md`);

  if (!dryRun) {
    const header = `# Sentinel Nightly Reflection - ${today}\n\n`;
    const content = existsSync(thoughtsFile)
      ? readFileSync(thoughtsFile, "utf-8") + "\n\n---\n\n## Evening Reflection\n\n" + reflection
      : header + reflection;

    writeFileSync(thoughtsFile, content, "utf-8");
    logAction("nightly_reflection", `Reflection written to ${thoughtsFile}`, "success", "thoughts", "nightly-reflection");

    // Send full reflection to Telegram as readable plain text
    const telegramHeader = `📊 SENTINEL NIGHTLY REFLECTION\n${today}\n\n`;
    let telegramMessage = telegramHeader + reflection;

    // Telegram has 4096 char limit - truncate if needed
    const MAX_LENGTH = 4096;
    if (telegramMessage.length > MAX_LENGTH) {
      const truncated = telegramMessage.slice(0, MAX_LENGTH - 120);
      telegramMessage = truncated + "\n\n...(truncated)\n\nFull reflection: ~/Sentinel/Thoughts/" + today + ".md";
    }

    const sent = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, telegramMessage);
    if (!sent) {
      logError("nightly_reflection", "Failed to send nightly reflection to Telegram", "telegram");
    }
  } else {
    console.log(`[DRY RUN] Would write reflection to ${thoughtsFile}:\n${reflection}`);
    logAction("nightly_reflection", "[dry run] Reflection generated", "skipped", "thoughts", "nightly-reflection");
  }

  logAction("nightly_reflection", "Nightly reflection completed", "success", undefined, "nightly-reflection");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // Ensure directories exist
  for (const dir of [SENTINEL_DIR, THOUGHTS_DIR, LOGS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // --test: verify configuration and exit
  if (args.test) {
    await runConfigTest();
    return;
  }

  console.log(`PAI Heartbeat | mode=${args.mode} | dry-run=${args.dryRun}`);

  try {
    switch (args.mode) {
      case "regular":
        await regularTick(args.dryRun);
        break;
      case "daily-review":
        await dailyReview(args.dryRun);
        break;
      case "nightly-reflection":
        await nightlyReflection(args.dryRun);
        break;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError("heartbeat_fatal", errorMsg);
    console.error(`Heartbeat fatal error: ${errorMsg}`);

    // Try to notify Max of fatal errors
    if (BOT_TOKEN && CHAT_ID && !args.dryRun) {
      await sendTelegramMessage(
        BOT_TOKEN,
        CHAT_ID,
        `Sentinel Heartbeat Error (${args.mode}): ${errorMsg}`
      );
    }

    process.exit(1);
  }
}

main();
