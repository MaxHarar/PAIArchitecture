#!/usr/bin/env bun
/**
 * SecretScan - Self-contained credential and secret detection for PAI
 *
 * Zero external dependencies. Built-in pattern matching for 15+ secret types
 * plus Shannon entropy analysis for unknown key formats.
 *
 * Usage:
 *   bun SecretScan.ts                    # Scan staged git changes (default)
 *   bun SecretScan.ts --full             # Full repo scan
 *   bun SecretScan.ts --file path.ts     # Scan specific file
 *   bun SecretScan.ts --since HEAD~5     # Scan recent commits
 *   bun SecretScan.ts --json             # Output as JSON
 *
 * Exit codes:
 *   0 = clean (no secrets found)
 *   1 = secrets detected
 *
 * Part of PAI CORE Tools.
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";

// ============================================================================
// Types
// ============================================================================

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
}

interface Finding {
  file: string;
  line: number;
  patternName: string;
  severity: "critical" | "high" | "medium";
  matchRedacted: string;
}

interface ScanResult {
  mode: string;
  findings: Finding[];
  filesScanned: number;
  timestamp: string;
  clean: boolean;
}

// ============================================================================
// Secret Patterns
// ============================================================================

const SECRET_PATTERNS: SecretPattern[] = [
  // Cloud providers
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
  { name: "AWS Secret Key", pattern: /(?:aws)?_?(?:secret)?_?(?:access)?_?key\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/gi, severity: "critical" },

  // AI/ML API keys (OpenAI uses sk-proj-, sk-svcacct-, etc.)
  { name: "OpenAI Key", pattern: /sk-[a-zA-Z0-9\-]{20,}/g, severity: "critical" },
  { name: "Anthropic Key", pattern: /sk-ant-[a-zA-Z0-9\-]{20,}/g, severity: "critical" },
  { name: "ElevenLabs Key", pattern: /sk_[a-f0-9]{32,}/g, severity: "critical" },
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z\-_]{35}/g, severity: "critical" },

  // Source control / DevOps
  { name: "GitHub Token", pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, severity: "critical" },
  { name: "GitHub Fine-Grained Token", pattern: /github_pat_[A-Za-z0-9_]{22,}/g, severity: "critical" },

  // Messaging / communication
  { name: "Slack Token", pattern: /xox[bpors]-[0-9]{10,13}-[a-zA-Z0-9\-]+/g, severity: "critical" },
  { name: "Telegram Bot Token", pattern: /[0-9]{8,10}:AA[A-Za-z0-9_\-]{30,}/g, severity: "critical" },

  // Auth tokens (Bearer requires 20+ char token to avoid template matches)
  { name: "Bearer Token", pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]{20,}=*/g, severity: "high" },
  { name: "JWT Token", pattern: /eyJ[A-Za-z0-9\-_]{10,}\.eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_.+/=]{10,}/g, severity: "high" },

  // Cryptographic material
  { name: "Private Key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, severity: "critical" },

  // Generic patterns
  { name: "Generic API Key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi, severity: "high" },
  { name: "Generic Secret", pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi, severity: "high" },

  // High-entropy hex (catch-all; entropy-filtered in isFalsePositive)
  { name: "High Entropy Hex", pattern: /['"][0-9a-f]{40,}['"]/gi, severity: "medium" },
];

// ============================================================================
// Skip / False-Positive Filters
// ============================================================================

const SKIP_PATH_PATTERNS: RegExp[] = [
  /node_modules/,
  /\.git\//,
  /target\//,
  /dist\//,
  /build\//,
  /\.lock$/,
  /\.wasm$/,
  /\.png$|\.jpg$|\.jpeg$|\.gif$|\.ico$|\.icns$|\.svg$/,
  /\.woff$|\.woff2$|\.ttf$|\.eot$/,
  /\.mp3$|\.mp4$|\.wav$|\.ogg$|\.webm$/,
  /\.pdf$|\.zip$|\.tar$|\.gz$/,
  /bun\.lockb$/,
  /\.onnx$/,
  /MEMORY\//,
  /tsbuildinfo$/,
  /\.min\.js$/,
  /\.map$/,
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
  ".pdf", ".zip", ".tar", ".gz", ".bz2",
  ".wasm", ".onnx", ".bin", ".lockb",
  ".pem", ".key", ".der", ".p12",
]);

const FALSE_POSITIVE_PATTERNS: RegExp[] = [
  /example|sample|placeholder|your[_-]?key|xxx|TODO|CHANGEME/i,
  /test[_-]?key|mock|dummy|fake|fixture/i,
  /(.)\1{7,}/i, // 8+ repeated chars indicate placeholder/test data
  /pattern|regex|regexp/i, // Pattern definitions (like this file)
  /sk-[a-zA-Z0-9]{20,}/g.source ? /\/sk-\[/ : /^$/, // Regex source definitions
];

// ============================================================================
// Entropy Calculation
// ============================================================================

function shannonEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ============================================================================
// Core Scanning Logic
// ============================================================================

function shouldSkipPath(filePath: string): boolean {
  return SKIP_PATH_PATTERNS.some((p) => p.test(filePath));
}

function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isFalsePositive(matchText: string, lineText: string): boolean {
  // Check if the match itself looks like a placeholder
  if (FALSE_POSITIVE_PATTERNS.some((p) => p.test(matchText))) return true;

  // Check if the surrounding line is a pattern definition (regex literal, comment about patterns)
  if (/\/.*\/[gims]*/.test(lineText) && lineText.includes("pattern")) return true;
  if (lineText.trimStart().startsWith("//") || lineText.trimStart().startsWith("*") || lineText.trimStart().startsWith("#")) {
    // Comments describing patterns (like in this very file) are not secrets
    if (/pattern|regex|detect|match|check|scan/i.test(lineText)) return true;
  }

  // Template/placeholder Bearer tokens in docs: Bearer ${TOKEN}, Bearer <token>, Bearer YOUR_TOKEN
  if (/Bearer\s+[\$<{]|Bearer\s+YOUR_/i.test(matchText)) return true;
  if (/\$\{|<[a-zA-Z_]+>|\{\{/.test(lineText) && /bearer/i.test(lineText)) return true;

  // Low-entropy hex strings are likely not secrets (hashes, checksums, build IDs)
  if (/^['"][0-9a-f]{32,}['"]$/i.test(matchText)) {
    const hex = matchText.slice(1, -1);
    if (shannonEntropy(hex) < 3.5) return true;
  }

  return false;
}

function redact(match: string): string {
  if (match.length <= 8) return "****";
  const visible = Math.min(4, Math.floor(match.length * 0.15));
  return match.slice(0, visible) + "****" + match.slice(-visible);
}

function scanContent(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (const secretPattern of SECRET_PATTERNS) {
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // Reset regex lastIndex for global patterns
      secretPattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = secretPattern.pattern.exec(line)) !== null) {
        const matchText = match[0];

        // Skip false positives
        if (isFalsePositive(matchText, line)) continue;

        findings.push({
          file: filePath,
          line: lineIdx + 1,
          patternName: secretPattern.name,
          severity: secretPattern.severity,
          matchRedacted: redact(matchText),
        });
      }
    }
  }

  return findings;
}

// ============================================================================
// Scan Modes
// ============================================================================

function scanStaged(repoRoot: string): ScanResult {
  let diff: string;
  try {
    diff = execSync("git diff --cached --diff-filter=ACM -U0", {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    console.error("Error: Not a git repository or no staged changes.");
    return { mode: "staged", findings: [], filesScanned: 0, timestamp: new Date().toISOString(), clean: true };
  }

  if (!diff.trim()) {
    return { mode: "staged", findings: [], filesScanned: 0, timestamp: new Date().toISOString(), clean: true };
  }

  // Parse unified diff to extract file/line/content
  const findings: Finding[] = [];
  const filesScanned = new Set<string>();
  let currentFile = "";
  let currentHunkLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      filesScanned.add(currentFile);
    } else if (line.startsWith("@@ ")) {
      // Parse hunk header: @@ -old,count +new,count @@
      const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      currentHunkLine = hunkMatch ? parseInt(hunkMatch[1], 10) - 1 : 0;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunkLine++;
      const addedContent = line.slice(1);

      if (currentFile && !shouldSkipPath(currentFile) && !isBinaryFile(currentFile)) {
        const lineFindings = scanContent(addedContent, currentFile);
        for (const f of lineFindings) {
          f.line = currentHunkLine;
          findings.push(f);
        }
      }
    } else if (!line.startsWith("-")) {
      currentHunkLine++;
    }
  }

  return {
    mode: "staged",
    findings,
    filesScanned: filesScanned.size,
    timestamp: new Date().toISOString(),
    clean: findings.length === 0,
  };
}

function scanFile(filePath: string): ScanResult {
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    return { mode: "file", findings: [], filesScanned: 0, timestamp: new Date().toISOString(), clean: true };
  }

  if (isBinaryFile(filePath)) {
    return { mode: "file", findings: [], filesScanned: 1, timestamp: new Date().toISOString(), clean: true };
  }

  const content = readFileSync(filePath, "utf-8");
  const findings = scanContent(content, filePath);

  return {
    mode: "file",
    findings,
    filesScanned: 1,
    timestamp: new Date().toISOString(),
    clean: findings.length === 0,
  };
}

function scanFullRepo(repoRoot: string): ScanResult {
  const findings: Finding[] = [];
  let filesScanned = 0;

  // Get tracked files from git to respect .gitignore
  let trackedFiles: string[];
  try {
    const output = execSync("git ls-files", {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    trackedFiles = output.split("\n").filter(Boolean);
  } catch {
    // Fallback: walk the directory manually
    trackedFiles = walkDir(repoRoot, repoRoot);
  }

  for (const relPath of trackedFiles) {
    if (shouldSkipPath(relPath) || isBinaryFile(relPath)) continue;

    const fullPath = join(repoRoot, relPath);
    if (!existsSync(fullPath)) continue;

    try {
      const stat = statSync(fullPath);
      // Skip files larger than 1MB
      if (stat.size > 1024 * 1024) continue;

      const content = readFileSync(fullPath, "utf-8");
      const fileFindings = scanContent(content, relPath);
      findings.push(...fileFindings);
      filesScanned++;
    } catch {
      // Skip files that can't be read
    }
  }

  return {
    mode: "full",
    findings,
    filesScanned,
    timestamp: new Date().toISOString(),
    clean: findings.length === 0,
  };
}

function scanSince(repoRoot: string, ref: string): ScanResult {
  let diff: string;
  try {
    diff = execSync(`git diff ${ref} HEAD -U0`, {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`Error: Could not diff against ref '${ref}'.`);
    return { mode: "since", findings: [], filesScanned: 0, timestamp: new Date().toISOString(), clean: true };
  }

  if (!diff.trim()) {
    return { mode: "since", findings: [], filesScanned: 0, timestamp: new Date().toISOString(), clean: true };
  }

  const findings: Finding[] = [];
  const filesScanned = new Set<string>();
  let currentFile = "";
  let currentHunkLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      filesScanned.add(currentFile);
    } else if (line.startsWith("@@ ")) {
      const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      currentHunkLine = hunkMatch ? parseInt(hunkMatch[1], 10) - 1 : 0;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunkLine++;
      const addedContent = line.slice(1);

      if (currentFile && !shouldSkipPath(currentFile) && !isBinaryFile(currentFile)) {
        const lineFindings = scanContent(addedContent, currentFile);
        for (const f of lineFindings) {
          f.line = currentHunkLine;
          findings.push(f);
        }
      }
    } else if (!line.startsWith("-")) {
      currentHunkLine++;
    }
  }

  return {
    mode: `since:${ref}`,
    findings,
    filesScanned: filesScanned.size,
    timestamp: new Date().toISOString(),
    clean: findings.length === 0,
  };
}

// ============================================================================
// Directory Walker (fallback when git ls-files unavailable)
// ============================================================================

function walkDir(dir: string, root: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(root, fullPath);

      if (shouldSkipPath(relPath)) continue;

      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath, root));
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  } catch {
    // Skip directories we can't read
  }
  return results;
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatHumanReadable(result: ScanResult): void {
  console.log(`\nSecretScan Results`);
  console.log("=".repeat(60));
  console.log(`Mode:           ${result.mode}`);
  console.log(`Files scanned:  ${result.filesScanned}`);
  console.log(`Timestamp:      ${result.timestamp}`);
  console.log("");

  if (result.clean) {
    console.log("No secrets detected. Clean scan.");
    return;
  }

  console.log(`FINDINGS: ${result.findings.length} potential secret(s) detected\n`);

  // Group by severity
  const critical = result.findings.filter((f) => f.severity === "critical");
  const high = result.findings.filter((f) => f.severity === "high");
  const medium = result.findings.filter((f) => f.severity === "medium");

  if (critical.length > 0) {
    console.log(`[CRITICAL] ${critical.length} finding(s)`);
    console.log("-".repeat(60));
    for (const f of critical) {
      console.log(`  ${f.file}:${f.line}`);
      console.log(`    Pattern:  ${f.patternName}`);
      console.log(`    Match:    ${f.matchRedacted}`);
      console.log("");
    }
  }

  if (high.length > 0) {
    console.log(`[HIGH] ${high.length} finding(s)`);
    console.log("-".repeat(60));
    for (const f of high) {
      console.log(`  ${f.file}:${f.line}`);
      console.log(`    Pattern:  ${f.patternName}`);
      console.log(`    Match:    ${f.matchRedacted}`);
      console.log("");
    }
  }

  if (medium.length > 0) {
    console.log(`[MEDIUM] ${medium.length} finding(s)`);
    console.log("-".repeat(60));
    for (const f of medium) {
      console.log(`  ${f.file}:${f.line}`);
      console.log(`    Pattern:  ${f.patternName}`);
      console.log(`    Match:    ${f.matchRedacted}`);
      console.log("");
    }
  }

  console.log("=".repeat(60));
  console.log("ACTIONS:");
  console.log("  1. Rotate/revoke any confirmed credentials immediately");
  console.log("  2. Move secrets to environment variables or a vault");
  console.log("  3. Add sensitive files to .gitignore");
  console.log("  4. Use BFG Repo-Cleaner to purge from git history if needed");
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);

  let mode: "staged" | "full" | "file" | "since" = "staged";
  let filePath = "";
  let sinceRef = "";
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--staged":
        mode = "staged";
        break;
      case "--full":
        mode = "full";
        break;
      case "--file":
        mode = "file";
        filePath = args[++i] || "";
        break;
      case "--since":
        mode = "since";
        sinceRef = args[++i] || "";
        break;
      case "--json":
        jsonOutput = true;
        break;
      case "--help":
      case "-h":
        console.log(`SecretScan - Credential and secret detection for PAI

Usage:
  bun SecretScan.ts                    Scan staged git changes (default)
  bun SecretScan.ts --full             Full repo scan (git-tracked files)
  bun SecretScan.ts --file <path>      Scan a specific file
  bun SecretScan.ts --since <ref>      Scan changes since a git ref
  bun SecretScan.ts --json             Output results as JSON

Options:
  --staged       Scan staged git changes (default mode)
  --full         Scan all tracked files in the repository
  --file <path>  Scan a single file
  --since <ref>  Scan diff between <ref> and HEAD
  --json         Output structured JSON instead of human-readable text
  -h, --help     Show this help message

Exit codes:
  0  Clean - no secrets found
  1  Secrets detected

Detected patterns (${SECRET_PATTERNS.length}):
${SECRET_PATTERNS.map((p) => `  - ${p.name} (${p.severity})`).join("\n")}
`);
        process.exit(0);
    }
  }

  // Determine repo root
  let repoRoot: string;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    repoRoot = process.cwd();
  }

  // Execute scan
  let result: ScanResult;

  switch (mode) {
    case "staged":
      result = scanStaged(repoRoot);
      break;
    case "full":
      result = scanFullRepo(repoRoot);
      break;
    case "file":
      if (!filePath) {
        console.error("Error: --file requires a path argument");
        process.exit(1);
      }
      result = scanFile(filePath);
      break;
    case "since":
      if (!sinceRef) {
        console.error("Error: --since requires a git ref argument");
        process.exit(1);
      }
      result = scanSince(repoRoot, sinceRef);
      break;
  }

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    formatHumanReadable(result);
  }

  // Exit code: 1 if secrets found, 0 if clean
  process.exit(result.clean ? 0 : 1);
}

if (import.meta.main) {
  main();
}

// Export for programmatic use
export { scanStaged, scanFullRepo, scanFile, scanSince, scanContent, SECRET_PATTERNS };
export type { Finding, ScanResult, SecretPattern };
