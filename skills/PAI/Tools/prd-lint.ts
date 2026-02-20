#!/usr/bin/env bun
/**
 * PRD Linter — validates PRD files against PAI formatting rules.
 * Usage: bun prd-lint.ts <path-to-prd>
 * Exit 0 if valid, exit 1 if errors found.
 */

import { readFileSync } from "fs";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface LintError {
  line: number;
  severity: "error" | "warning";
  message: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const REQUIRED_FRONTMATTER = ["prd", "id", "status"];

const REQUIRED_SECTIONS = ["CONTEXT", "PLAN"];

const ACTION_VERBS = [
  "build", "create", "run", "implement", "add", "fix", "write",
  "deploy", "install", "configure", "setup", "update", "delete",
  "remove", "move", "copy", "test", "check", "verify", "ensure",
  "make", "set", "get", "send", "fetch", "parse", "handle",
  "generate", "compile", "start", "stop", "restart", "enable",
  "disable", "migrate", "refactor", "optimize", "validate",
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function parseFrontmatter(lines: string[]): { endLine: number; fields: Record<string, string> } {
  if (lines[0] !== "---") {
    return { endLine: 0, fields: {} };
  }

  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    return { endLine: 0, fields: {} };
  }

  const fields: Record<string, string> = {};
  for (let i = 1; i < endLine; i++) {
    const match = lines[i].match(/^(\w[\w_]*):\s*(.*)$/);
    if (match) {
      fields[match[1]] = match[2].trim();
    }
  }

  return { endLine, fields };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

// ─── Lint Checks ────────────────────────────────────────────────────────────────

function lintFrontmatter(lines: string[], errors: LintError[]): number {
  const { endLine, fields } = parseFrontmatter(lines);

  if (endLine === 0) {
    errors.push({ line: 1, severity: "error", message: "Missing YAML frontmatter (no opening ---)" });
    return 0;
  }

  for (const field of REQUIRED_FRONTMATTER) {
    if (!(field in fields) || fields[field] === "" || fields[field] === "null") {
      errors.push({
        line: 1,
        severity: "error",
        message: `Missing required frontmatter field: ${field}`,
      });
    }
  }

  return endLine;
}

function lintSections(lines: string[], errors: LintError[]): void {
  for (const section of REQUIRED_SECTIONS) {
    const pattern = new RegExp(`^##\\s+${section}\\b`, "i");
    const found = lines.findIndex(l => pattern.test(l));
    if (found === -1) {
      errors.push({
        line: lines.length,
        severity: "error",
        message: `Missing required section: ## ${section}`,
      });
    }
  }
}

function lintCriteria(lines: string[], errors: LintError[]): void {
  const criteriaRegex = /^- \[[ x]\] (ISC-[A-Za-z0-9-]+):\s*(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(criteriaRegex);
    if (!match) continue;

    const lineNum = i + 1;
    const id = match[1];
    const rest = match[2];

    const pipeIdx = rest.indexOf("| Verify:");
    const description = pipeIdx >= 0 ? rest.substring(0, pipeIdx).trim() : rest.trim();
    const hasVerify = pipeIdx >= 0;

    const wordCount = countWords(description);
    if (wordCount < 8 || wordCount > 12) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `${id}: Criteria must be 8-12 words (found ${wordCount}): "${description}"`,
      });
    }

    const firstWord = description.split(/\s+/)[0]?.toLowerCase();
    if (firstWord && ACTION_VERBS.includes(firstWord)) {
      errors.push({
        line: lineNum,
        severity: "warning",
        message: `${id}: Criteria should be state, not action (starts with verb "${firstWord}"): "${description}"`,
      });
    }

    if (!hasVerify) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `${id}: Missing verification method (expected "| Verify: ..." suffix)`,
      });
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

function run(): number {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    const help = [
      "PRD Linter — validates PRD files against PAI formatting rules",
      "",
      "Usage: bun prd-lint.ts <path-to-prd>",
      "",
      "Checks:",
      "  - Required frontmatter fields (prd, id, status)",
      "  - Required sections (CONTEXT, PLAN)",
      "  - ISC criteria word count (8-12 words)",
      "  - ISC criteria state-not-action (no leading verbs)",
      "  - ISC criteria verification methods (| Verify: suffix)",
      "",
      "Exit codes:",
      "  0  All checks passed",
      "  1  Errors found",
    ].join("\n");
    Bun.write(Bun.stdout, help + "\n");
    return 0;
  }

  const filePath = args[0];

  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Bun.write(Bun.stderr, `Error: Cannot read file: ${filePath}\n  ${msg}\n`);
    return 1;
  }

  const lines = fileContent.split("\n");
  const errors: LintError[] = [];

  lintFrontmatter(lines, errors);
  lintSections(lines, errors);
  lintCriteria(lines, errors);

  if (errors.length === 0) {
    Bun.write(Bun.stdout, `✅ ${filePath}: All checks passed\n`);
    return 0;
  }

  errors.sort((a, b) => a.line - b.line);

  const errorCount = errors.filter(e => e.severity === "error").length;
  const warnCount = errors.filter(e => e.severity === "warning").length;

  const output: string[] = [];
  for (const err of errors) {
    const icon = err.severity === "error" ? "❌" : "⚠️";
    output.push(`${icon} Line ${err.line}: ${err.message}`);
  }
  output.push("");
  output.push(`Found ${errorCount} error(s), ${warnCount} warning(s) in ${filePath}`);

  Bun.write(Bun.stdout, output.join("\n") + "\n");

  return errorCount > 0 ? 1 : 0;
}

process.exitCode = run();
