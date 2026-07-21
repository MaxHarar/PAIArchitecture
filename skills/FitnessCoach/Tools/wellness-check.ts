#!/usr/bin/env bun
/**
 * Wellness Check CLI Tool
 *
 * Phase 1.1: Multi-Metric Readiness with Wellness Integration
 *
 * Prompts user for 4 subjective wellness metrics:
 * - Sleep quality (1-10, subjective NOT duration)
 * - Muscle soreness (1-10, 1=none, 10=severe)
 * - Stress level (1-10, 1=low, 10=high)
 * - Mood (1-10, 1=poor, 10=excellent)
 *
 * Calculates composite wellness_score and stores in database.
 *
 * Usage:
 *   bun wellness-check.ts                              # Interactive mode
 *   bun wellness-check.ts --sleep 7 --soreness 3 ...   # Direct input
 *   bun wellness-check.ts --output json                # JSON output
 *   bun wellness-check.ts --date 2026-01-28            # Specific date
 */

import { Database } from 'bun:sqlite';
import { parseArgs } from 'util';
import { existsSync } from 'fs';
import * as readline from 'readline';

// Types
export interface WellnessData {
  date: string;
  sleep_quality: number;      // 1-10 scale (subjective, NOT duration)
  muscle_soreness: number;    // 1-10 scale (1=none, 10=severe)
  stress_level: number;       // 1-10 scale (1=low, 10=high)
  mood: number;               // 1-10 scale (1=poor, 10=excellent)
  wellness_score?: number;    // Composite: calculated from 4 metrics
  notes?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface SaveResult {
  success: boolean;
  wellness_score: number;
  error?: string;
}

// Configuration
const DEFAULT_DB_PATH = `${process.env.HOME}/.claude/fitness/workouts.db`;

/**
 * Validate wellness input for a given metric
 */
export function validateWellnessInput(metric: string, value: number): ValidationResult {
  // Check for NaN
  if (isNaN(value)) {
    return {
      valid: false,
      error: `${metric} must be a valid number`,
    };
  }

  // Check for integer
  if (!Number.isInteger(value)) {
    return {
      valid: false,
      error: `${metric} must be an integer (whole number)`,
    };
  }

  // Check range 1-10
  if (value < 1 || value > 10) {
    return {
      valid: false,
      error: `${metric} must be between 1-10 (got ${value})`,
    };
  }

  return { valid: true };
}

/**
 * Calculate wellness score from raw metrics (0-100 scale)
 *
 * Note: muscle_soreness and stress_level are INVERTED because
 * lower values are better (1=none/low is good, 10=severe/high is bad)
 */
export function calculateWellnessScore(data: WellnessData): number {
  // Invert soreness and stress (10 becomes 1, 1 becomes 10 -> then scale)
  const invertedSoreness = 11 - data.muscle_soreness;  // 1->10, 10->1
  const invertedStress = 11 - data.stress_level;       // 1->10, 10->1

  // Calculate average of 4 metrics (all now on 1-10 scale where higher is better)
  const average = (
    data.sleep_quality +
    invertedSoreness +
    invertedStress +
    data.mood
  ) / 4;

  // Scale to 0-100 (1->0, 10->100)
  // Formula: ((average - 1) / 9) * 100
  const score = Math.round(((average - 1) / 9) * 100);

  return Math.max(0, Math.min(100, score));  // Clamp to 0-100
}

/**
 * Save wellness data to database
 */
export function saveWellnessData(dbPath: string, data: WellnessData): SaveResult {
  if (!existsSync(dbPath)) {
    return {
      success: false,
      wellness_score: 0,
      error: `Database not found at ${dbPath}`,
    };
  }

  try {
    const db = new Database(dbPath);

    // Calculate wellness score
    const wellness_score = calculateWellnessScore(data);

    // Use INSERT OR REPLACE to handle updates for same date
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.date,
      data.sleep_quality,
      data.muscle_soreness,
      data.stress_level,
      data.mood,
      wellness_score,
      data.notes || null
    );

    db.close();

    return {
      success: true,
      wellness_score,
    };
  } catch (error) {
    return {
      success: false,
      wellness_score: 0,
      error: `Database error: ${error}`,
    };
  }
}

