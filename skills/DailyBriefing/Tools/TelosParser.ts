#!/usr/bin/env bun
/**
 * TelosParser - Enhanced TELOS Goals Integration
 *
 * Parses GOALS.md to extract progress tracking, next actions,
 * and formats goals with visual progress bars for the daily briefing.
 *
 * Features:
 * - Progress calculation from [x] / [ ] checkboxes
 * - Urgency detection from timeline keywords
 * - Emoji selection based on goal category
 * - Unicode progress bars
 * - Prioritization algorithm (imminent > high progress > active)
 * - Compact 3-goal output for daily briefing
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';

// =============================================================================
// Types
// =============================================================================

export type UrgencyLevel = 'imminent' | 'near' | 'distant';

export interface TelosGoal {
  id: string;                    // G0, G5, etc.
  title: string;                 // Goal title
  status: string;                // Active, In Progress, Planning
  targetTimeline: string;        // "End of 2026", "~1 week!", "Q2 2026"
  urgency: UrgencyLevel;         // Calculated from timeline
  totalTasks: number;            // Count of all [ ] and [x] in Progress section
  completedTasks: number;        // Count of [x] in Progress section
  progressPercent: number;       // completedTasks / totalTasks * 100
  nextAction: string | null;     // First unchecked [ ] item
  emoji: string;                 // Category-based emoji
}

// =============================================================================
// Progress Calculation
// =============================================================================

/**
 * Calculate progress percentage from completed/total tasks
 */
export function calculateProgress(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

// =============================================================================
// Urgency Detection
// =============================================================================

/**
 * Determine urgency level from timeline text
 *
 * Imminent: week, days, soon, tomorrow, today, this week
 * Near: Q1, Q2, first half of year, specific near months
 * Distant: End of year, Ongoing, Q3+, or unknown
 */
export function determineUrgency(timeline: string): UrgencyLevel {
  const lower = timeline.toLowerCase();

  // Imminent patterns
  const imminentPatterns = [
    /\bweek/,
    /\bdays?\b/,
    /\bsoon\b/,
    /\btomorrow\b/,
    /\btoday\b/,
    /this week/,
    /\bnow\b/,
    /\bimmediate/,
    /\bimminent/,
    /\baway\)/,  // "(1 week away)"
  ];

  for (const pattern of imminentPatterns) {
    if (pattern.test(lower)) {
      return 'imminent';
    }
  }

  // Near patterns (Q1, Q2, specific early months)
  const nearPatterns = [
    /\bq1\b/,
    /\bq2\b/,
    /\bjanuary\b/,
    /\bfebruary\b/,
    /\bmarch\b/,
    /\bapril\b/,
    /\bmay\b/,
    /\bjune\b/,
  ];

  for (const pattern of nearPatterns) {
    if (pattern.test(lower)) {
      return 'near';
    }
  }

  // Everything else is distant
  return 'distant';
}

// =============================================================================
// Emoji Selection
// =============================================================================

/**
 * Select emoji based on goal title/category keywords
 *
 * Order matters - check more specific patterns first,
 * then broader categories as fallbacks.
 */
export function selectEmoji(title: string): string {
  const lower = title.toLowerCase();

  // Education/study/learning - check FIRST (before legal, since "study for LSAT" = education)
  if (/\b(study|school|learn|education|read|mba|degree|book)\b/.test(lower)) {
    return '\uD83D\uDCDA'; // Books
  }

  // Money/income/financial
  if (/\b(income|financial|money|salary|raise|investment|savings|wealth)\b/.test(lower)) {
    return '\uD83D\uDCB0'; // Money bag
  }

  // Career/probation/job
  if (/\b(career|probation|job|work|promotion|professional)\b/.test(lower)) {
    return '\uD83D\uDD25'; // Fire
  }

  // Law/legal (after education, so "Study for LSAT" -> education, "Pass the Bar" -> legal)
  if (/\b(law|legal|attorney|lawyer|bar|lsat|court)\b/.test(lower)) {
    return '\u2696\uFE0F'; // Scales
  }

  // Health/fitness/physical
  if (/\b(physical|health|fitness|gym|run|workout|training|exercise|marathon)\b/.test(lower)) {
    return '\uD83D\uDCAA'; // Flexed bicep
  }

  // Default
  return '\uD83C\uDFAF'; // Bullseye/target
}

// =============================================================================
// Progress Bar Generation
// =============================================================================

/**
 * Generate a 10-character unicode progress bar
 *
 * Uses unicode block characters:
 * - Filled: \u2593 (dark shade block)
 * - Empty: \u2591 (light shade block)
 *
 * Rounding: floor to avoid showing progress that isn't there
 * (e.g., 5% -> 0 blocks, 15% -> 1 block, 95% -> 9 blocks)
 */
