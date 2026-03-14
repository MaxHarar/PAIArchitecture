/**
 * prd-utils.ts — PRD file operations for hooks and tools
 *
 * Provides find, read, and update operations for PRD files.
 * Used by PRDSync.hook.ts and other PRD-aware components.
 *
 * PRD locations (checked in order):
 *   1. Algorithm state's prdPath field
 *   2. Project .prd/ directory (if in a git repo)
 *   3. MEMORY/WORK/{slug}/PRD.md (personal PRDs)
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { parsePRDFrontmatter, updatePRDField } from './prd-template';

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const WORK_DIR = join(BASE_DIR, 'MEMORY', 'WORK');

/**
 * Find the active PRD for a session.
 * Checks algorithm state first, then scans recent PRDs.
 */
export function findActivePRD(sessionId: string): string | null {
  // 1. Check algorithm state for explicit prdPath
  try {
    const stateFile = join(BASE_DIR, 'MEMORY', 'STATE', 'algorithms', `${sessionId}.json`);
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      if (state.prdPath && existsSync(state.prdPath)) {
        return state.prdPath;
      }
    }
  } catch {}

  // 2. Scan MEMORY/WORK for recent PRDs (last 24h)
  try {
    if (existsSync(WORK_DIR)) {
      const dirs = readdirSync(WORK_DIR)
        .filter(d => {
          const p = join(WORK_DIR, d);
          try { return statSync(p).isDirectory(); } catch { return false; }
        })
        .sort()
        .reverse(); // Most recent first

      for (const dir of dirs.slice(0, 10)) { // Check last 10
        const prdPath = join(WORK_DIR, dir, 'PRD.md');
        if (existsSync(prdPath)) {
          const content = readFileSync(prdPath, 'utf-8');
          const fm = parsePRDFrontmatter(content);
          // Only return PRDs that aren't complete
          if (fm.phase && fm.phase !== 'complete') {
            return prdPath;
          }
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Read a PRD file and return its content
 */
export function readPRD(prdPath: string): string | null {
  try {
    if (existsSync(prdPath)) {
      return readFileSync(prdPath, 'utf-8');
    }
  } catch {}
  return null;
}

/**
 * Add a criterion line to the Criteria section of a PRD
 */
export function addCriterionToPRD(prdPath: string, line: string): boolean {
  try {
    let content = readFileSync(prdPath, 'utf-8');

    // Find the Criteria section
    const criteriaIdx = content.indexOf('## Criteria');
    if (criteriaIdx === -1) return false;

    // Find the next section after Criteria
    const nextSectionIdx = content.indexOf('\n## ', criteriaIdx + 12);
    const insertPoint = nextSectionIdx !== -1 ? nextSectionIdx : content.length;

    // Insert before next section (or at end)
    const before = content.slice(0, insertPoint).trimEnd();
    const after = content.slice(insertPoint);

    content = before + '\n' + line + '\n' + after;

    // Update the updated timestamp
    content = updatePRDField(content, 'updated', new Date().toISOString());

    writeFileSync(prdPath, content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update a criterion's checkbox status in a PRD ([ ] → [x] or vice versa)
 */
export function updateCriterionStatus(prdPath: string, criterionId: string, passed: boolean): boolean {
  try {
    let content = readFileSync(prdPath, 'utf-8');

    // Match criterion line by ID
    const escapedId = criterionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^(- \\[)[ x](\\] ${escapedId}:.*)$`, 'm');
    const match = content.match(pattern);
    if (!match) return false;

    const newCheck = passed ? 'x' : ' ';
    content = content.replace(pattern, `$1${newCheck}$2`);

    // Update progress count
    const checks = content.match(/^- \[.\]/gm) || [];
    const total = checks.length;
    const passing = checks.filter(c => c === '- [x]').length;
    content = updatePRDField(content, 'progress', `${passing}/${total}`);
    content = updatePRDField(content, 'updated', new Date().toISOString());

    writeFileSync(prdPath, content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update the phase field in a PRD
 */
export function updatePRDPhase(prdPath: string, phase: string): boolean {
  try {
    let content = readFileSync(prdPath, 'utf-8');
    content = updatePRDField(content, 'phase', phase.toLowerCase());
    content = updatePRDField(content, 'updated', new Date().toISOString());
    writeFileSync(prdPath, content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Set the prdPath in algorithm state
 */
export function linkPRDToSession(sessionId: string, prdPath: string): boolean {
  try {
    const stateFile = join(BASE_DIR, 'MEMORY', 'STATE', 'algorithms', `${sessionId}.json`);
    if (!existsSync(stateFile)) return false;

    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    state.prdPath = prdPath;
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the WORK directory for a PRD if needed
 */
export function ensureWorkDir(slug: string): string {
  const dir = join(WORK_DIR, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
