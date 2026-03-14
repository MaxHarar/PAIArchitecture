/**
 * Memory Extractor — Tests
 *
 * TDD Red phase: These tests define the expected behavior of the
 * MemoryExtractor before any implementation exists.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MemoryExtractor, type MemoryEntry } from "./memory-extractor";
import { existsSync, unlinkSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), `memory-extractor-test-${Date.now()}`);
const TEST_JSONL = join(TEST_DIR, "brain-memories.jsonl");
const TEST_MEMORY_MD = join(TEST_DIR, "MEMORY.md");

function readJsonlEntries(path: string): MemoryEntry[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line));
}

describe("MemoryExtractor", () => {
  let extractor: MemoryExtractor;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Ensure clean state
    if (existsSync(TEST_JSONL)) unlinkSync(TEST_JSONL);
    if (existsSync(TEST_MEMORY_MD)) unlinkSync(TEST_MEMORY_MD);

    extractor = new MemoryExtractor({
      memoriesPath: TEST_JSONL,
      memoryMdPath: TEST_MEMORY_MD,
    });
  });

  afterEach(() => {
    try {
      if (existsSync(TEST_JSONL)) unlinkSync(TEST_JSONL);
      if (existsSync(TEST_MEMORY_MD)) unlinkSync(TEST_MEMORY_MD);
    } catch {}
  });

  // -------------------------------------------------------------------------
  // Preference Detection
  // -------------------------------------------------------------------------

  describe("preference detection", () => {
    test("detects 'always' preference signals", async () => {
      await extractor.extract(
        "I always want responses under 200 words",
        "Got it, I'll keep responses concise.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      expect(entries.length).toBeGreaterThanOrEqual(1);

      const prefEntry = entries.find((e) => e.type === "preference");
      expect(prefEntry).toBeDefined();
      expect(prefEntry!.content).toContain("200 words");
      expect(prefEntry!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    test("detects 'never' preference signals", async () => {
      await extractor.extract(
        "Never use emojis in your responses to me",
        "Understood, no emojis.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      const prefEntry = entries.find((e) => e.type === "preference");
      expect(prefEntry).toBeDefined();
      expect(prefEntry!.content).toContain("emojis");
    });

    test("detects 'prefer' preference signals", async () => {
      await extractor.extract(
        "I prefer TypeScript over JavaScript for all new projects",
        "Noted, TypeScript for new projects.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      const prefEntry = entries.find((e) => e.type === "preference");
      expect(prefEntry).toBeDefined();
      expect(prefEntry!.content).toContain("TypeScript");
    });

    test("detects 'remember' signals", async () => {
      await extractor.extract(
        "Remember that my deployment server is at 192.168.1.100",
        "I'll remember that.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0]!.content).toContain("192.168.1.100");
    });
  });

  // -------------------------------------------------------------------------
  // Technical Detection
  // -------------------------------------------------------------------------

  describe("technical detection", () => {
    test("detects file path references", async () => {
      await extractor.extract(
        "The config file is at /Users/maxharar/.claude/settings.json",
        "I see the config file.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      const techEntry = entries.find(
        (e) => e.type === "technical" || e.type === "project"
      );
      expect(techEntry).toBeDefined();
      expect(techEntry!.content).toContain("settings.json");
    });

    test("detects deployment/configuration decisions", async () => {
      await extractor.extract(
        "Deploy the gateway to production on port 18800",
        "Deploying to production.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      const decisionEntry = entries.find((e) => e.type === "decision");
      expect(decisionEntry).toBeDefined();
      expect(decisionEntry!.content).toContain("18800");
    });
  });

  // -------------------------------------------------------------------------
  // Rate Limiting
  // -------------------------------------------------------------------------

  describe("rate limiting", () => {
    test("limits to max 3 extractions per turn", async () => {
      // This message triggers many signals at once
      await extractor.extract(
        "Remember to always deploy to /Users/maxharar/prod and never use Python. I prefer bun over npm. Configure the port to 3000.",
        "Got it all.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      expect(entries.length).toBeLessThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe("deduplication", () => {
    test("does not write duplicate memories", async () => {
      await extractor.extract(
        "I always want TypeScript",
        "TypeScript it is.",
        "test-session-1"
      );
      await extractor.extract(
        "I always want TypeScript",
        "TypeScript confirmed.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      // Should have at most 1 entry about TypeScript preference
      const tsEntries = entries.filter(
        (e) => e.type === "preference" && e.content.includes("TypeScript")
      );
      expect(tsEntries.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Confidence Filtering
  // -------------------------------------------------------------------------

  describe("confidence filtering", () => {
    test("does not extract from low-signal messages", async () => {
      await extractor.extract(
        "What time is it?",
        "It's 3:45 PM.",
        "test-session-1"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      expect(entries.length).toBe(0);
    });

    test("does not extract from generic greetings", async () => {
      await extractor.extract("Hey", "Hello! How can I help?", "test-session-1");

      const entries = readJsonlEntries(TEST_JSONL);
      expect(entries.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Memory Entry Structure
  // -------------------------------------------------------------------------

  describe("entry structure", () => {
    test("produces valid MemoryEntry objects", async () => {
      await extractor.extract(
        "Always use dark mode for everything",
        "Dark mode enabled.",
        "test-session-42"
      );

      const entries = readJsonlEntries(TEST_JSONL);
      expect(entries.length).toBeGreaterThanOrEqual(1);

      const entry = entries[0]!;
      expect(entry.id).toBeDefined();
      expect(typeof entry.id).toBe("string");
      expect(entry.timestamp).toBeDefined();
      expect(entry.sessionId).toBe("test-session-42");
      expect(
        ["decision", "preference", "project", "technical", "relationship", "general"].includes(entry.type)
      ).toBe(true);
      expect(typeof entry.content).toBe("string");
      expect(entry.content.length).toBeGreaterThan(0);
      expect(typeof entry.source).toBe("string");
      expect(typeof entry.confidence).toBe("number");
      expect(entry.confidence).toBeGreaterThanOrEqual(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Session Summary
  // -------------------------------------------------------------------------

  describe("session summary", () => {
    test("extractSessionSummary produces a session_summary entry", async () => {
      // First add some conversation context
      await extractor.extract(
        "Deploy the gateway to port 18800",
        "Done.",
        "session-abc"
      );

      await extractor.extractSessionSummary(
        "session-abc",
        "Discussed gateway deployment. Configured port 18800. Fixed auth issues."
      );

      const entries = readJsonlEntries(TEST_JSONL);
      const summaryEntry = entries.find(
        (e) => e.type === "general" && e.source === "session_summary"
      );
      expect(summaryEntry).toBeDefined();
      expect(summaryEntry!.sessionId).toBe("session-abc");
      expect(summaryEntry!.content).toContain("gateway");
      expect(summaryEntry!.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  // -------------------------------------------------------------------------
  // MEMORY.md Integration
  // -------------------------------------------------------------------------

  describe("MEMORY.md integration", () => {
    test("writes high-confidence memories to MEMORY.md", async () => {
      // Create a minimal MEMORY.md
      writeFileSync(TEST_MEMORY_MD, "# PAI Memory\n\n## Some Section\n- existing entry\n");

      await extractor.extract(
        "Remember that the gateway API key is stored in macOS Keychain under pai-gateway",
        "Noted.",
        "test-session-1"
      );

      // Wait for async write
      await new Promise((r) => setTimeout(r, 100));

      const mdContent = readFileSync(TEST_MEMORY_MD, "utf-8");
      expect(mdContent).toContain("Gateway Learnings");
    });

    test("does not write to MEMORY.md if over 200 lines", async () => {
      // Create a MEMORY.md that is 201 lines
      const longContent = "# PAI Memory\n" + Array(200).fill("- filler line").join("\n") + "\n";
      writeFileSync(TEST_MEMORY_MD, longContent);

      await extractor.extract(
        "Remember that I love Bun runtime",
        "Noted.",
        "test-session-1"
      );

      await new Promise((r) => setTimeout(r, 100));

      const mdContent = readFileSync(TEST_MEMORY_MD, "utf-8");
      // Should NOT have added Gateway Learnings section since it's over 200 lines
      expect(mdContent).not.toContain("Gateway Learnings");
    });
  });

  // -------------------------------------------------------------------------
  // loadRecentMemories
  // -------------------------------------------------------------------------

  describe("loadRecentMemories", () => {
    test("returns empty array when no memories file exists", () => {
      const memories = MemoryExtractor.loadRecentMemories(TEST_JSONL, 20);
      expect(memories).toEqual([]);
    });

    test("returns last N memories from file", async () => {
      // Write 5 entries
      for (let i = 0; i < 5; i++) {
        await extractor.extract(
          `Remember setting number ${i}`,
          "Noted.",
          `session-${i}`
        );
      }

      const memories = MemoryExtractor.loadRecentMemories(TEST_JSONL, 3);
      expect(memories.length).toBe(3);
      // Should be the last 3 entries
    });

    test("returns all memories if fewer than N exist", async () => {
      await extractor.extract(
        "Remember that bun is fast",
        "Indeed.",
        "session-1"
      );

      const memories = MemoryExtractor.loadRecentMemories(TEST_JSONL, 20);
      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(memories.length).toBeLessThanOrEqual(20);
    });
  });
});