export function generateProgressBar(percent: number): string {
  const filledBlocks = Math.floor(percent / 10);
  const emptyBlocks = 10 - filledBlocks;

  const filled = '\u2593'; // Dark shade
  const empty = '\u2591';  // Light shade

  return filled.repeat(filledBlocks) + empty.repeat(emptyBlocks);
}

// =============================================================================
// Goal Parsing
// =============================================================================

/**
 * Parse GOALS.md content and extract goal information
 */
export function parseGoalsFile(content: string): TelosGoal[] {
  const goals: TelosGoal[] = [];
  const lines = content.split('\n');

  let currentGoal: Partial<TelosGoal> | null = null;
  let inProgressSection = false;
  let progressTasks: { completed: boolean; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match goal header: ### G0: Title
    const goalMatch = line.match(/^###\s+(G\d+):\s+(.+)/);
    if (goalMatch) {
      // Save previous goal if exists
      if (currentGoal && currentGoal.id) {
        finalizeGoal(currentGoal, progressTasks, goals);
      }

      // Start new goal
      currentGoal = {
        id: goalMatch[1],
        title: goalMatch[2].trim(),
        status: 'Active',
        targetTimeline: '',
        totalTasks: 0,
        completedTasks: 0,
        progressPercent: 0,
        nextAction: null,
      };
      inProgressSection = false;
      progressTasks = [];
      continue;
    }

    // If we have a current goal, parse its attributes
    if (currentGoal) {
      // Status line: **Status:** Active
      const statusMatch = line.match(/^\*\*Status:\*\*\s*(.+)/);
      if (statusMatch) {
        currentGoal.status = statusMatch[1].trim();
        continue;
      }

      // Target/Deadline line: **Target:** Q2 2026 or **Deadline:** ~February 2026
      const timelineMatch = line.match(/^\*\*(Target|Deadline):\*\*\s*(.+)/);
      if (timelineMatch) {
        currentGoal.targetTimeline = timelineMatch[2].trim();
        continue;
      }

      // Progress section start
      if (line.match(/^\*\*Progress:\*\*/)) {
        inProgressSection = true;
        continue;
      }

      // New section starts - end progress section
      if (line.match(/^\*\*[A-Z]/) && !line.match(/^\*\*Progress:\*\*/)) {
        inProgressSection = false;
      }

      // Check for new goal section header (## ) which also ends current goal
      if (line.match(/^##\s+/) && !line.match(/^###/)) {
        // Save current goal
        if (currentGoal.id) {
          finalizeGoal(currentGoal, progressTasks, goals);
        }
        currentGoal = null;
        inProgressSection = false;
        continue;
      }

      // Parse checkboxes in progress section OR directly after Deadline (for 2026 Goals format)
      const checkboxMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)/);
      if (checkboxMatch) {
        // Only count if we're in progress section OR if the goal has a Deadline (2026 Goals format)
        const isCompleted = checkboxMatch[1].toLowerCase() === 'x';
        const taskText = checkboxMatch[2].trim();

        // For 2026 Goals section, checkboxes come directly after Deadline, no **Progress:** marker
        if (inProgressSection || currentGoal.targetTimeline?.includes('2026')) {
          progressTasks.push({ completed: isCompleted, text: taskText });
        }
      }
    }

    // End of file marker check - tables, horizontal rules
    if (line.match(/^\|/) || line.match(/^---$/)) {
      if (currentGoal && currentGoal.id) {
        finalizeGoal(currentGoal, progressTasks, goals);
        currentGoal = null;
        progressTasks = [];
      }
    }
  }

  // Don't forget the last goal
  if (currentGoal && currentGoal.id) {
    finalizeGoal(currentGoal, progressTasks, goals);
  }

  return goals;
}

/**
 * Finalize a goal by calculating derived fields
 */
function finalizeGoal(
  goal: Partial<TelosGoal>,
  tasks: { completed: boolean; text: string }[],
  goals: TelosGoal[]
): void {
  const completed = tasks.filter(t => t.completed).length;
  const total = tasks.length;
  const percent = calculateProgress(completed, total);

  // Find first uncompleted task as next action
  const nextTask = tasks.find(t => !t.completed);

  const finalGoal: TelosGoal = {
    id: goal.id!,
    title: goal.title!,
    status: goal.status || 'Active',
    targetTimeline: goal.targetTimeline || '',
    urgency: determineUrgency(goal.targetTimeline || ''),
    totalTasks: total,
    completedTasks: completed,
    progressPercent: percent,
    nextAction: nextTask ? nextTask.text : null,
    emoji: selectEmoji(goal.title!),
  };

  goals.push(finalGoal);
}

// =============================================================================
// Prioritization
// =============================================================================

/**
 * Prioritize goals for the daily briefing
 *
 * Algorithm:
 * 1. Imminent urgency first (target contains "week", "days", "soon")
 * 2. High progress (>80%) next (close to completion)
 * 3. Active status over In Progress over Planning
 * 4. Return max 3 goals
 */
