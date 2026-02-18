/**
 * FileHasher.test.ts - TDD tests for SHA-256 content hashing utility
 *
 * Tests cover:
 * - Basic hashing of file content
 * - Hashing of string content directly
 * - Change detection (content modified vs unchanged)
 * - Large file streaming support
 * - Hash metadata storage and retrieval
 * - CLI interface
 * - Edge cases (empty files, binary files, non-existent files)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";

// Import the module we're testing (will fail until implemented)
import {
  hashFile,
  hashContent,
  detectChanges,
  saveHashMetadata,
  loadHashMetadata,
  clearHashMetadata,
  type HashResult,
  type HashMetadata,
  type ChangeDetectionResult,
} from "../FileHasher";

// Test fixtures directory
const TEST_DIR = join(tmpdir(), "filehasher-tests");
const TOOL_PATH = join(import.meta.dir, "..", "FileHasher.ts");

describe("FileHasher", () => {
  // Setup test directory
  beforeAll(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  // Cleanup test directory
  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("hashContent", () => {
    test("should return SHA-256 hash for string content", async () => {
      const content = "Hello, World!";
      const result = await hashContent(content);

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64); // SHA-256 produces 64 hex chars
      expect(result.algorithm).toBe("sha256");
    });

    test("should return consistent hash for same content", async () => {
      const content = "Test content for hashing";
      const result1 = await hashContent(content);
      const result2 = await hashContent(content);

      expect(result1.hash).toBe(result2.hash);
    });

    test("should return different hash for different content", async () => {
      const result1 = await hashContent("Content A");
      const result2 = await hashContent("Content B");

      expect(result1.hash).not.toBe(result2.hash);
    });

    test("should handle empty string", async () => {
      const result = await hashContent("");

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64);
      // Known SHA-256 hash of empty string
      expect(result.hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    test("should handle unicode content", async () => {
      const content = "Hello, World! Chinese text unicode";
      const result = await hashContent(content);

      expect(result.success).toBe(true);
      expect(result.hash).toHaveLength(64);
    });

    test("should handle multiline content", async () => {
      const content = "Line 1\nLine 2\nLine 3\n";
      const result = await hashContent(content);

      expect(result.success).toBe(true);
      expect(result.hash).toHaveLength(64);
    });
  });

  describe("hashFile", () => {
    let testFilePath: string;

    beforeEach(() => {
      testFilePath = join(TEST_DIR, `test-${Date.now()}.txt`);
    });

    afterEach(() => {
      if (existsSync(testFilePath)) {
        rmSync(testFilePath);
      }
    });

    test("should hash file content correctly", async () => {
      const content = "File content for hashing";
      writeFileSync(testFilePath, content);

      const fileResult = await hashFile(testFilePath);
      const contentResult = await hashContent(content);

      expect(fileResult.success).toBe(true);
      expect(fileResult.hash).toBe(contentResult.hash);
      expect(fileResult.path).toBe(testFilePath);
    });

    test("should include file metadata", async () => {
      const content = "Test file metadata";
      writeFileSync(testFilePath, content);

      const result = await hashFile(testFilePath);

      expect(result.success).toBe(true);
      expect(result.path).toBe(testFilePath);
      expect(result.size).toBe(content.length);
      expect(result.hashedAt).toBeDefined();
      expect(typeof result.hashedAt).toBe("number");
    });

    test("should return error for non-existent file", async () => {
      const result = await hashFile("/nonexistent/path/to/file.txt");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("ENOENT");
    });

    test("should handle empty file", async () => {
      writeFileSync(testFilePath, "");

      const result = await hashFile(testFilePath);

      expect(result.success).toBe(true);
      expect(result.hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
      expect(result.size).toBe(0);
    });

    test("should handle binary files", async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const binaryPath = join(TEST_DIR, `binary-${Date.now()}.bin`);
      writeFileSync(binaryPath, binaryData);

      const result = await hashFile(binaryPath);

      expect(result.success).toBe(true);
      expect(result.hash).toHaveLength(64);
      expect(result.size).toBe(6);

      rmSync(binaryPath);
    });
  });

  describe("large file streaming", () => {
    let largeFilePath: string;

    beforeEach(() => {
      largeFilePath = join(TEST_DIR, `large-${Date.now()}.txt`);
    });

    afterEach(() => {
      if (existsSync(largeFilePath)) {
        rmSync(largeFilePath);
      }
    });

    test("should stream large files efficiently", async () => {
      // Create a 5MB file for testing streaming
      const chunkSize = 1024 * 1024; // 1MB
      const chunks = 5;
      const chunk = "x".repeat(chunkSize);

      // Write file in chunks to avoid memory issues
      writeFileSync(largeFilePath, "");
      for (let i = 0; i < chunks; i++) {
        writeFileSync(largeFilePath, chunk, { flag: "a" });
      }

      const startTime = Date.now();
      const result = await hashFile(largeFilePath, { streaming: true });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.hash).toHaveLength(64);
      expect(result.size).toBe(chunkSize * chunks);
      expect(result.streaming).toBe(true);
      // Should complete reasonably fast (under 5 seconds for 5MB)
      expect(duration).toBeLessThan(5000);
    });

    test("should produce same hash whether streaming or not", async () => {
      const content = "Test content for streaming comparison";
      writeFileSync(largeFilePath, content);

      const streamResult = await hashFile(largeFilePath, { streaming: true });
      const normalResult = await hashFile(largeFilePath, { streaming: false });

      expect(streamResult.hash).toBe(normalResult.hash);
    });
  });

  describe("change detection", () => {
    let testFilePath: string;

    beforeEach(() => {
      testFilePath = join(TEST_DIR, `change-${Date.now()}.txt`);
    });

    afterEach(() => {
      if (existsSync(testFilePath)) {
        rmSync(testFilePath);
      }
    });

    test("should detect unchanged file", async () => {
      const content = "Original content";
      writeFileSync(testFilePath, content);

      // Get initial hash
      const initialHash = await hashFile(testFilePath);

      // Check for changes (file unchanged)
      const result = await detectChanges(testFilePath, initialHash.hash!);

      expect(result.changed).toBe(false);
      expect(result.previousHash).toBe(initialHash.hash);
      expect(result.currentHash).toBe(initialHash.hash);
    });

    test("should detect changed file", async () => {
      const originalContent = "Original content";
      writeFileSync(testFilePath, originalContent);

      // Get initial hash
      const initialHash = await hashFile(testFilePath);

      // Modify file
      const newContent = "Modified content";
      writeFileSync(testFilePath, newContent);

      // Check for changes
      const result = await detectChanges(testFilePath, initialHash.hash!);

      expect(result.changed).toBe(true);
      expect(result.previousHash).toBe(initialHash.hash);
      expect(result.currentHash).not.toBe(initialHash.hash);
    });

    test("should detect change even with same file size", async () => {
      const content1 = "AAAA";
      writeFileSync(testFilePath, content1);
      const hash1 = await hashFile(testFilePath);

      const content2 = "BBBB"; // Same length, different content
      writeFileSync(testFilePath, content2);

      const result = await detectChanges(testFilePath, hash1.hash!);

      expect(result.changed).toBe(true);
    });

    test("should handle deleted file", async () => {
      const content = "To be deleted";
      writeFileSync(testFilePath, content);
      const hash = await hashFile(testFilePath);

      // Delete file
      rmSync(testFilePath);

      const result = await detectChanges(testFilePath, hash.hash!);

      expect(result.changed).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.fileDeleted).toBe(true);
    });
  });

  describe("hash metadata storage", () => {
    const metadataDir = join(TEST_DIR, "metadata");
    let testFilePath: string;

    beforeEach(() => {
      testFilePath = join(TEST_DIR, `meta-${Date.now()}.txt`);
      if (!existsSync(metadataDir)) {
        mkdirSync(metadataDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (existsSync(testFilePath)) {
        rmSync(testFilePath);
      }
      clearHashMetadata(metadataDir);
    });

    test("should save hash metadata", async () => {
      const content = "Content to save";
      writeFileSync(testFilePath, content);

      const hashResult = await hashFile(testFilePath);
      const saved = await saveHashMetadata(testFilePath, hashResult, metadataDir);

      expect(saved.success).toBe(true);
    });

    test("should load saved hash metadata", async () => {
      const content = "Content to load";
      writeFileSync(testFilePath, content);

      const hashResult = await hashFile(testFilePath);
      await saveHashMetadata(testFilePath, hashResult, metadataDir);

      const loaded = await loadHashMetadata(testFilePath, metadataDir);

      expect(loaded).toBeDefined();
      expect(loaded!.hash).toBe(hashResult.hash);
      expect(loaded!.path).toBe(testFilePath);
    });

    test("should return null for file without saved metadata", async () => {
      const loaded = await loadHashMetadata("/nonexistent/file.txt", metadataDir);

      expect(loaded).toBeNull();
    });

    test("should update existing metadata", async () => {
      const content1 = "Initial content";
      writeFileSync(testFilePath, content1);
      const hash1 = await hashFile(testFilePath);
      await saveHashMetadata(testFilePath, hash1, metadataDir);

      // Update file
      const content2 = "Updated content";
      writeFileSync(testFilePath, content2);
      const hash2 = await hashFile(testFilePath);
      await saveHashMetadata(testFilePath, hash2, metadataDir);

      const loaded = await loadHashMetadata(testFilePath, metadataDir);

      expect(loaded!.hash).toBe(hash2.hash);
      expect(loaded!.hash).not.toBe(hash1.hash);
    });
  });

  describe("CLI interface", () => {
    let testFilePath: string;

    beforeEach(() => {
      testFilePath = join(TEST_DIR, `cli-${Date.now()}.txt`);
    });

    afterEach(() => {
      if (existsSync(testFilePath)) {
        rmSync(testFilePath);
      }
    });

    function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
      return new Promise((resolve) => {
        const proc = spawn("bun", [TOOL_PATH, ...args], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 });
        });
      });
    }

    test("should output hash for file", async () => {
      const content = "CLI test content";
      writeFileSync(testFilePath, content);

      const { stdout, code } = await runCLI([testFilePath]);

      expect(code).toBe(0);
      expect(stdout).toHaveLength(64);
    });

    test("should output JSON with --json flag", async () => {
      const content = "CLI JSON test";
      writeFileSync(testFilePath, content);

      const { stdout, code } = await runCLI(["--json", testFilePath]);

      expect(code).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.hash).toHaveLength(64);
      expect(parsed.success).toBe(true);
      expect(parsed.path).toBe(testFilePath);
    });

    test("should show help with --help flag", async () => {
      const { stdout, code } = await runCLI(["--help"]);

      expect(code).toBe(0);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("FileHasher");
    });

    test("should handle multiple files", async () => {
      const file1 = join(TEST_DIR, "multi1.txt");
      const file2 = join(TEST_DIR, "multi2.txt");
      writeFileSync(file1, "Content 1");
      writeFileSync(file2, "Content 2");

      const { stdout, code } = await runCLI(["--json", file1, file2]);

      expect(code).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.files).toHaveLength(2);

      rmSync(file1);
      rmSync(file2);
    });

    test("should return error for non-existent file", async () => {
      const { stderr, code } = await runCLI(["/nonexistent/file.txt"]);

      expect(code).not.toBe(0);
      expect(stderr).toContain("Error");
    });

    test("should hash from stdin with - argument", async () => {
      const { stdout, code } = await runCLI(["--content", "Stdin test content"]);

      expect(code).toBe(0);
      expect(stdout).toHaveLength(64);
    });

    test("should check for changes with --check flag", async () => {
      const content = "Check test";
      writeFileSync(testFilePath, content);
      const { stdout: hash } = await runCLI([testFilePath]);

      // File unchanged
      const { stdout: unchanged, code: code1 } = await runCLI(["--check", hash.trim(), testFilePath]);
      expect(code1).toBe(0);
      expect(unchanged).toContain("unchanged");

      // Modify file
      writeFileSync(testFilePath, "Modified content");

      const { stdout: changed, code: code2 } = await runCLI(["--check", hash.trim(), testFilePath]);
      expect(code2).toBe(1); // Exit code 1 indicates change
      expect(changed).toContain("changed");
    });
  });
});
