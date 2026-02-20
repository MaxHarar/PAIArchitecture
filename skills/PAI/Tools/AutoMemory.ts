#!/usr/bin/env bun
/**
 * ============================================================================
 * AutoMemory — Two-Phase Automatic Memory Extraction
 * ============================================================================
 *
 * Extracts learnings and patterns from Claude Code session transcripts and
 * consolidates them into persistent MEMORY.md files.
 *
 * PHASE 1 (Extract): Haiku scans recent session transcripts for memorable
 *   patterns, preferences, and facts. Outputs raw JSONL extractions.
 *
 * PHASE 2 (Consolidate): Sonnet reads raw extractions and merges them into
 *   structured MEMORY.md, deduplicating and organizing by topic.
 *
 * USAGE:
 *   bun AutoMemory.ts phase1              # Extract from unprocessed sessions
 *   bun AutoMemory.ts phase2              # Consolidate raw extractions into MEMORY.md
 *   bun AutoMemory.ts run                 # Run both phases sequentially
 *   bun AutoMemory.ts status              # Show extraction state
 *   bun AutoMemory.ts --dry-run phase1    # Show what would be extracted
 *   bun AutoMemory.ts --limit 5 phase1    # Process only 5 sessions
 *
 * OPTIONS:
 *   --dry-run     Show what would be done without writing
 *   --limit <n>   Max sessions to process in phase1 (default: 20)
 *   --verbose     Show detailed progress
 *
 * ============================================================================
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { inference } from "./Inference";

// ============================================================================
// Configuration
// ============================================================================

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const TRANSCRIPTS_DIR = join(CLAUDE_DIR, "projects", "-Users-maxharar--claude");
const MEMORY_DIR = join(TRANSCRIPTS_DIR, "memory");
const MEMORY_MD = join(MEMORY_DIR, "MEMORY.md");
const LEARNING_AUTO_DIR = join(CLAUDE_DIR, "MEMORY", "LEARNING", "AUTO");
const STATE_FILE = join(LEARNING_AUTO_DIR, "extraction-state.json");
const RAW_EXTRACTIONS_FILE = join(LEARNING_AUTO_DIR, "raw-extractions.jsonl");

const CONCURRENCY_LIMIT = 4;
const MIN_TRANSCRIPT_SIZE = 500; // bytes — skip tiny/empty sessions
const MAX_CHUNK_CHARS = 80_000; // ~20k tokens for Haiku context
const DEFAULT_LIMIT = 20;

// ============================================================================
// Types
// ============================================================================

interface ExtractionState {
  lastRun: string;
  processedSessions: string[]; // session IDs already extracted
  phase1Count: number;
  phase2Count: number;
}

interface RawExtraction {
  sessionId: string;
  timestamp: string;
  memories: MemoryItem[];
}

interface MemoryItem {
  category: string; // e.g. "project", "preference", "pattern", "debugging", "architecture"
  content: string;  // the memory itself
  confidence: "high" | "medium" | "low";
}

interface TranscriptMessage {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
  sessionId?: string;
}

// ============================================================================
// State Management
// ============================================================================

function loadState(): ExtractionState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch {
      // Corrupted state — start fresh
    }
  }
  return {
    lastRun: "",
    processedSessions: [],
    phase1Count: 0,
    phase2Count: 0,
  };
}

function saveState(state: ExtractionState): void {
  ensureDir(LEARNING_AUTO_DIR);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ============================================================================
// Helpers
// ============================================================================

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getSessionId(filename: string): string {
  return basename(filename, ".jsonl");
}

/**
 * Find unprocessed session transcripts, sorted by modification time (newest first).
 */
function findUnprocessedSessions(state: ExtractionState, limit: number): string[] {
  if (!existsSync(TRANSCRIPTS_DIR)) return [];

  const processed = new Set(state.processedSessions);
  const files = readdirSync(TRANSCRIPTS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      name: f,
      path: join(TRANSCRIPTS_DIR, f),
      sessionId: getSessionId(f),
      mtime: statSync(join(TRANSCRIPTS_DIR, f)).mtimeMs,
      size: statSync(join(TRANSCRIPTS_DIR, f)).size,
    }))
    .filter((f) => !processed.has(f.sessionId) && f.size >= MIN_TRANSCRIPT_SIZE)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  return files.map((f) => f.path);
}

/**
 * Extract text content from a transcript JSONL file.
 * Returns concatenated user + assistant messages.
 */
