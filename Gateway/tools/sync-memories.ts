#!/usr/bin/env bun
/**
 * sync-memories — Bridge gateway brain memories to terminal MEMORY.md
 *
 * Reads brain-memories.jsonl, deduplicates, groups by type, and writes
 * a formatted "## Gateway Brain Memories" section into MEMORY.md.
 *
 * Usage:
 *   bun sync-memories.ts              # Sync memories
 *   bun sync-memories.ts --dry-run    # Preview without writing
 *   bun sync-memories.ts --stats      # Show memory statistics
 *
 * Designed to be run:
 * - Manually when needed
 * - By the gateway on session rotation
 * - By a launchd timer (e.g. every hour)
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";

const HOME = homedir();
const MEMORIES_PATH = `${HOME}/.claude/Gateway/memory/brain-memories.jsonl`;
const MEMORY_MD_PATH = `${HOME}/.claude/projects/-Users-maxharar--claude/memory/MEMORY.md`;
const SECTION_HEADER = "## Gateway Brain Memories";
const MAX_ENTRIES_PER_TYPE = 15;

interface MemoryEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  type: string;
  content: string;
  source: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Load and deduplicate memories
// ---------------------------------------------------------------------------

function loadMemories(): MemoryEntry[] {
  if (!existsSync(MEMORIES_PATH)) {
    console.log("No memories file found at", MEMORIES_PATH);
    return [];
  }

  const content = readFileSync(MEMORIES_PATH, "utf-8").trim();
  if (!content) return [];

  const entries: MemoryEntry[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as MemoryEntry;
      // Deduplicate by normalized content
      const key = entry.content.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Format memories for MEMORY.md
// ---------------------------------------------------------------------------

function formatMemories(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";

  // Group by type
  const groups: Record<string, MemoryEntry[]> = {};
  for (const entry of entries) {
    const type = entry.type || "general";
    if (!groups[type]) groups[type] = [];
    groups[type].push(entry);
  }

  // Sort each group by timestamp (newest first), limit per type
  const lines: string[] = [SECTION_HEADER];
  lines.push("*Auto-synced from gateway brain. Updated: " + new Date().toISOString().split("T")[0] + "*\n");

  const typeOrder = ["preference", "decision", "project", "technical", "relationship", "general"];

  for (const type of typeOrder) {
    const group = groups[type];
    if (!group || group.length === 0) continue;

    // Sort newest first, limit
    group.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const limited = group.slice(0, MAX_ENTRIES_PER_TYPE);

    const label = type.charAt(0).toUpperCase() + type.slice(1);
    lines.push(`### ${label}s`);
    for (const entry of limited) {
      const date = entry.timestamp.split("T")[0];
      lines.push(`- ${entry.content} *(${date})*`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Write to MEMORY.md
// ---------------------------------------------------------------------------

function syncToMemoryMd(formattedSection: string, dryRun: boolean): void {
  if (!existsSync(MEMORY_MD_PATH)) {
    console.error("MEMORY.md not found at", MEMORY_MD_PATH);
    process.exit(1);
  }

  const content = readFileSync(MEMORY_MD_PATH, "utf-8");

  // Remove existing section if present
  let newContent: string;
  const sectionIdx = content.indexOf(SECTION_HEADER);

  if (sectionIdx >= 0) {
    // Find the next ## heading after our section
    const afterSection = content.slice(sectionIdx + SECTION_HEADER.length);
    const nextSectionMatch = afterSection.match(/\n## (?!#)/);
    const endIdx = nextSectionMatch
      ? sectionIdx + SECTION_HEADER.length + nextSectionMatch.index!
      : content.length;

    const before = content.slice(0, sectionIdx).trimEnd();
    const after = content.slice(endIdx);
    newContent = before + "\n\n" + formattedSection + after;
  } else {
    // Also remove the old "Gateway Learnings" section if it exists
    const oldSectionIdx = content.indexOf("## Gateway Learnings");
    if (oldSectionIdx >= 0) {
      const afterOld = content.slice(oldSectionIdx + "## Gateway Learnings".length);
      const nextMatch = afterOld.match(/\n## (?!#)/);
      const endIdx = nextMatch
        ? oldSectionIdx + "## Gateway Learnings".length + nextMatch.index!
        : content.length;

      const before = content.slice(0, oldSectionIdx).trimEnd();
      const after = content.slice(endIdx);
      newContent = before + "\n\n" + formattedSection + after;
    } else {
      // Append at end
      newContent = content.trimEnd() + "\n\n" + formattedSection;
    }
  }

  if (dryRun) {
    console.log("--- DRY RUN: Would write to MEMORY.md ---");
    console.log(formattedSection);
    return;
  }

  writeFileSync(MEMORY_MD_PATH, newContent, "utf-8");
  console.log("Synced memories to MEMORY.md");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const statsOnly = args.includes("--stats");

const entries = loadMemories();

if (statsOnly) {
  console.log(`Total memories: ${entries.length}`);
  const types: Record<string, number> = {};
  for (const e of entries) {
    types[e.type] = (types[e.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(types)) {
    console.log(`  ${type}: ${count}`);
  }
  process.exit(0);
}

if (entries.length === 0) {
  console.log("No memories to sync.");
  process.exit(0);
}

const formatted = formatMemories(entries);
syncToMemoryMd(formatted, dryRun);
console.log(`Synced ${entries.length} memories (${dryRun ? "dry run" : "written"}).`);
