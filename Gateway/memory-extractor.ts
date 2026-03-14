/**
 * Sentinel Gateway — Memory Extractor
 *
 * Extracts memory-worthy insights from conversations using heuristic
 * pattern matching (no AI inference — too expensive per message).
 *
 * Writes to:
 * 1. brain-memories.jsonl — append-only JSONL for gateway brain continuity
 * 2. MEMORY.md — shared with Claude Code sessions (high-confidence only)
 *
 * Design principles:
 * - Non-blocking: fire-and-forget after response is sent
 * - Append-only: never rewrite the JSONL file
 * - Deduplication: same semantic memory is not written twice
 * - Rate-limited: max 3 extractions per conversation turn
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  type: "decision" | "preference" | "project" | "technical" | "relationship" | "general";
  content: string;
  source: string;
  confidence: number;
}

export interface MemoryExtractorOptions {
  /** Path to the JSONL file for gateway memories */
  memoriesPath: string;
  /** Path to the shared MEMORY.md file */
  memoryMdPath: string;
  /** Maximum extractions per conversation turn (default: 3) */
  maxPerTurn?: number;
  /** Minimum confidence to write to JSONL (default: 0.7) */
  minConfidence?: number;
  /** Minimum confidence to write to MEMORY.md (default: 0.9) */
  minConfidenceForMd?: number;
  /** Max lines in MEMORY.md before we stop writing (default: 200) */
  maxMemoryMdLines?: number;
}

// ---------------------------------------------------------------------------
// Heuristic Patterns
// ---------------------------------------------------------------------------

interface ExtractionRule {
  /** Regex patterns to match in the user message */
  patterns: RegExp[];
  /** Memory type to assign */
  type: MemoryEntry["type"];
  /** Base confidence for matches */
  confidence: number;
  /** How to extract the memory content from the match */
  extract: (userMsg: string, match: RegExpMatchArray) => string;
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // --- Preference signals ---
  {
    patterns: [
      /\b(?:i\s+)?always\s+(?:want|use|prefer|need|do)\b(.{5,120})/i,
      /\balways\s+(.{5,120})/i,
    ],
    type: "preference",
    confidence: 0.85,
    extract: (msg, match) => {
      const sentence = extractSentenceAround(msg, match.index || 0);
      return `User preference: ${sentence}`;
    },
  },
  {
    patterns: [
      /\bnever\s+(?:use|do|want|send|include|add)\b(.{5,120})/i,
      /\bdon'?t\s+ever\b(.{5,120})/i,
    ],
    type: "preference",
    confidence: 0.85,
    extract: (msg, match) => {
      const sentence = extractSentenceAround(msg, match.index || 0);
      return `User preference: ${sentence}`;
    },
  },
  {
    patterns: [/\bi?\s*prefer\b(.{5,120})/i],
    type: "preference",
    confidence: 0.80,
    extract: (msg, match) => {
      const sentence = extractSentenceAround(msg, match.index || 0);
      return `User preference: ${sentence}`;
    },
  },
  {
    patterns: [
      /\bremember\s+(?:that|this|my|the|to)\b(.{5,120})/i,
      /\bremember\b(.{5,120})/i,
    ],
    type: "general",
    confidence: 0.90,
    extract: (msg, match) => {
      const sentence = extractSentenceAround(msg, match.index || 0);
      return sentence;
    },
  },

  // --- Decision signals ---
  {
    patterns: [
      /\bdeploy(?:ing|ed|ment)?\s+(?:to|on|the|at)\b(.{5,120})/i,
      /\bconfigur(?:e|ed|ing)\s+(?:the|it|port|to)\b(.{5,120})/i,
    ],
    type: "decision",
    confidence: 0.75,
    extract: (msg, match) => {
      const sentence = extractSentenceAround(msg, match.index || 0);
      return `Decision: ${sentence}`;
    },
  },

  // --- Technical signals (file paths, project names) ---
  {
    patterns: [
      /(?:\/[\w.-]+){2,}(?:\.[\w]+)?/,  // Unix file paths like /Users/foo/bar.ts
    ],
    type: "technical",
    confidence: 0.70,
    extract: (msg, match) => {
      const sentence = extractSentenceAround(msg, match.index || 0);
      return `Technical context: ${sentence}`;
    },
  },

