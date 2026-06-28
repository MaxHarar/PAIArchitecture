# PAIArchitecture Hook System

## Overview
Hooks in `PAIArchitecture` are small TypeScript programs that intercept Claude Code lifecycle events. Each hook receives an event payload on `stdin`, inspects the structured JSON input for that event, and writes its result to `stdout`, usually as a JSON decision or a reminder that changes how the session proceeds.

This repository uses hooks to gate tool calls, keep session state in sync, update terminal state, and persist working-memory artifacts around a Claude Code session. The event boundary stays consistent even when the hook behavior differs: Claude Code invokes the hook for a lifecycle event, passes the payload on `stdin`, and consumes the hook output before moving to the next step.

## Lifecycle Events
The hook system in this repository is organized around six Claude Code lifecycle events.

| Event | When it fires | What hooks at this stage typically do |
| --- | --- | --- |
| `PreToolUse` | Immediately before Claude Code executes a tool call. | Gate or shape the tool invocation, such as validating a command, blocking an unsafe action, or changing terminal state before a question is shown. |
| `PostToolUse` | Immediately after a tool call completes. | Persist state derived from structured tool input, sync working artifacts, or restore UI state after a tool-mediated interaction. |
| `UserPromptSubmit` | When a user submits a new prompt into the session. | Create or update work state, capture ratings or sentiment, and derive session naming or tab metadata from the prompt text. |
| `SessionStart` | When a Claude Code session starts. | Load baseline context, render startup status, and adjust the session mode before the first working turn. |
| `Stop` | After Claude finishes generating a response. | Cache the final response state and run response-level orchestration that should happen after each assistant turn. |
| `SessionEnd` | As the Claude Code session closes. | Finalize work tracking, refresh counts, run integrity checks, and capture learning artifacts at a clean session boundary. |

## Hook Reference
The repository registers 37 hooks across those six lifecycle events; the most significant are listed below.

| Hook | Event | Description |
| --- | --- | --- |
| `AgentExecutionGuard` | `PreToolUse` | Enforces background execution for Task spawns by injecting a warning when `run_in_background: true` is missing on non-fast tasks. |
| `SecurityValidator` | `PreToolUse` | Validates Bash commands and file operations against security patterns; allows, asks, or blocks tool calls before they execute. |
| `SetQuestionTab` | `PreToolUse` | Sets the terminal tab color to teal when AskUserQuestion fires, signaling that a user response is pending. |
| `SkillGuard` | `PreToolUse` | Blocks false-positive Skill invocations, notably the position-biased `keybindings-help`, on ambiguous prompts. |
| `VoiceGate` | `PreToolUse` | Blocks voice notification curls originating from background agents and subagents; only the main session may emit voice. |
| `AlgorithmTracker` | `PostToolUse` | Consolidated Algorithm state tracker for phase transitions, ISC criteria updates, and agent spawn tracking from structured tool input. |
| `PRDSync` | `PostToolUse` | Persists Algorithm phase changes and criteria updates into `PRD.md` files on disk to keep working memory and PRD aligned. |
| `QuestionAnswered` | `PostToolUse` | Resets the terminal tab from question state back to working state after the user answers an AskUserQuestion prompt. |
| `AutoWorkCreation` | `UserPromptSubmit` | Creates the per-session and per-task directory structure, including `META.yaml`, `ISC.json`, and `THREAD.md`, on each user prompt. |
| `RatingCapture` | `UserPromptSubmit` | Captures explicit `1-10` ratings and infers implicit sentiment, logs to `ratings.jsonl`, and emits the Algorithm format reminder. |
| `SessionAutoName` | `UserPromptSubmit` | Generates a concise `2-3` word session title from the first user prompt so the status line always shows a meaningful name. |
| `UpdateTabTitle` | `UserPromptSubmit` | Updates the terminal tab title from the user prompt using a strict gerund-based naming convention. |
| `CheckVersion` | `SessionStart` | Compares the installed Claude Code version against the latest published package release and prints an update notice if a newer release is available. |
| `LoadContext` | `SessionStart` | Foundational context injection that loads `SKILL.md`, AI Steering Rules, and the active work summary into the session as a system reminder. |
| `StartupGreeting` | `SessionStart` | Renders the responsive neofetch-style startup banner with skill, session, and learning counts. |
| `TelegramClean` | `SessionStart` | Detects Telegram bot sessions and switches output to a minimal format suited for chat transport. |
| `LastResponseCache` | `Stop` | Caches a summary of the final assistant response, including `sessionId`, summary, tools used, and phase, to `MEMORY/STATE/last-response.json`. |
| `StopOrchestrator` | `Stop` | Single Stop entry point that parses the transcript once and dispatches to handlers for voice notification, tab state, skill rebuild, and doc cross-reference integrity. |
| `IntegrityCheck` | `SessionEnd` | Runs system-file integrity and documentation cross-reference integrity checks on session end, flagging drift in authoritative docs. |
| `RelationshipMemory` | `SessionEnd` | Extracts relationship-relevant learnings from the session transcript and appends them to the dated relationship log. |
| `SessionSummary` | `SessionEnd` | Marks the active work directory as `COMPLETED` and clears session state for clean session boundaries. |
| `UpdateCounts` | `SessionEnd` | Refreshes `settings.json` counts for skills, hooks, and ratings, and updates the API usage cache so the next session banner has fresh numbers. |
| `WorkCompletionLearning` | `SessionEnd` | Bridges `WORK/` to `LEARNING/` by capturing completed work metadata, such as files changed, tools used, and criteria, into a learning file for future compounding. |

## TypeScript Pattern
A typical hook follows a compact pattern: define the input and output types, read the event payload from `stdin`, make a decision from structured fields, write one JSON object to `stdout`, and exit `0`.

```typescript
#!/usr/bin/env bun
import process from "node:process";

type HookInput = {
  session_id?: string;
  tool_name: string;
  tool_input?: {
    command?: string;
  };
};

type HookOutput =
  | { continue: true }
  | {
      decision: "ask";
      reason: string;
      message: string;
    };

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const raw = await readStdin();

  if (!raw) {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    process.exit(0);
  }

  const input = JSON.parse(raw) as HookInput;
  const command = input.tool_input?.command ?? "";

  const output: HookOutput = /\bgit\s+push\s+--force\b/.test(command)
    ? {
        decision: "ask",
        reason: "force-push-detected",
        message: "Confirm the force push before continuing."
      }
    : { continue: true };

  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  process.exit(0);
});
```

```bash
printf '%s\n' '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | bun run hooks/YourHook.hook.ts
```

## Registration
Claude Code registers hooks through a top-level `hooks` object keyed by event name. Each event entry holds one or more matcher records, and each matcher record holds a `hooks` array of command descriptors.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bun run hooks/YourHook.hook.ts"
          }
        ]
      }
    ]
  }
}
```

## Security Note
`SecurityValidator` is the `PreToolUse` hook that gates `Bash`, `Edit`, `Write`, and `Read` against repository security patterns before those tools execute. It may allow the call with `{"continue": true}`, return an ask response such as `{"decision":"ask","reason":"confirm-write","message":"Confirm before continuing."}`, or block the call outright when a command or path crosses a hard boundary. In practice, that makes `SecurityValidator` the enforcement point for the security pipeline on every sensitive tool call in `PAIArchitecture`.
