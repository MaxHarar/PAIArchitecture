/**
 * Sentinel Gateway -- Background Worker
 *
 * Manages autonomous background task execution. Accepts a task description,
 * spawns a Claude subprocess via the Agent SDK, tracks status, and notifies
 * Max on Telegram when complete.
 *
 * Concurrency limited to 3 simultaneous background tasks.
 * Completed task records are cleaned up after 1 hour.
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "os";
import { sendOutbound } from "./scheduler.ts";
import { broadcastToClients } from "./gateway.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackgroundTask {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 3;
const CLEANUP_AFTER_MS = 60 * 60 * 1000; // 1 hour
const MAX_RESULT_LENGTH = 4000; // Telegram message limit
const HOME = homedir();
const PREFIX = "[bg-worker]";

// ---------------------------------------------------------------------------
// Task Registry
// ---------------------------------------------------------------------------

const tasks: Map<string, BackgroundTask> = new Map();
const abortControllers: Map<string, AbortController> = new Map();
const cleanupTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit a new background task for execution.
 * Returns the task immediately with status "running".
 * The task runs asynchronously and notifies on completion.
 */
export function submitTask(
  description: string,
  options: {
    cwd?: string;
    source?: string;
    voice?: boolean;
  } = {},
): BackgroundTask {
  // Enforce concurrency limit
  const running = getRunningCount();
  if (running >= MAX_CONCURRENT) {
    const task: BackgroundTask = {
      id: crypto.randomUUID(),
      description,
      status: "failed",
      error: `Concurrency limit reached (${MAX_CONCURRENT} tasks running). Try again later.`,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      source: options.source ?? "api",
    };
    tasks.set(task.id, task);
    scheduleCleanup(task.id);
    return task;
  }

  const task: BackgroundTask = {
    id: crypto.randomUUID(),
    description,
    status: "running",
    startedAt: new Date().toISOString(),
    source: options.source ?? "api",
  };

  tasks.set(task.id, task);

  console.log(
    `${PREFIX} Task ${task.id.slice(0, 8)} started: "${description.slice(0, 80)}..."`,
  );

  // Fire-and-forget -- runs asynchronously
  executeTask(task, {
    cwd: options.cwd ?? `${HOME}/.claude`,
    voice: options.voice ?? false,
  }).catch((err) => {
    console.error(`${PREFIX} Unhandled error in task ${task.id.slice(0, 8)}:`, err);
  });

  return task;
}

/**
 * Get a specific task by ID.
 */
export function getTask(id: string): BackgroundTask | undefined {
  return tasks.get(id);
}

/**
 * List all tasks (optionally filtered by status).
 */
export function listTasks(
  filter?: BackgroundTask["status"],
): BackgroundTask[] {
  const all = Array.from(tasks.values());
  if (filter) return all.filter((t) => t.status === filter);
  return all;
}

/**
 * Cancel a running task by ID.
 * Returns true if the task was found and cancelled.
 */
export function cancelTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task || task.status !== "running") return false;

  const controller = abortControllers.get(id);
  if (controller) {
    controller.abort();
    abortControllers.delete(id);
  }

  task.status = "failed";
  task.error = "Cancelled by user";
  task.completedAt = new Date().toISOString();

  console.log(`${PREFIX} Task ${id.slice(0, 8)} cancelled`);

  scheduleCleanup(id);
  return true;
}

/**
 * Get the count of currently running tasks.
 */
export function getRunningCount(): number {
  let count = 0;
  for (const task of tasks.values()) {
    if (task.status === "running") count++;
  }
  return count;
}

/**
 * Clean shutdown -- cancel all running tasks.
 */
export function destroyAllTasks(): void {
  for (const [id, controller] of abortControllers) {
    controller.abort();
    const task = tasks.get(id);
    if (task && task.status === "running") {
      task.status = "failed";
      task.error = "Server shutting down";
      task.completedAt = new Date().toISOString();
    }
  }
  abortControllers.clear();

  for (const timer of cleanupTimers.values()) {
    clearTimeout(timer);
  }
  cleanupTimers.clear();

  console.log(`${PREFIX} All background tasks destroyed`);
}

// ---------------------------------------------------------------------------
// Private -- Task Execution
// ---------------------------------------------------------------------------

