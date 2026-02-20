/**
 * AutoMemoryExtract Handler
 *
 * Triggers Phase 1 of AutoMemory extraction in the background after
 * every Nth main session response. Non-blocking — spawns a detached
 * process so it never slows down the current session.
 *
 * Frequency: Every 50th Stop event (to avoid running on every response).
 * When it fires: Processes up to 10 unprocessed sessions via Haiku.
 */

import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const AUTO_DIR = join(CLAUDE_DIR, "MEMORY", "LEARNING", "AUTO");
const COUNTER_FILE = join(AUTO_DIR, "hook-counter.json");
const TRIGGER_EVERY = 50; // Run extraction every N stop events

interface CounterState {
  count: number;
  lastTriggered: string;
}

function loadCounter(): CounterState {
  if (existsSync(COUNTER_FILE)) {
    try {
      return JSON.parse(readFileSync(COUNTER_FILE, "utf-8"));
    } catch {
      // Corrupted — reset
    }
  }
  return { count: 0, lastTriggered: "" };
}

function saveCounter(state: CounterState): void {
  if (!existsSync(AUTO_DIR)) {
    mkdirSync(AUTO_DIR, { recursive: true });
  }
  writeFileSync(COUNTER_FILE, JSON.stringify(state));
}

/**
 * Check if we should trigger extraction, and if so, spawn a detached process.
 * Completely non-blocking — returns immediately.
 */
export async function handleAutoMemoryExtract(): Promise<void> {
  const counter = loadCounter();
  counter.count++;

  if (counter.count >= TRIGGER_EVERY) {
    counter.count = 0;
    counter.lastTriggered = new Date().toISOString();
    saveCounter(counter);

    // Spawn detached process — does not block the hook
    const toolPath = join(CLAUDE_DIR, "skills", "PAI", "Tools", "AutoMemory.ts");
    if (!existsSync(toolPath)) return;

    // Build env without CLAUDECODE to allow nested claude calls
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("bun", ["run", "--bun", toolPath, "--limit", "10", "phase1"], {
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();

    console.error("[AutoMemoryExtract] Triggered background extraction (every 50th stop event)");
  } else {
    saveCounter(counter);
  }
}
