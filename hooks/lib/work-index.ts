#!/usr/bin/env bun
/**
 * work-index.ts — MEMORY/WORK index utility for Sentinel Dashboard
 *
 * Scans MEMORY/WORK directories and produces a consolidated JSON index
 * of all work sessions. Handles both legacy (META.yaml) and new (PRD.md
 * frontmatter) formats.
 *
 * Usage:
 *   bun work-index.ts                  # stdout JSON (all sessions)
 *   bun work-index.ts --recent 48h     # last 48 hours only
 *   bun work-index.ts --active         # active sessions only
 *   bun work-index.ts --write          # write to MEMORY/STATE/work.json
 *
 * Output: Array of WorkSession objects sorted by date (newest first)
 */

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const WORK_DIR = join(BASE_DIR, 'MEMORY', 'WORK');
const STATE_DIR = join(BASE_DIR, 'MEMORY', 'STATE');
const OUTPUT_FILE = join(STATE_DIR, 'work.json');

interface WorkSession {
  slug: string;
  title: string;
  status: 'active' | 'complete' | 'unknown';
  phase?: string;
  effort?: string;
  progress?: string;
  started: string;
  updated: string;
  source: 'prd' | 'meta' | 'dirname';
}

function parsePRDFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fields[key] = val;
  }
  return fields;
}

function parseMETAYaml(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fields[key] = val;
  }
  return fields;
}

function extractDateFromSlug(slug: string): string {
  // Format: YYYYMMDD-HHMMSS_description
  const m = slug.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  return new Date().toISOString();
}

function titleFromSlug(slug: string): string {
  // Strip date prefix, convert kebab to words
  const desc = slug.replace(/^\d{8}-\d{6}_/, '');
  return desc.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function scanWorkDir(): WorkSession[] {
  if (!existsSync(WORK_DIR)) return [];

  const entries = readdirSync(WORK_DIR);
  const sessions: WorkSession[] = [];

  for (const entry of entries) {
    const dirPath = join(WORK_DIR, entry);
    try {
      const stat = statSync(dirPath);
      if (!stat.isDirectory()) continue;
    } catch { continue; }

    let session: WorkSession | null = null;

    // Try PRD.md first (new format)
    const prdPath = join(dirPath, 'PRD.md');
    if (existsSync(prdPath)) {
      try {
        const content = readFileSync(prdPath, 'utf-8');
        const fm = parsePRDFrontmatter(content);
        if (fm) {
          session = {
            slug: fm.slug || entry,
            title: fm.task || titleFromSlug(entry),
            status: fm.phase === 'complete' ? 'complete' : 'active',
            phase: fm.phase,
            effort: fm.effort,
            progress: fm.progress,
            started: fm.started || extractDateFromSlug(entry),
            updated: fm.updated || fm.started || extractDateFromSlug(entry),
            source: 'prd',
          };
        }
      } catch {}
    }

    // Fall back to META.yaml (legacy format)
    if (!session) {
      const metaPath = join(dirPath, 'META.yaml');
      if (existsSync(metaPath)) {
        try {
          const content = readFileSync(metaPath, 'utf-8');
          const meta = parseMETAYaml(content);
          session = {
            slug: meta.id || entry,
            title: meta.title || titleFromSlug(entry),
            status: (meta.status?.toLowerCase() === 'completed' || meta.status?.toLowerCase() === 'complete')
              ? 'complete' : (meta.status?.toLowerCase() === 'active' ? 'active' : 'unknown'),
            started: meta.created_at || extractDateFromSlug(entry),
            updated: meta.completed_at || meta.created_at || extractDateFromSlug(entry),
            source: 'meta',
          };
        } catch {}
      }
    }

    // Fall back to dirname only
    if (!session) {
      session = {
        slug: entry,
        title: titleFromSlug(entry),
        status: 'unknown',
        started: extractDateFromSlug(entry),
        updated: extractDateFromSlug(entry),
        source: 'dirname',
      };
    }

    sessions.push(session);
  }

  // Sort by started date, newest first
  sessions.sort((a, b) => b.started.localeCompare(a.started));
  return sessions;
}

function filterRecent(sessions: WorkSession[], hours: number): WorkSession[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return sessions.filter(s => s.updated >= cutoff || s.started >= cutoff);
}

// CLI interface
function main() {
  const args = process.argv.slice(2);
  let sessions = scanWorkDir();

  if (args.includes('--active')) {
    sessions = sessions.filter(s => s.status === 'active');
  }

  const recentIdx = args.indexOf('--recent');
  if (recentIdx !== -1 && args[recentIdx + 1]) {
    const raw = args[recentIdx + 1];
    const hours = raw.endsWith('h') ? parseInt(raw) : raw.endsWith('d') ? parseInt(raw) * 24 : parseInt(raw);
    sessions = filterRecent(sessions, hours);
  }

  const output = JSON.stringify(sessions, null, 2);

  if (args.includes('--write')) {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(OUTPUT_FILE, output);
    process.stderr.write(`[work-index] wrote ${sessions.length} sessions to ${OUTPUT_FILE}\n`);
  }

  console.log(output);
}

// Export for use as library
export { scanWorkDir, filterRecent, type WorkSession };

// Run if executed directly
if (import.meta.main) {
  main();
}
