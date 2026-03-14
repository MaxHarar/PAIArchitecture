#!/usr/bin/env bun
/**
 * LastResponseCache.hook.ts — Caches the last AI response for reference (Stop)
 *
 * Captures the final assistant message from each response and saves it to
 * a cache file. Other hooks and tools can read this to understand what
 * the AI just said without re-parsing transcripts.
 *
 * TRIGGER: Stop
 * PERFORMANCE: ~2ms. Writes a single small JSON file.
 *
 * Output: MEMORY/STATE/last-response.json
 * {
 *   sessionId: string,
 *   timestamp: ISO-8601,
 *   summary: string (first 500 chars of response),
 *   toolsUsed: string[] (tool names called in this response),
 *   phaseReached: string | null (algorithm phase if detected)
 * }
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const STATE_DIR = join(BASE_DIR, 'MEMORY', 'STATE');
const CACHE_FILE = join(STATE_DIR, 'last-response.json');

async function main() {
  // Stop hooks don't need to output continue
  let input: any;
  try {
    const reader = Bun.stdin.stream().getReader();
    let raw = '';
    const read = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += new TextDecoder().decode(value, { stream: true });
      }
    })();
    await Promise.race([read, new Promise<void>(r => setTimeout(r, 500))]);
    if (!raw.trim()) return;
    input = JSON.parse(raw);
  } catch { return; }

  const { session_id, transcript_path, stop_hook_active } = input;
  if (!session_id) return;

  // Extract info from the input (stop hooks get different data than PostToolUse)
  const toolsUsed: string[] = [];
  let summary = '';
  let phaseReached: string | null = null;

  // Try to get transcript summary from stop hook data
  if (input.tool_results) {
    for (const result of input.tool_results) {
      if (result.tool_name) toolsUsed.push(result.tool_name);
    }
  }

  // Extract summary from assistant content if available
  if (input.assistant_content) {
    summary = typeof input.assistant_content === 'string'
      ? input.assistant_content.slice(0, 500)
      : JSON.stringify(input.assistant_content).slice(0, 500);
  }

  // Detect phase from common patterns
  const phasePatterns: Record<string, string> = {
    'OBSERVE': 'observe', 'THINK': 'think', 'PLAN': 'plan',
    'BUILD': 'build', 'EXECUTE': 'execute', 'VERIFY': 'verify', 'LEARN': 'learn',
  };
  for (const [pattern, phase] of Object.entries(phasePatterns)) {
    if (summary.includes(`━━━ ${pattern} ━━━`) || summary.includes(`━━━.*${pattern}`)) {
      phaseReached = phase;
    }
  }

  // Write cache
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

  const cache = {
    sessionId: session_id,
    timestamp: new Date().toISOString(),
    summary,
    toolsUsed: [...new Set(toolsUsed)],
    phaseReached,
  };

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  process.stderr.write(`[LastResponseCache] cached (${toolsUsed.length} tools, phase: ${phaseReached || 'none'})\n`);
}

main().catch(() => {});