async function executeTask(
  task: BackgroundTask,
  options: { cwd: string; voice: boolean },
): Promise<void> {
  const controller = new AbortController();
  abortControllers.set(task.id, controller);

  // Broadcast task start to WS clients
  broadcastToClients(
    JSON.stringify({
      type: "background_task_started",
      taskId: task.id,
      description: task.description,
      timestamp: task.startedAt,
    }),
  );

  try {
    const result = await runClaudeQuery(task.description, {
      cwd: options.cwd,
      abortController: controller,
    });

    // Task completed successfully
    task.status = "completed";
    task.result = truncateResult(result);
    task.completedAt = new Date().toISOString();

    console.log(
      `${PREFIX} Task ${task.id.slice(0, 8)} completed (${task.result.length} chars)`,
    );

    // Notify Max on Telegram
    const notificationText = formatCompletionNotification(task);
    await sendOutbound(notificationText, {
      voice: options.voice,
      voiceText: options.voice
        ? `Background task completed: ${task.description.slice(0, 100)}`
        : undefined,
    });

    // Broadcast completion to WS clients
    broadcastToClients(
      JSON.stringify({
        type: "background_task_completed",
        taskId: task.id,
        timestamp: task.completedAt,
      }),
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // Distinguish abort from real errors
    if (controller.signal.aborted) {
      // Already handled by cancelTask()
      return;
    }

    task.status = "failed";
    task.error = errMsg.slice(0, 500);
    task.completedAt = new Date().toISOString();

    console.error(`${PREFIX} Task ${task.id.slice(0, 8)} failed: ${errMsg}`);

    // Notify Max about failure too
    const failureText = [
      "Background task failed.",
      "",
      `Task: ${task.description.slice(0, 200)}`,
      `Error: ${task.error}`,
    ].join("\n");

    await sendOutbound(failureText).catch((e) => {
      console.error(`${PREFIX} Failed to send failure notification:`, e);
    });

    // Broadcast failure to WS clients
    broadcastToClients(
      JSON.stringify({
        type: "background_task_failed",
        taskId: task.id,
        error: task.error,
        timestamp: task.completedAt,
      }),
    );
  } finally {
    abortControllers.delete(task.id);
    scheduleCleanup(task.id);
  }
}

/**
 * Run a Claude query using the Agent SDK.
 * This is the same approach used by brain.ts but runs independently
 * (separate session, no shared context).
 */
async function runClaudeQuery(
  prompt: string,
  options: { cwd: string; abortController: AbortController },
): Promise<string> {
  const claudePath =
    process.env.CLAUDE_CODE_PATH ||
    Bun.which("claude") ||
    `${HOME}/.local/bin/claude`;

  const sdkOptions: Options = {
    model: "claude-sonnet-4-5",
    cwd: options.cwd,
    settingSources: ["user", "project"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    systemPrompt: buildWorkerSystemPrompt(),
    pathToClaudeCodeExecutable: claudePath,
  };

  const responseParts: string[] = [];

  const queryInstance = query({
    prompt,
    options: {
      ...sdkOptions,
      abortController: options.abortController,
    },
  });

  for await (const event of queryInstance) {
    if (options.abortController.signal.aborted) {
      break;
    }

    if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "text") {
          responseParts.push(block.text);
        }
      }
    }
  }

  return responseParts.join("") || "Task completed but produced no text output.";
}

/**
 * Minimal system prompt for background workers.
 * These run independently -- they do not share the main brain session.
 */
function buildWorkerSystemPrompt(): string {
  return [
    "You are a background worker for Sentinel, an autonomous AI agent.",
    "You have been given a task to complete asynchronously.",
    "Execute the task efficiently and report your findings concisely.",
    "Keep your response under 3000 characters since it will be sent via Telegram.",
    "Do NOT use the PAI output format. Write plain, clear text.",
    "Focus on results and actionable information.",
    "",
    `Current time: ${new Date().toISOString()}`,
    `Working directory: ${HOME}/.claude`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateResult(text: string): string {
  if (text.length <= MAX_RESULT_LENGTH) return text;
  return text.slice(0, MAX_RESULT_LENGTH - 50) + "\n\n[...truncated]";
}

function formatCompletionNotification(task: BackgroundTask): string {
  const duration = task.completedAt
    ? Math.round(
        (new Date(task.completedAt).getTime() -
          new Date(task.startedAt).getTime()) /
          1000,
      )
    : 0;

  const parts = [
    "Background task completed.",
    "",
    `Task: ${task.description.slice(0, 200)}`,
    `Duration: ${duration}s`,
    "",
    task.result || "No output.",
  ];

  const full = parts.join("\n");
  return full.length > MAX_RESULT_LENGTH
    ? full.slice(0, MAX_RESULT_LENGTH - 30) + "\n\n[...truncated]"
    : full;
}

function scheduleCleanup(taskId: string): void {
  // Clear any existing timer
  const existing = cleanupTimers.get(taskId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    tasks.delete(taskId);
    cleanupTimers.delete(taskId);
    console.log(`${PREFIX} Cleaned up task record ${taskId.slice(0, 8)}`);
  }, CLEANUP_AFTER_MS);

  cleanupTimers.set(taskId, timer);
}
