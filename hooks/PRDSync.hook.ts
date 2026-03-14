#!/usr/bin/env bun
/**
 * PRDSync.hook.ts — Syncs Algorithm criteria and phase to PRD files (PostToolUse)
 *
 * Coexists with AlgorithmTracker.hook.ts (which handles working memory state).
 * This hook handles the PERSISTENT side: writing criteria and phase changes to PRD.md on disk.
 *
 * TRIGGER: PostToolUse (matcher: Bash, TaskCreate, TaskUpdate, Write, Edit)
 *
 * Responsibilities:
 * 1. Phase sync:     Voice curl detected → update PRD frontmatter phase field
 * 2. Criteria add:   TaskCreate for ISC → append criterion line to PRD Criteria section
 * 3. Criteria update: TaskUpdate status → update checkbox in PRD ([ ] → [x])
 * 4. PRD detection:  Write/Edit to PRD.md → link PRD path to session state
 *
 * PERFORMANCE: ~5ms. Never blocks — outputs continue immediately.
 * SAFETY: Read-only on algorithm state. Write-only to PRD files.
 */

import { findActivePRD, addCriterionToPRD, updateCriterionStatus, updatePRDPhase, linkPRDToSession } from './lib/prd-utils';
import { formatCriterionLine } from './lib/prd-template';
import type { PRDCriterion } from './lib/prd-template';

// Phase detection (mirrors AlgorithmTracker for voice curl matching)
const PHASE_MAP: Record<string, string> = {
  'entering the observe phase': 'observe',
  'entering the think phase': 'think',
  'entering the plan phase': 'plan',
  'entering the build phase': 'build',
  'entering the execute phase': 'execute',
  'entering the verify phase': 'verify',
  'entering the verify phase.': 'verify',
  'entering the learn phase': 'learn',
};

// Criterion ID patterns (mirrors AlgorithmTracker)
const CRITERION_PATTERNS = [
  /ISC-(C\d+):\s*(.+)/,
  /ISC-(A\d+):\s*(.+)/,
  /ISC-([\w]+-\d+):\s*(.+)/,
  /ISC-(A-[\w]+-\d+):\s*(.+)/,
];

function parseCriterion(text: string): { id: string; description: string; isAnti: boolean } | null {
  for (const p of CRITERION_PATTERNS) {
    const m = text.match(p);
    if (m) {
      const id = m[1];
      const isAnti = id.startsWith('A');
      return { id: `ISC-${id}`, description: m[2].trim(), isAnti };
    }
  }
  return null;
}

function detectPhaseFromCurl(command: string): string | null {
  if (!command.includes('localhost:8888') || !command.includes('/notify')) return null;
  const msgMatch = command.match(/"message"\s*:\s*"([^"]+)"/);
  if (!msgMatch) return null;
  const msg = msgMatch[1].toLowerCase();
  for (const [pattern, phase] of Object.entries(PHASE_MAP)) {
    if (msg.includes(pattern)) return phase;
  }
  return null;
}

async function main() {
  // Never block the AI — output continue immediately
  console.log(JSON.stringify({ continue: true }));

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
    await Promise.race([read, new Promise<void>(r => setTimeout(r, 200))]);
    if (!raw.trim()) return;
    input = JSON.parse(raw);
  } catch { return; }

  const { tool_name, tool_input, tool_result, session_id } = input;
  if (!session_id) return;

  // Find active PRD for this session
  const prdPath = findActivePRD(session_id);

  // ── 1. Bash → Phase sync from voice curls ──
  if (tool_name === 'Bash' && tool_input?.command && prdPath) {
    const phase = detectPhaseFromCurl(tool_input.command);
    if (phase) {
      updatePRDPhase(prdPath, phase);
      process.stderr.write(`[PRDSync] phase → ${phase}\n`);
    }
  }

  // ── 2. TaskCreate → Add criterion to PRD ──
  else if (tool_name === 'TaskCreate' && tool_input?.subject && prdPath) {
    const criterion = parseCriterion(tool_input.subject);
    if (criterion) {
      const c: PRDCriterion = {
        id: criterion.id,
        description: criterion.description,
        type: criterion.isAnti ? 'anti-criterion' : 'criterion',
        status: 'pending',
      };

      // Extract verify method if present (after | Verify:)
      const verifyMatch = criterion.description.match(/\|\s*Verify:\s*(.+)/);
      if (verifyMatch) {
        c.verify = verifyMatch[1].trim();
        c.description = criterion.description.replace(/\s*\|\s*Verify:\s*.+/, '').trim();
      }

      const line = formatCriterionLine(c);
      if (addCriterionToPRD(prdPath, line)) {
        process.stderr.write(`[PRDSync] criterion added: ${criterion.id}\n`);
      }
    }
  }

  // ── 3. TaskUpdate → Update criterion checkbox ──
  else if (tool_name === 'TaskUpdate' && tool_input?.taskId && prdPath) {
    const status = tool_input.status;
    if (status === 'completed' || status === 'deleted') {
      // Need to find criterion ID from task ID — check algorithm state
      try {
        const { join } = await import('path');
        const { existsSync, readFileSync } = await import('fs');
        const BASE = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
        const stateFile = join(BASE, 'MEMORY', 'STATE', 'algorithms', `${session_id}.json`);
        if (existsSync(stateFile)) {
          const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
          const criterion = state.criteria?.find((c: any) => c.taskId === tool_input.taskId);
          if (criterion) {
            const fullId = criterion.id.startsWith('ISC-') ? criterion.id : `ISC-${criterion.id}`;
            const passed = status === 'completed';
            if (updateCriterionStatus(prdPath, fullId, passed)) {
              process.stderr.write(`[PRDSync] criterion ${fullId}: ${passed ? 'PASS' : 'FAIL'}\n`);
            }
          }
        }
      } catch {}
    }
  }

  // ── 4. Write/Edit → Detect PRD creation and link to session ──
  else if ((tool_name === 'Write' || tool_name === 'Edit') && tool_input?.file_path) {
    const filePath = tool_input.file_path as string;
    if (filePath.endsWith('PRD.md') || filePath.includes('.prd/PRD-')) {
      linkPRDToSession(session_id, filePath);
      process.stderr.write(`[PRDSync] linked PRD: ${filePath}\n`);
    }
  }
}

main().catch(() => {});
