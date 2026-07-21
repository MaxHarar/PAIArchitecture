#!/usr/bin/env bun
/**
 * ============================================================================
 * FILEHASHER - SHA-256 Content-Based Change Detection Utility
 * ============================================================================
 *
 * PURPOSE:
 * Provides SHA-256 content hashing for files to detect actual content changes
 * (not just metadata/timestamp changes). Based on ClawdBot/Moltbot memory
 * system research which uses content hashing for reliable change detection.
 *
 * USAGE:
 *   # Hash a file (outputs just the hash)
 *   bun FileHasher.ts /path/to/file
 *
 *   # Hash with JSON output
 *   bun FileHasher.ts --json /path/to/file
 *
 *   # Hash multiple files
 *   bun FileHasher.ts --json file1.txt file2.txt
 *
 *   # Hash content directly
 *   bun FileHasher.ts --content "string to hash"
 *
 *   # Check if file changed from known hash
 *   bun FileHasher.ts --check <previous_hash> /path/to/file
 *
 * OPTIONS:
 *   --json         Output full JSON result with metadata
 *   --content      Hash a string directly instead of file
 *   --check <hash> Compare file against known hash
 *   --help         Show usage information
 *
 * PROGRAMMATIC USAGE:
 *   import { hashFile, hashContent, detectChanges } from './FileHasher';
 *
 *   const result = await hashFile('/path/to/file');
 *   const hash = await hashContent('string to hash');
 *   const changed = await detectChanges('/path/to/file', previousHash);
 *
 * ============================================================================
 */

import { createHash, type Hash } from "crypto";
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "fs";
import { readFile } from "fs/promises";
import { basename, join } from "path";

// =============================================================================
// TYPES
// =============================================================================

export interface HashResult {
  success: boolean;
  hash?: string;
  algorithm: string;
  path?: string;
  size?: number;
  hashedAt?: number;
  streaming?: boolean;
  error?: string;
}

export interface HashMetadata {
  hash: string;
  path: string;
  size: number;
  hashedAt: number;
  algorithm: string;
}

export interface ChangeDetectionResult {
  changed: boolean;
  previousHash: string;
  currentHash?: string;
  fileDeleted?: boolean;
  error?: string;
}

export interface HashOptions {
  streaming?: boolean;
}

export interface SaveResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Hash string content directly using SHA-256
 */