function readTranscript(path: string): string {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const messages: string[] = [];

  for (const line of lines) {
    try {
      const entry: TranscriptMessage = JSON.parse(line);
      if (entry.type === "user" || entry.type === "assistant") {
        const msg = entry.message;
        if (!msg) continue;
        if (typeof msg.content === "string") {
          // Skip system-reminder noise and very short messages
          if (!msg.content.startsWith("<system-reminder>") && msg.content.length > 20) {
            const role = msg.role === "user" ? "USER" : "ASSISTANT";
            messages.push(`[${role}]: ${msg.content}`);
          }
        } else if (Array.isArray(msg.content)) {
          const texts = msg.content
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text!)
            .filter((t) => !t.startsWith("<system-reminder>") && t.length > 20);
          if (texts.length > 0) {
            const role = msg.role === "user" ? "USER" : "ASSISTANT";
            messages.push(`[${role}]: ${texts.join("\n")}`);
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return messages.join("\n\n");
}

/**
 * Chunk a transcript into pieces that fit within token limits.
 */
function chunkTranscript(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_CHARS) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point near the limit (paragraph boundary)
    let breakPoint = remaining.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
    if (breakPoint < MAX_CHUNK_CHARS * 0.5) {
      // No good paragraph break — use line break
      breakPoint = remaining.lastIndexOf("\n", MAX_CHUNK_CHARS);
    }
    if (breakPoint < MAX_CHUNK_CHARS * 0.5) {
      // No good break at all — hard cut
      breakPoint = MAX_CHUNK_CHARS;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

/**
 * Run async tasks with concurrency limit.
 */
async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then((r) => {
      results.push(r);
    });
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove resolved promises
      for (let i = executing.length - 1; i >= 0; i--) {
        // Check if settled by trying to race with an immediate resolve
        const settled = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) executing.splice(i, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// ============================================================================
// Phase 1: Extract raw memories from transcripts using Haiku
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction assistant. Your job is to identify memorable, reusable information from Claude Code session transcripts.

Extract ONLY information that would be valuable to remember across sessions:
- User preferences (tools, workflows, naming conventions, communication style)
- Project details (paths, tech stacks, deployment configs, important files)
- Debugging insights (what worked, what didn't, root causes found)
- Architecture decisions (why X was chosen over Y)
- Patterns (recurring approaches, templates, conventions)
- Environment facts (installed tools, system config, accounts)

DO NOT extract:
- Transient task details (what was being worked on right now)
- Conversation pleasantries or social content
- System prompt content or hook/skill definitions
- Information that's already in code or documentation
- Speculative or unverified information

Output ONLY valid JSON — an array of objects with these fields:
- "category": one of "project", "preference", "pattern", "debugging", "architecture", "environment", "workflow"
- "content": the memory in 1-2 concise sentences
- "confidence": "high" (explicitly stated), "medium" (clearly implied), "low" (inferred)

If no valuable memories found, output an empty array: []`;

async function extractFromChunk(
  chunk: string,
  sessionId: string,
  dryRun: boolean,
  verbose: boolean
): Promise<MemoryItem[]> {
  const result = await inference({
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: `Extract memories from this session transcript chunk:\n\n${chunk}`,
    level: "fast",
    expectJson: false,
    timeout: 30_000,
  });

  if (!result.success) {
    if (verbose) console.error(`  [WARN] Extraction failed for ${sessionId}: ${result.error}`);
    return [];
  }

  // Parse the JSON array from response
  try {
    const jsonMatch = result.output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const items: MemoryItem[] = JSON.parse(jsonMatch[0]);
    return items.filter(
      (m) => m.category && m.content && m.confidence && m.content.length > 10
    );
  } catch {
    if (verbose) console.error(`  [WARN] Failed to parse extraction JSON for ${sessionId}`);
    return [];
  }
}

async function runPhase1(options: {
  dryRun: boolean;
  limit: number;
  verbose: boolean;
}): Promise<void> {
  const { dryRun, limit, verbose } = options;
  const state = loadState();
  const sessions = findUnprocessedSessions(state, limit);

  if (sessions.length === 0) {
    console.log("Phase 1: No unprocessed sessions found.");
    return;
  }

  console.log(`Phase 1: Found ${sessions.length} unprocessed session(s)`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would process these sessions:");
    for (const s of sessions) {
      const size = statSync(s).size;
      const sid = getSessionId(basename(s));
      console.log(`  ${sid} (${(size / 1024).toFixed(1)}KB)`);
    }
    return;
  }

  ensureDir(LEARNING_AUTO_DIR);
  let totalMemories = 0;

  // Process sessions with concurrency limit
  const processSession = async (sessionPath: string): Promise<void> => {
    const sessionId = getSessionId(basename(sessionPath));
    const text = readTranscript(sessionPath);

    if (text.length < 100) {
      if (verbose) console.log(`  Skipping ${sessionId} — too short after parsing`);
      state.processedSessions.push(sessionId);
      return;
    }

    const chunks = chunkTranscript(text);
    if (verbose) console.log(`  Processing ${sessionId} (${chunks.length} chunk(s))`);

    const allMemories: MemoryItem[] = [];

    for (const chunk of chunks) {
      const memories = await extractFromChunk(chunk, sessionId, dryRun, verbose);
      allMemories.push(...memories);
    }

    if (allMemories.length > 0) {
      const extraction: RawExtraction = {
        sessionId,
        timestamp: new Date().toISOString(),
        memories: allMemories,
      };
      appendFileSync(RAW_EXTRACTIONS_FILE, JSON.stringify(extraction) + "\n");
      totalMemories += allMemories.length;
      console.log(`  ${sessionId}: ${allMemories.length} memories extracted`);
    } else {
      if (verbose) console.log(`  ${sessionId}: no memorable content found`);
    }

    state.processedSessions.push(sessionId);
  };

  // Process with concurrency limit
  await asyncPool(sessions, CONCURRENCY_LIMIT, processSession);

  state.lastRun = new Date().toISOString();
  state.phase1Count += totalMemories;
  saveState(state);

  console.log(`\nPhase 1 complete: ${totalMemories} memories from ${sessions.length} sessions`);
}

// ============================================================================
// Phase 2: Consolidate raw extractions into MEMORY.md using Sonnet
// ============================================================================

const CONSOLIDATION_SYSTEM_PROMPT = `You are a memory consolidation assistant. You receive:
1. The current MEMORY.md file content
2. New raw memory extractions (JSON)

Your job is to produce an UPDATED MEMORY.md that:
- Preserves ALL existing content (do not remove anything unless it's clearly superseded)
- Integrates new memories into the appropriate sections
- Deduplicates: if a new memory restates something already present, skip it
- Groups by topic using ## headers (e.g., "## Jarvis Voice System", "## PR Workflow")
- Creates new sections for topics not yet covered
- Uses concise bullet points (- prefix)
- Keeps the file under 180 lines to stay within the 200-line system prompt limit
- If approaching the limit, prioritize high-confidence memories over low

Output ONLY the complete updated MEMORY.md content. No explanations, no markdown fences, just the file content starting with "# PAI Memory".`;

async function runPhase2(options: {
  dryRun: boolean;
  verbose: boolean;
}): Promise<void> {
  const { dryRun, verbose } = options;

  if (!existsSync(RAW_EXTRACTIONS_FILE)) {
    console.log("Phase 2: No raw extractions to consolidate.");
    return;
  }

  const rawContent = readFileSync(RAW_EXTRACTIONS_FILE, "utf-8").trim();
  if (!rawContent) {
    console.log("Phase 2: Raw extractions file is empty.");
    return;
  }

  const extractions: RawExtraction[] = rawContent
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RawExtraction;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as RawExtraction[];

  const totalMemories = extractions.reduce((sum, e) => sum + e.memories.length, 0);
  console.log(`Phase 2: Consolidating ${totalMemories} raw memories from ${extractions.length} sessions`);

  // Read current MEMORY.md
  const currentMemory = existsSync(MEMORY_MD) ? readFileSync(MEMORY_MD, "utf-8") : "# PAI Memory\n";

  // Format extractions for the consolidation prompt
  const extractionsSummary = extractions
    .flatMap((e) =>
      e.memories.map((m) => ({
        category: m.category,
        content: m.content,
        confidence: m.confidence,
        session: e.sessionId.slice(0, 8),
      }))
    );

  if (dryRun) {
    console.log("\n[DRY RUN] Would consolidate these memories into MEMORY.md:");
    for (const m of extractionsSummary) {
      console.log(`  [${m.confidence}] (${m.category}) ${m.content}`);
    }
    console.log(`\nCurrent MEMORY.md has ${currentMemory.split("\n").length} lines`);
    return;
  }

  const result = await inference({
    systemPrompt: CONSOLIDATION_SYSTEM_PROMPT,
    userPrompt: `CURRENT MEMORY.md:\n\`\`\`\n${currentMemory}\n\`\`\`\n\nNEW MEMORIES TO INTEGRATE:\n\`\`\`json\n${JSON.stringify(extractionsSummary, null, 2)}\n\`\`\``,
    level: "standard",
    expectJson: false,
    timeout: 60_000,
  });

  if (!result.success) {
    console.error(`Phase 2 failed: ${result.error}`);
    return;
  }

  let updatedMemory = result.output.trim();

  // Validate: must start with "# PAI Memory"
  if (!updatedMemory.startsWith("# PAI Memory")) {
    // Try to extract from potential markdown fence
    const match = updatedMemory.match(/# PAI Memory[\s\S]*/);
    if (match) {
      updatedMemory = match[0];
    } else {
      console.error("Phase 2 failed: Consolidation output doesn't start with '# PAI Memory'");
      return;
    }
  }

  // Safety check: don't let it shrink MEMORY.md dramatically
  const currentLines = currentMemory.split("\n").length;
  const newLines = updatedMemory.split("\n").length;
  if (newLines < currentLines * 0.5 && currentLines > 10) {
    console.error(`Phase 2 aborted: Output (${newLines} lines) is less than half of current (${currentLines} lines). Possible data loss.`);
    return;
  }

  // Write updated MEMORY.md
  writeFileSync(MEMORY_MD, updatedMemory + "\n");

  // Archive raw extractions (move to dated file, clear main file)
  const archiveName = `extractions-${new Date().toISOString().slice(0, 10)}.jsonl`;
  const archivePath = join(LEARNING_AUTO_DIR, archiveName);
  appendFileSync(archivePath, rawContent + "\n");
  writeFileSync(RAW_EXTRACTIONS_FILE, "");

  // Update state
  const state = loadState();
  state.phase2Count++;
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log(`Phase 2 complete: MEMORY.md updated (${currentLines} → ${newLines} lines)`);
  if (verbose) {
    console.log(`  Archived raw extractions to ${archiveName}`);
  }
}

// ============================================================================
// Status
// ============================================================================

function showStatus(): void {
  const state = loadState();
  const totalSessions = existsSync(TRANSCRIPTS_DIR)
    ? readdirSync(TRANSCRIPTS_DIR).filter((f) => f.endsWith(".jsonl")).length
    : 0;

  const rawCount = existsSync(RAW_EXTRACTIONS_FILE)
    ? readFileSync(RAW_EXTRACTIONS_FILE, "utf-8").split("\n").filter(Boolean).length
    : 0;

  const memoryLines = existsSync(MEMORY_MD)
    ? readFileSync(MEMORY_MD, "utf-8").split("\n").length
    : 0;

  console.log("AutoMemory Status");
  console.log("═".repeat(40));
  console.log(`Total sessions:      ${totalSessions}`);
  console.log(`Processed sessions:  ${state.processedSessions.length}`);
  console.log(`Unprocessed:         ${totalSessions - state.processedSessions.length}`);
  console.log(`Raw extractions:     ${rawCount} pending consolidation`);
  console.log(`Phase 1 runs:        ${state.phase1Count} memories extracted`);
  console.log(`Phase 2 runs:        ${state.phase2Count} consolidations`);
  console.log(`MEMORY.md lines:     ${memoryLines}/200`);
  console.log(`Last run:            ${state.lastRun || "never"}`);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  let dryRun = false;
  let verbose = false;
  let limit = DEFAULT_LIMIT;
  let command = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--verbose") {
      verbose = true;
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith("-")) {
      command = args[i];
    }
  }

  switch (command) {
    case "phase1":
      await runPhase1({ dryRun, limit, verbose });
      break;

    case "phase2":
      await runPhase2({ dryRun, verbose });
      break;

    case "run":
      await runPhase1({ dryRun, limit, verbose });
      if (!dryRun) {
        await runPhase2({ dryRun, verbose });
      }
      break;

    case "status":
      showStatus();
      break;

    default:
      console.log(`AutoMemory — Two-Phase Memory Extraction

Usage:
  bun AutoMemory.ts phase1              Extract from unprocessed sessions
  bun AutoMemory.ts phase2              Consolidate into MEMORY.md
  bun AutoMemory.ts run                 Run both phases
  bun AutoMemory.ts status              Show extraction state

Options:
  --dry-run     Show what would be done without writing
  --limit <n>   Max sessions to process (default: ${DEFAULT_LIMIT})
  --verbose     Detailed progress output`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("AutoMemory fatal error:", err);
    process.exit(1);
  });
}

// Export for hook integration
export { runPhase1, findUnprocessedSessions, loadState };
