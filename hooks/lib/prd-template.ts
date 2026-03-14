/**
 * prd-template.ts — PRD template generation for the Algorithm
 *
 * Generates PRD files following PRDFORMAT.md v2.0 specification.
 * Used by PRDSync hook and Algorithm CLI.
 */

export interface PRDConfig {
  task: string;
  slug: string;
  effort: 'Standard' | 'Extended' | 'Advanced' | 'Deep' | 'Comprehensive';
  mode: 'interactive' | 'loop';
  problemSpace?: string;
  keyFiles?: Array<{ path: string; role: string }>;
  constraints?: string[];
}

export interface PRDCriterion {
  id: string;
  description: string;
  type: 'criterion' | 'anti-criterion';
  status: 'pending' | 'completed' | 'failed';
  verify?: string;
  evidence?: string;
}

/**
 * Generate a new PRD from config
 */
export function generatePRD(config: PRDConfig): string {
  const now = new Date().toISOString();
  const lines: string[] = [
    '---',
    `task: ${config.task}`,
    `slug: ${config.slug}`,
    `effort: ${config.effort}`,
    `phase: observe`,
    `progress: 0/0`,
    `mode: ${config.mode}`,
    `started: ${now}`,
    `updated: ${now}`,
    '---',
    '',
    `## Context`,
    '',
    `### Problem Space`,
    config.problemSpace || 'TBD',
    '',
    `### Key Files`,
    ...(config.keyFiles?.map(f => `- \`${f.path}\` — ${f.role}`) || ['TBD']),
    '',
    `### Constraints`,
    ...(config.constraints?.map(c => `- ${c}`) || ['TBD']),
    '',
    `### Decisions Made`,
    'None yet.',
    '',
    `## Criteria`,
    '',
    '(Criteria will be added during OBSERVE phase)',
    '',
    `## Decisions`,
    '',
    '',
    `## Verification`,
    '',
    '',
  ];
  return lines.join('\n');
}

/**
 * Format a criterion line for the PRD Criteria section
 */
export function formatCriterionLine(c: PRDCriterion): string {
  const checkbox = c.status === 'completed' ? '[x]' : '[ ]';
  const prefix = c.type === 'anti-criterion' ? 'ISC-A' : 'ISC-C';
  const id = c.id.startsWith('ISC-') ? c.id : `${prefix}${c.id}`;
  const verify = c.verify ? ` | Verify: ${c.verify}` : '';
  return `- ${checkbox} ${id}: ${c.description}${verify}`;
}

/**
 * Parse PRD frontmatter from file content
 */
export function parsePRDFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }
  return fields;
}

/**
 * Update a frontmatter field in PRD content
 */
export function updatePRDField(content: string, field: string, value: string): string {
  const regex = new RegExp(`^(${field}:)\\s*.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `$1 ${value}`);
  }
  // Field doesn't exist — add before closing ---
  return content.replace(/^---$/m, `${field}: ${value}\n---`);
}