/**
 * Get wellness data from database by date
 */
export function getWellnessData(dbPath: string, date: string): WellnessData | null {
  if (!existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Check if table exists
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='daily_wellness'
    `).get();

    if (!tableCheck) {
      db.close();
      return null;
    }

    const stmt = db.prepare(`
      SELECT date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score, notes
      FROM daily_wellness
      WHERE date = ?
    `);

    const result = stmt.get(date) as WellnessData | undefined;
    db.close();

    return result || null;
  } catch (error) {
    console.error('Error reading wellness data:', error);
    return null;
  }
}

/**
 * Check if wellness data exists for today
 */
export function hasWellnessDataForToday(dbPath: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  const data = getWellnessData(dbPath, today);
  return data !== null;
}

/**
 * Interactive prompt for wellness check
 */
async function interactivePrompt(): Promise<WellnessData | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log('\n--- Morning Wellness Check ---\n');
  console.log('Rate each item from 1-10:\n');

  try {
    // Sleep quality
    const sleepStr = await question('Sleep quality (1=poor, 10=excellent): ');
    const sleep_quality = parseInt(sleepStr, 10);
    const sleepValid = validateWellnessInput('sleep_quality', sleep_quality);
    if (!sleepValid.valid) {
      console.error(`Error: ${sleepValid.error}`);
      rl.close();
      return null;
    }

    // Muscle soreness
    const sorenessStr = await question('Muscle soreness (1=none, 10=severe): ');
    const muscle_soreness = parseInt(sorenessStr, 10);
    const sorenessValid = validateWellnessInput('muscle_soreness', muscle_soreness);
    if (!sorenessValid.valid) {
      console.error(`Error: ${sorenessValid.error}`);
      rl.close();
      return null;
    }

    // Stress level
    const stressStr = await question('Stress level (1=low, 10=high): ');
    const stress_level = parseInt(stressStr, 10);
    const stressValid = validateWellnessInput('stress_level', stress_level);
    if (!stressValid.valid) {
      console.error(`Error: ${stressValid.error}`);
      rl.close();
      return null;
    }

    // Mood
    const moodStr = await question('Mood (1=poor, 10=excellent): ');
    const mood = parseInt(moodStr, 10);
    const moodValid = validateWellnessInput('mood', mood);
    if (!moodValid.valid) {
      console.error(`Error: ${moodValid.error}`);
      rl.close();
      return null;
    }

    // Optional notes
    const notes = await question('Notes (optional, press Enter to skip): ');

    rl.close();

    const today = new Date().toISOString().split('T')[0];

    return {
      date: today,
      sleep_quality,
      muscle_soreness,
      stress_level,
      mood,
      notes: notes || undefined,
    };
  } catch (error) {
    rl.close();
    console.error('Error during prompt:', error);
    return null;
  }
}

/**
 * Format output for terminal
 */
function formatTextOutput(data: WellnessData, wellness_score: number): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('='.repeat(50));
  lines.push('  WELLNESS CHECK RECORDED');
  lines.push('='.repeat(50));
  lines.push(`  Date: ${data.date}`);
  lines.push('-'.repeat(50));
  lines.push('');
  lines.push(`  WELLNESS SCORE: ${wellness_score}/100`);
  lines.push('');
  lines.push('  YOUR RESPONSES:');
  lines.push(`    Sleep quality:    ${data.sleep_quality}/10`);
  lines.push(`    Muscle soreness:  ${data.muscle_soreness}/10`);
  lines.push(`    Stress level:     ${data.stress_level}/10`);
  lines.push(`    Mood:             ${data.mood}/10`);

  if (data.notes) {
    lines.push('');
    lines.push(`  Notes: ${data.notes}`);
  }

  lines.push('');

  // Interpretation
  if (wellness_score >= 80) {
    lines.push('  Status: EXCELLENT - Great day for training!');
  } else if (wellness_score >= 60) {
    lines.push('  Status: GOOD - Normal training appropriate');
  } else if (wellness_score >= 40) {
    lines.push('  Status: MODERATE - Consider lighter training');
  } else {
    lines.push('  Status: LOW - Rest or very easy activity recommended');
  }

  lines.push('');
  lines.push('='.repeat(50));

  return lines.join('\n');
}

/**
 * Generate Telegram prompt format
 */
export function getTelegramPrompt(): string {
  return `Morning Check-In:

Rate 1-10:
- Sleep quality:
- Muscle soreness:
- Stress level:
- Mood:`;
}

// CLI entrypoint
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      sleep: { type: 'string', short: 's' },
      soreness: { type: 'string', short: 'r' },
      stress: { type: 'string', short: 't' },
      mood: { type: 'string', short: 'm' },
      notes: { type: 'string', short: 'n' },
      date: { type: 'string', short: 'd' },
      db: { type: 'string', default: DEFAULT_DB_PATH },
      output: { type: 'string', short: 'o', default: 'text' },
      prompt: { type: 'boolean', short: 'p' },  // Output Telegram prompt
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(`
Wellness Check CLI

Usage:
  bun wellness-check.ts [options]

Options:
  -s, --sleep <n>       Sleep quality (1-10, 1=poor, 10=excellent)
  -r, --soreness <n>    Muscle soreness (1-10, 1=none, 10=severe)
  -t, --stress <n>      Stress level (1-10, 1=low, 10=high)
  -m, --mood <n>        Mood (1-10, 1=poor, 10=excellent)
  -n, --notes <text>    Optional notes
  -d, --date <date>     Date (YYYY-MM-DD, default: today)
  --db <path>           Path to SQLite database
  -o, --output <fmt>    Output format: text, json (default: text)
  -p, --prompt          Output Telegram prompt format
  -h, --help            Show this help

Examples:
  bun wellness-check.ts                                    # Interactive mode
  bun wellness-check.ts -s 7 -r 3 -t 4 -m 8               # Direct input
  bun wellness-check.ts --output json                      # JSON output
  bun wellness-check.ts --prompt                           # Show Telegram prompt
`);
    process.exit(0);
  }

  // Output Telegram prompt format
  if (values.prompt) {
    console.log(getTelegramPrompt());
    process.exit(0);
  }

  const dbPath = values.db as string || DEFAULT_DB_PATH;

  // Check if all required values provided (non-interactive mode)
  if (values.sleep && values.soreness && values.stress && values.mood) {
    const date = (values.date as string) || new Date().toISOString().split('T')[0];
    const sleep_quality = parseInt(values.sleep as string, 10);
    const muscle_soreness = parseInt(values.soreness as string, 10);
    const stress_level = parseInt(values.stress as string, 10);
    const mood = parseInt(values.mood as string, 10);

    // Validate all inputs
    const validations = [
      { name: 'sleep_quality', value: sleep_quality, result: validateWellnessInput('sleep_quality', sleep_quality) },
      { name: 'muscle_soreness', value: muscle_soreness, result: validateWellnessInput('muscle_soreness', muscle_soreness) },
      { name: 'stress_level', value: stress_level, result: validateWellnessInput('stress_level', stress_level) },
      { name: 'mood', value: mood, result: validateWellnessInput('mood', mood) },
    ];

    const invalid = validations.find(v => !v.result.valid);
    if (invalid) {
      console.error(`Error: ${invalid.result.error}`);
      process.exit(1);
    }

    const data: WellnessData = {
      date,
      sleep_quality,
      muscle_soreness,
      stress_level,
      mood,
      notes: values.notes as string | undefined,
    };

    const result = saveWellnessData(dbPath, data);

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    if (values.output === 'json') {
      console.log(JSON.stringify({
        date,
        sleep_quality,
        muscle_soreness,
        stress_level,
        mood,
        wellness_score: result.wellness_score,
        notes: data.notes,
      }, null, 2));
    } else {
      console.log(formatTextOutput(data, result.wellness_score));
    }
  } else {
    // Interactive mode
    const data = await interactivePrompt();

    if (!data) {
      process.exit(1);
    }

    const result = saveWellnessData(dbPath, data);

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    if (values.output === 'json') {
      console.log(JSON.stringify({
        ...data,
        wellness_score: result.wellness_score,
      }, null, 2));
    } else {
      console.log(formatTextOutput(data, result.wellness_score));
    }
  }
}