export function prioritizeGoals(goals: TelosGoal[]): TelosGoal[] {
  const sorted = [...goals].sort((a, b) => {
    // 1. Urgency: imminent > near > distant
    const urgencyOrder: Record<UrgencyLevel, number> = {
      imminent: 0,
      near: 1,
      distant: 2,
    };
    const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;

    // 2. High progress (>80%) bumps up priority
    const aHighProgress = a.progressPercent >= 80 ? 1 : 0;
    const bHighProgress = b.progressPercent >= 80 ? 1 : 0;
    if (aHighProgress !== bHighProgress) return bHighProgress - aHighProgress;

    // 3. Status: Active > In Progress > Planning
    const statusOrder: Record<string, number> = {
      Active: 0,
      'In Progress': 1,
      Planning: 2,
    };
    const statusDiff = (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3);
    if (statusDiff !== 0) return statusDiff;

    // 4. Goal ID as tiebreaker (lower ID = higher priority)
    const aNum = parseInt(a.id.replace('G', ''), 10);
    const bNum = parseInt(b.id.replace('G', ''), 10);
    return aNum - bNum;
  });

  // Return max 3 goals
  return sorted.slice(0, 3);
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format urgency indicator
 */
function formatUrgencyIndicator(urgency: UrgencyLevel, timeline: string): string {
  switch (urgency) {
    case 'imminent':
      return `\u26A1 ${timeline}`; // Lightning bolt
    case 'near':
      return `\uD83D\uDCC5 ${timeline}`; // Calendar
    case 'distant':
      return `\uD83D\uDCC6 ${timeline}`; // Calendar page
  }
}

/**
 * Format the TELOS section for the daily briefing
 *
 * Note: Does NOT include the main header (e.g., "TOP GOALS (TELOS)")
 * since that's added by the briefing.ts formatter.
 * Only includes the separator line and goal entries.
 */
export function formatTelosSection(goals: TelosGoal[]): string {
  if (goals.length === 0) {
    return `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
  No active goals loaded`;
  }

  const header = `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;

  const goalLines = goals.map(g => {
    const progressBar = generateProgressBar(g.progressPercent);
    const urgencyIndicator = formatUrgencyIndicator(g.urgency, g.targetTimeline);
    const nextActionLine = g.nextAction
      ? `   \u2192 ${truncateAction(g.nextAction, 45)}`
      : '';

    return `${g.emoji} ${g.id}: ${g.title}
   ${progressBar} ${g.progressPercent}% | ${urgencyIndicator}${nextActionLine}`;
  });

  return `${header}\n${goalLines.join('\n\n')}`;
}

/**
 * Truncate action text to fit display
 */
function truncateAction(action: string, maxLen: number): string {
  if (action.length <= maxLen) return action;
  return action.substring(0, maxLen - 3) + '...';
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Main function to get enhanced TELOS goals from content
 */
export function getEnhancedTelosGoals(content: string): string {
  const goals = parseGoalsFile(content);
  const prioritized = prioritizeGoals(goals);
  return formatTelosSection(prioritized);
}

/**
 * Load and format TELOS goals from the standard location
 */
export function loadAndFormatTelosGoals(): string {
  try {
    const goalsPath = `${homedir()}/.claude/skills/CORE/USER/TELOS/GOALS.md`;
    const content = readFileSync(goalsPath, 'utf-8');
    return getEnhancedTelosGoals(content);
  } catch (error) {
    if (process.env.DEBUG) {
      console.error('Error loading TELOS goals:', error);
    }
    return `TELOS GOALS
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
  Unable to load goals`;
  }
}

/**
 * Get parsed goals (for use by other components)
 */
export function getParsedGoals(): TelosGoal[] {
  try {
    const goalsPath = `${homedir()}/.claude/skills/CORE/USER/TELOS/GOALS.md`;
    const content = readFileSync(goalsPath, 'utf-8');
    return prioritizeGoals(parseGoalsFile(content));
  } catch {
    return [];
  }
}

// =============================================================================
// Standalone Execution
// =============================================================================

if (import.meta.main) {
  console.log('TelosParser - Enhanced TELOS Integration\n');
  console.log('Loading GOALS.md and generating enhanced display...\n');

  const result = loadAndFormatTelosGoals();
  console.log(result);

  console.log('\n\n--- Parsed Goal Details ---\n');
  const goals = getParsedGoals();
  for (const g of goals) {
    console.log(`${g.id}: ${g.title}`);
    console.log(`  Status: ${g.status}`);
    console.log(`  Timeline: ${g.targetTimeline} (${g.urgency})`);
    console.log(`  Progress: ${g.completedTasks}/${g.totalTasks} (${g.progressPercent}%)`);
    console.log(`  Next: ${g.nextAction || 'None'}`);
    console.log('');
  }
}