export async function hashContent(content: string): Promise<HashResult> {
  try {
    const hash = createHash("sha256");
    hash.update(content, "utf8");
    const hashHex = hash.digest("hex");

    return {
      success: true,
      hash: hashHex,
      algorithm: "sha256",
      size: Buffer.byteLength(content, "utf8"),
      hashedAt: Date.now(),
    };
  } catch (err) {
    return {
      success: false,
      algorithm: "sha256",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Hash file content using SHA-256
 * Supports streaming for large files to avoid memory issues
 */
export async function hashFile(filePath: string, options: HashOptions = {}): Promise<HashResult> {
  const { streaming = false } = options;

  try {
    // Check if file exists
    if (!existsSync(filePath)) {
      return {
        success: false,
        algorithm: "sha256",
        path: filePath,
        error: `ENOENT: no such file or directory '${filePath}'`,
      };
    }

    const stats = statSync(filePath);
    const size = stats.size;
    const hashedAt = Date.now();

    let hashHex: string;

    if (streaming) {
      // Streaming mode for large files
      hashHex = await hashFileStreaming(filePath);
    } else {
      // Read entire file into memory (faster for small files)
      const content = await readFile(filePath);
      const hash = createHash("sha256");
      hash.update(content);
      hashHex = hash.digest("hex");
    }

    return {
      success: true,
      hash: hashHex,
      algorithm: "sha256",
      path: filePath,
      size,
      hashedAt,
      streaming,
    };
  } catch (err) {
    return {
      success: false,
      algorithm: "sha256",
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Hash file using streaming (for large files)
 */
async function hashFileStreaming(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });

    stream.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Detect if file content has changed compared to a known hash
 */
export async function detectChanges(filePath: string, previousHash: string): Promise<ChangeDetectionResult> {
  try {
    // Check if file exists
    if (!existsSync(filePath)) {
      return {
        changed: true,
        previousHash,
        fileDeleted: true,
        error: `File no longer exists: ${filePath}`,
      };
    }

    const result = await hashFile(filePath);

    if (!result.success) {
      return {
        changed: true,
        previousHash,
        error: result.error,
      };
    }

    const currentHash = result.hash!;
    const changed = currentHash !== previousHash;

    return {
      changed,
      previousHash,
      currentHash,
    };
  } catch (err) {
    return {
      changed: true,
      previousHash,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// METADATA STORAGE
// =============================================================================

/**
 * Generate a safe filename from file path for metadata storage
 */
function getMetadataFilename(filePath: string): string {
  // Create a hash of the path to avoid filesystem issues with special chars
  const pathHash = createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  const baseName = basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${baseName}_${pathHash}.json`;
}

/**
 * Save hash metadata for a file
 */
export async function saveHashMetadata(
  filePath: string,
  hashResult: HashResult,
  metadataDir: string
): Promise<SaveResult> {
  try {
    // Ensure metadata directory exists
    if (!existsSync(metadataDir)) {
      mkdirSync(metadataDir, { recursive: true });
    }

    const metadata: HashMetadata = {
      hash: hashResult.hash!,
      path: filePath,
      size: hashResult.size!,
      hashedAt: hashResult.hashedAt!,
      algorithm: hashResult.algorithm,
    };

    const metadataPath = join(metadataDir, getMetadataFilename(filePath));
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Load hash metadata for a file
 */
export async function loadHashMetadata(
  filePath: string,
  metadataDir: string
): Promise<HashMetadata | null> {
  try {
    const metadataPath = join(metadataDir, getMetadataFilename(filePath));

    if (!existsSync(metadataPath)) {
      return null;
    }

    const content = readFileSync(metadataPath, "utf8");
    return JSON.parse(content) as HashMetadata;
  } catch {
    return null;
  }
}

/**
 * Clear all hash metadata in a directory
 */
export function clearHashMetadata(metadataDir: string): void {
  try {
    if (existsSync(metadataDir)) {
      const files = readdirSync(metadataDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          rmSync(join(metadataDir, file));
        }
      }
    }
  } catch {
    // Ignore errors during cleanup
  }
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

function printHelp(): void {
  console.log(`
FileHasher - SHA-256 Content-Based Change Detection

Usage:
  bun FileHasher.ts [options] <file> [file2 ...]
  bun FileHasher.ts --content <string>
  bun FileHasher.ts --check <hash> <file>

Options:
  --json         Output full JSON result with metadata
  --content      Hash a string directly instead of file
  --check <hash> Compare file against known hash (exit 0=unchanged, 1=changed)
  --help         Show this help message

Examples:
  # Hash a single file
  bun FileHasher.ts /path/to/file.txt

  # Hash with JSON output
  bun FileHasher.ts --json /path/to/file.txt

  # Hash multiple files
  bun FileHasher.ts --json file1.txt file2.txt

  # Hash a string directly
  bun FileHasher.ts --content "Hello, World!"

  # Check if file changed
  bun FileHasher.ts --check abc123... /path/to/file.txt
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  let jsonOutput = false;
  let contentMode = false;
  let checkMode = false;
  let checkHash = "";
  const files: string[] = [];

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--content") {
      contentMode = true;
      // Next arg is the content to hash
      if (i + 1 < args.length) {
        i++;
        const result = await hashContent(args[i]);
        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          console.log(result.hash);
        } else {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
        return;
      } else {
        console.error("Error: --content requires a string argument");
        process.exit(1);
      }
    } else if (arg === "--check") {
      checkMode = true;
      if (i + 1 < args.length) {
        i++;
        checkHash = args[i];
      } else {
        console.error("Error: --check requires a hash argument");
        process.exit(1);
      }
    } else if (!arg.startsWith("--")) {
      files.push(arg);
    }
  }

  // Check mode
  if (checkMode) {
    if (files.length === 0) {
      console.error("Error: --check requires a file path");
      process.exit(1);
    }

    const result = await detectChanges(files[0], checkHash);

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.changed) {
        console.log(`changed: ${files[0]}`);
        process.exit(1);
      } else {
        console.log(`unchanged: ${files[0]}`);
        process.exit(0);
      }
    }
    return;
  }

  // Hash files
  if (files.length === 0) {
    console.error("Error: No files specified");
    process.exit(1);
  }

  if (files.length === 1 && !jsonOutput) {
    // Single file, simple output
    const result = await hashFile(files[0]);
    if (result.success) {
      console.log(result.hash);
    } else {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
    return;
  }

  // Multiple files or JSON output
  const results: HashResult[] = [];
  for (const file of files) {
    const result = await hashFile(file);
    results.push(result);
  }

  if (jsonOutput) {
    if (files.length === 1) {
      console.log(JSON.stringify(results[0], null, 2));
    } else {
      console.log(JSON.stringify({ files: results }, null, 2));
    }
  } else {
    for (const result of results) {
      if (result.success) {
        console.log(`${result.hash}  ${result.path}`);
      } else {
        console.error(`Error: ${result.path}: ${result.error}`);
      }
    }
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
