#!/usr/bin/env bun
/**
 * background-task -- Submit, list, or cancel background tasks via the Gateway.
 *
 * Usage:
 *   bun background-task.ts "Research competitor pricing for AI coding tools"
 *   bun background-task.ts --voice "Task with voice notification on completion"
 *   bun background-task.ts --cwd /path/to/dir "Task in specific directory"
 *   bun background-task.ts --status                  # List all tasks
 *   bun background-task.ts --cancel <task-id>        # Cancel a running task
 *
 * This tool calls the gateway's /background endpoint.
 * Authentication is handled automatically via macOS Keychain.
 */

import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Get gateway token from Keychain
// ---------------------------------------------------------------------------

function getToken(): string {
  try {
    return execSync(
      'security find-generic-password -a "pai-gateway" -s "gateway-token" -w 2>/dev/null',
      { encoding: "utf-8" },
    ).trim();
  } catch {
    console.error("Failed to read gateway token from Keychain");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let voice = false;
let showStatus = false;
let cancelId: string | null = null;
let cwd: string | null = null;
const textParts: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--voice" || arg === "-v") {
    voice = true;
  } else if (arg === "--status" || arg === "-s") {
    showStatus = true;
  } else if (arg === "--cancel" || arg === "-c") {
    cancelId = args[++i];
  } else if (arg === "--cwd" || arg === "-d") {
    cwd = args[++i];
  } else if (arg === "--help" || arg === "-h") {
    printUsage();
    process.exit(0);
  } else {
    textParts.push(arg);
  }
}

const task = textParts.join(" ").trim();

function printUsage(): void {
  console.log(`background-task -- Submit, list, or cancel background tasks

Usage:
  bun background-task.ts <task description>       Submit a task
  bun background-task.ts --voice <description>    Submit with voice notification
  bun background-task.ts --cwd /path <description> Submit with working directory
  bun background-task.ts --status                  List all tasks
  bun background-task.ts --cancel <id>             Cancel a running task
  bun background-task.ts --help                    Show this help`);
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

const token = getToken();
const baseUrl = "http://127.0.0.1:18800";
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  Host: "127.0.0.1:18800",
};

async function submitTask(): Promise<void> {
  if (!task) {
    console.error("Error: No task description provided.");
    printUsage();
    process.exit(1);
  }

  const body: Record<string, unknown> = { task };
  if (cwd) body.cwd = cwd;
  if (voice) body.voice = voice;

  try {
    const res = await fetch(`${baseUrl}/background`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (res.ok) {
      console.log(`Task submitted successfully.`);
      console.log(`  ID:     ${data.taskId}`);
      console.log(`  Status: ${data.status}`);
      console.log(`  Task:   ${task.slice(0, 80)}${task.length > 80 ? "..." : ""}`);
      console.log(`\nThe task is running in the background. You will be notified on Telegram when it completes.`);
    } else {
      console.error("Failed to submit task:", JSON.stringify(data));
      process.exit(1);
    }
  } catch (err) {
    console.error("Error connecting to gateway:", err);
    console.error("Is the gateway running? Check: curl http://127.0.0.1:18800/health");
    process.exit(1);
  }
}

async function listTasks(): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/background`, {
      method: "GET",
      headers,
    });

    const data = (await res.json()) as {
      tasks: Array<{
        id: string;
        description: string;
        status: string;
        startedAt: string;
        completedAt?: string;
        error?: string;
      }>;
      running: number;
      total: number;
    };

    if (!res.ok) {
      console.error("Failed to list tasks:", JSON.stringify(data));
      process.exit(1);
    }

    console.log(`Background Tasks (${data.running} running, ${data.total} total)\n`);

    if (data.tasks.length === 0) {
      console.log("No background tasks.");
      return;
    }

    for (const t of data.tasks) {
      const statusIcon =
        t.status === "running"
          ? "[RUNNING]"
          : t.status === "completed"
            ? "[DONE]   "
            : "[FAILED] ";

      const elapsed = t.completedAt
        ? `${Math.round((new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()) / 1000)}s`
        : `${Math.round((Date.now() - new Date(t.startedAt).getTime()) / 1000)}s ago`;

      console.log(`${statusIcon} ${t.id.slice(0, 8)}  ${elapsed.padEnd(8)}  ${t.description.slice(0, 60)}`);
      if (t.error) {
        console.log(`           Error: ${t.error.slice(0, 80)}`);
      }
    }
  } catch (err) {
    console.error("Error connecting to gateway:", err);
    process.exit(1);
  }
}

async function cancelTaskById(id: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/background`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (res.ok && data.cancelled) {
      console.log(`Task ${id.slice(0, 8)} cancelled.`);
    } else if (!data.cancelled) {
      console.error(`Task ${id.slice(0, 8)} not found or not running.`);
      process.exit(1);
    } else {
      console.error("Failed:", JSON.stringify(data));
      process.exit(1);
    }
  } catch (err) {
    console.error("Error connecting to gateway:", err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (showStatus) {
    await listTasks();
  } else if (cancelId) {
    await cancelTaskById(cancelId);
  } else {
    await submitTask();
  }
}

main();