  // --- Relationship/feedback signals ---
  {
    patterns: [
      /\b(?:great|good|bad|terrible|love|hate)\s+(?:job|work|response|answer)\b/i,
      /\brating\s*[:=]\s*\d/i,
    ],
    type: "relationship",
    confidence: 0.70,
    extract: (msg, match) => {
      const sentence = extractSentenceAround(msg, match.index || 0);
      return `Feedback: ${sentence}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Helper: extract the sentence containing a match position
// ---------------------------------------------------------------------------

function extractSentenceAround(text: string, position: number): string {
  // Use a simpler approach: find sentence boundaries using period-space
  // or newline patterns, avoiding false boundaries at file paths/IPs/URLs.
  // A "sentence end" is a period/!/? followed by a space and uppercase letter,
  // or a newline, or end of string.
  const sentenceEndPattern = /(?<=[.!?])\s+(?=[A-Z])|\n/g;

  // Find all sentence boundaries
  const boundaries: number[] = [0];
  let m: RegExpExecArray | null;
  while ((m = sentenceEndPattern.exec(text)) !== null) {
    boundaries.push(m.index + m[0].length);
  }
  boundaries.push(text.length);

  // Find which sentence segment contains our position
  let sentenceStart = 0;
  let sentenceEnd = text.length;
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (boundaries[i]! <= position && position < boundaries[i + 1]!) {
      sentenceStart = boundaries[i]!;
      sentenceEnd = boundaries[i + 1]!;
      break;
    }
  }

  let sentence = text.slice(sentenceStart, sentenceEnd).trim();
  // Cap at 300 chars to ensure we capture paths/IPs
  if (sentence.length > 300) {
    sentence = sentence.slice(0, 297) + "...";
  }
  return sentence;
}

// ---------------------------------------------------------------------------
// MemoryExtractor
// ---------------------------------------------------------------------------

export class MemoryExtractor {
  private memoriesPath: string;
  private memoryMdPath: string;
  private maxPerTurn: number;
  private minConfidence: number;
  private minConfidenceForMd: number;
  private maxMemoryMdLines: number;

  /** In-memory cache of existing memory content hashes for dedup */
  private knownMemoryHashes: Set<string> = new Set();

  constructor(options: MemoryExtractorOptions) {
    this.memoriesPath = options.memoriesPath;
    this.memoryMdPath = options.memoryMdPath;
    this.maxPerTurn = options.maxPerTurn ?? 3;
    this.minConfidence = options.minConfidence ?? 0.7;
    this.minConfidenceForMd = options.minConfidenceForMd ?? 0.9;
    this.maxMemoryMdLines = options.maxMemoryMdLines ?? 200;

    // Ensure directories exist
    const memDir = dirname(this.memoriesPath);
    if (!existsSync(memDir)) {
      mkdirSync(memDir, { recursive: true });
    }

    // Load existing memory hashes for deduplication
    this.loadExistingHashes();
  }

  /**
   * Extract memories from a user message and assistant response.
   * This is the main entry point, called after each brain response.
   *
   * @param userMsg - The user's message content
   * @param assistantMsg - The assistant's response content
   * @param sessionId - Current session ID
   */
  async extract(
    userMsg: string,
    assistantMsg: string,
    sessionId: string
  ): Promise<void> {
    const candidates: MemoryEntry[] = [];

    for (const rule of EXTRACTION_RULES) {
      if (candidates.length >= this.maxPerTurn) break;

      for (const pattern of rule.patterns) {
        if (candidates.length >= this.maxPerTurn) break;

        const match = userMsg.match(pattern);
        if (!match) continue;

        const content = rule.extract(userMsg, match);
        const confidence = rule.confidence;

        if (confidence < this.minConfidence) continue;

        // Dedup check
        const hash = this.contentHash(content, rule.type);
        if (this.knownMemoryHashes.has(hash)) continue;

        const entry: MemoryEntry = {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sessionId,
          type: rule.type,
          content,
          source: userMsg.slice(0, 80),
          confidence,
        };

        candidates.push(entry);
        this.knownMemoryHashes.add(hash);

        // Only take the first matching pattern per rule
        break;
      }
    }

    // Write candidates to JSONL
    for (const entry of candidates) {
      this.appendToJsonl(entry);

      // Also write to MEMORY.md if high confidence
      if (entry.confidence >= this.minConfidenceForMd) {
        this.appendToMemoryMd(entry);
      }
    }
  }

  /**
   * Extract a comprehensive session summary before rotation.
   * Written as a high-confidence "general" entry with source "session_summary".
   *
   * @param sessionId - The session being rotated
   * @param summary - Summary text from the context manager
   */
  async extractSessionSummary(
    sessionId: string,
    summary: string
  ): Promise<void> {
    if (!summary || summary.trim().length === 0) return;

    const entry: MemoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId,
      type: "general",
      content: `Session summary: ${summary.slice(0, 500)}`,
      source: "session_summary",
      confidence: 0.95,
    };

    this.appendToJsonl(entry);
    this.appendToMemoryMd(entry);
  }

  /**
   * Load recent memories from the JSONL file.
   * Static method for use by soul.ts without needing an extractor instance.
   *
   * @param memoriesPath - Path to the JSONL file
   * @param count - Number of recent entries to return
   */
  static loadRecentMemories(
    memoriesPath: string,
    count: number
  ): MemoryEntry[] {
    if (!existsSync(memoriesPath)) return [];

    try {
      const content = readFileSync(memoriesPath, "utf-8").trim();
      if (!content) return [];

      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const entries: MemoryEntry[] = [];

      // Read from the end for efficiency
      const startIdx = Math.max(0, lines.length - count);
      for (let i = startIdx; i < lines.length; i++) {
        try {
          entries.push(JSON.parse(lines[i]!) as MemoryEntry);
        } catch {
          // Skip malformed lines
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Append a single memory entry to the JSONL file (append-only).
   */
  private appendToJsonl(entry: MemoryEntry): void {
    try {
      const line = JSON.stringify(entry) + "\n";
      appendFileSync(this.memoriesPath, line, "utf-8");
    } catch (error) {
      console.warn(`[MemoryExtractor] Failed to append to JSONL: ${error}`);
    }
  }

  /**
   * Append a high-confidence memory to MEMORY.md under "## Gateway Learnings".
   */
  private appendToMemoryMd(entry: MemoryEntry): void {
    try {
      if (!existsSync(this.memoryMdPath)) return;

      const content = readFileSync(this.memoryMdPath, "utf-8");
      const lineCount = content.split("\n").length;

      if (lineCount >= this.maxMemoryMdLines) {
        // Over limit — don't write
        return;
      }

      // Check if Gateway Brain Memories section exists
      const sectionHeader = "## Gateway Brain Memories";
      const bulletPoint = `- ${entry.content}`;

      if (content.includes(sectionHeader)) {
        // Append under existing section
        // Find the section and append after it
        const sectionIdx = content.indexOf(sectionHeader);
        const afterSection = content.slice(sectionIdx + sectionHeader.length);

        // Find the next section header (##) or end of file
        const nextSectionMatch = afterSection.match(/\n## /);
        const insertPos = nextSectionMatch
          ? sectionIdx + sectionHeader.length + nextSectionMatch.index!
          : content.length;

        const before = content.slice(0, insertPos);
        const after = content.slice(insertPos);

        // Ensure we have a newline before the bullet
        const separator = before.endsWith("\n") ? "" : "\n";
        const newContent = before + separator + bulletPoint + "\n" + after;

        writeFileSync(this.memoryMdPath, newContent, "utf-8");
      } else {
        // Add new section at the end
        const separator = content.endsWith("\n") ? "\n" : "\n\n";
        const newContent = content + separator + sectionHeader + "\n" + bulletPoint + "\n";

        writeFileSync(this.memoryMdPath, newContent, "utf-8");
      }
    } catch (error) {
      console.warn(`[MemoryExtractor] Failed to update MEMORY.md: ${error}`);
    }
  }

  /**
   * Load existing memory content hashes for deduplication.
   */
  private loadExistingHashes(): void {
    const entries = MemoryExtractor.loadRecentMemories(this.memoriesPath, 500);
    for (const entry of entries) {
      this.knownMemoryHashes.add(this.contentHash(entry.content, entry.type));
    }
  }

  /**
   * Generate a simple hash for deduplication.
   * Normalizes content to catch near-duplicates.
   */
  private contentHash(content: string, type: string): string {
    // Normalize: lowercase, collapse whitespace, remove punctuation
    const normalized = content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return `${type}:${normalized}`;
  }
}
