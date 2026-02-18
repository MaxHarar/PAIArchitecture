/**
 * Wellness Integration Tests
 *
 * TDD tests for Phase 1.1: Multi-Metric Readiness with Wellness Integration
 *
 * Tests verify:
 * - Wellness questionnaire input validation
 * - Wellness score calculation (average of 4 metrics)
 * - Training readiness integration with wellness data
 * - HRV-wellness conflict resolution scenarios
 * - Missing wellness data handling (graceful degradation)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

// Imports from modules under test - these will fail until implemented
import {
  validateWellnessInput,
  calculateWellnessScore,
  saveWellnessData,
  getWellnessData,
  type WellnessData,
} from '../Tools/wellness-check';

import {
  calculateReadinessScore,
  assessTrainingReadiness,
  type DailyMetrics,
  type ReadinessScore,
} from '../Tools/training-readiness';

// Test database paths
const TEST_DB_PATH = join(tmpdir(), `test-wellness-${Date.now()}.db`);

// Test fixtures
const validWellnessData: WellnessData = {
  date: '2026-01-28',
  sleep_quality: 7,       // 1-10 scale (subjective, NOT duration)
  muscle_soreness: 3,     // 1-10 scale (1=none, 10=severe)
  stress_level: 4,        // 1-10 scale (1=low, 10=high)
  mood: 8,                // 1-10 scale (1=poor, 10=excellent)
  notes: 'Feeling good after rest day',
};

const poorWellnessData: WellnessData = {
  date: '2026-01-28',
  sleep_quality: 3,
  muscle_soreness: 8,
  stress_level: 9,
  mood: 2,
};

const excellentWellnessData: WellnessData = {
  date: '2026-01-28',
  sleep_quality: 9,
  muscle_soreness: 1,
  stress_level: 2,
  mood: 9,
};

// Mock daily metrics
const highHrvMetrics: DailyMetrics = {
  date: '2026-01-28',
  sleep_score: 85,
  hrv_rmssd: 95,          // High HRV (>90)
  hrv_status: 'balanced',
  resting_heart_rate: 42,
  body_battery: 85,
  sleep_duration_seconds: 28800,
};

const lowHrvMetrics: DailyMetrics = {
  date: '2026-01-28',
  sleep_score: 85,
  hrv_rmssd: 50,          // Low HRV (~80% of typical baseline)
  hrv_status: 'low',
  resting_heart_rate: 48,
  body_battery: 60,
  sleep_duration_seconds: 25200,
};

describe('Wellness Questionnaire - Input Validation', () => {
  it('should accept valid input within 1-10 range', () => {
    const result = validateWellnessInput('sleep_quality', 7);
    expect(result.valid).toBe(true);
  });

  it('should reject input below 1', () => {
    const result = validateWellnessInput('sleep_quality', 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('1-10');
  });

  it('should reject input above 10', () => {
    const result = validateWellnessInput('muscle_soreness', 11);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('1-10');
  });

  it('should reject non-integer input', () => {
    const result = validateWellnessInput('stress_level', 5.5);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('integer');
  });

  it('should reject NaN input', () => {
    const result = validateWellnessInput('mood', NaN);
    expect(result.valid).toBe(false);
  });

  it('should accept boundary values (1 and 10)', () => {
    expect(validateWellnessInput('sleep_quality', 1).valid).toBe(true);
    expect(validateWellnessInput('sleep_quality', 10).valid).toBe(true);
  });
});

describe('Wellness Score Calculation', () => {
  it('should calculate wellness_score as average of 4 metrics', () => {
    // (7 + 3 + 4 + 8) / 4 = 5.5 -> rounds to 6
    // Note: muscle_soreness and stress_level are inverted (lower is better)
    // So: sleep_quality=7, (10-muscle_soreness)=7, (10-stress_level)=6, mood=8
    // (7 + 7 + 6 + 8) / 4 = 7.0 -> 70 on 0-100 scale
    const score = calculateWellnessScore(validWellnessData);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(80);
  });

  it('should return low score for poor wellness metrics', () => {
    // sleep=3, soreness=8(inverted=2), stress=9(inverted=1), mood=2
    // (3 + 2 + 1 + 2) / 4 = 2.0 -> 20 on 0-100 scale
    const score = calculateWellnessScore(poorWellnessData);
    expect(score).toBeLessThanOrEqual(30);
  });

  it('should return high score for excellent wellness metrics', () => {
    // sleep=9, soreness=1(inverted=9), stress=2(inverted=8), mood=9
    // (9 + 9 + 8 + 9) / 4 = 8.75 -> ~88 on 0-100 scale
    const score = calculateWellnessScore(excellentWellnessData);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('should return score on 0-100 scale', () => {
    const score = calculateWellnessScore(validWellnessData);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('Wellness Database Operations', () => {
  let db: Database;

  beforeAll(() => {
    // Create test database with both tables
    db = new Database(TEST_DB_PATH);

    // Create daily_wellness table
    db.run(`
      CREATE TABLE daily_wellness (
        date TEXT PRIMARY KEY,
        sleep_quality INTEGER NOT NULL,
        muscle_soreness INTEGER NOT NULL,
        stress_level INTEGER NOT NULL,
        mood INTEGER NOT NULL,
        wellness_score INTEGER,
        notes TEXT
      )
    `);

    // Create daily_metrics table for integration tests
    db.run(`
      CREATE TABLE daily_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        sleep_score INTEGER,
        sleep_duration_seconds INTEGER,
        deep_sleep_seconds INTEGER,
        rem_sleep_seconds INTEGER,
        hrv_rmssd REAL,
        hrv_status TEXT,
        resting_heart_rate INTEGER,
        body_battery INTEGER,
        training_readiness INTEGER,
        recovery_score INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.close();
  });

  afterAll(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it('should save wellness data to database', () => {
    const result = saveWellnessData(TEST_DB_PATH, validWellnessData);
    expect(result.success).toBe(true);
    expect(result.wellness_score).toBeGreaterThan(0);
  });

  it('should retrieve wellness data by date', () => {
    const data = getWellnessData(TEST_DB_PATH, '2026-01-28');
    expect(data).not.toBeNull();
    expect(data?.sleep_quality).toBe(7);
    expect(data?.wellness_score).toBeGreaterThan(0);
  });

  it('should return null for non-existent date', () => {
    const data = getWellnessData(TEST_DB_PATH, '2020-01-01');
    expect(data).toBeNull();
  });

  it('should update existing wellness data for same date', () => {
    const updatedData: WellnessData = {
      ...validWellnessData,
      sleep_quality: 9,
      mood: 9,
    };
    const result = saveWellnessData(TEST_DB_PATH, updatedData);
    expect(result.success).toBe(true);

    const retrieved = getWellnessData(TEST_DB_PATH, '2026-01-28');
    expect(retrieved?.sleep_quality).toBe(9);
    expect(retrieved?.mood).toBe(9);
  });
});

describe('Training Readiness Integration with Wellness', () => {
  let db: Database;
  const INTEGRATION_DB_PATH = join(tmpdir(), `test-integration-${Date.now()}.db`);

  beforeAll(() => {
    // Create integrated test database
    db = new Database(INTEGRATION_DB_PATH);

    // Create daily_wellness table
    db.run(`
      CREATE TABLE daily_wellness (
        date TEXT PRIMARY KEY,
        sleep_quality INTEGER NOT NULL,
        muscle_soreness INTEGER NOT NULL,
        stress_level INTEGER NOT NULL,
        mood INTEGER NOT NULL,
        wellness_score INTEGER,
        notes TEXT
      )
    `);

    // Create daily_metrics table
    db.run(`
      CREATE TABLE daily_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        sleep_score INTEGER,
        sleep_duration_seconds INTEGER,
        deep_sleep_seconds INTEGER,
        rem_sleep_seconds INTEGER,
        hrv_rmssd REAL,
        hrv_status TEXT,
        resting_heart_rate INTEGER,
        body_battery INTEGER,
        training_readiness INTEGER,
        recovery_score INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Insert test data
    const today = new Date().toISOString().split('T')[0];

    db.run(`
      INSERT INTO daily_metrics
      (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery, sleep_duration_seconds)
      VALUES (?, 85, 90, 'balanced', 42, 85, 28800)
    `, [today]);

    // Insert wellness data for integration
    db.run(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, 7, 3, 4, 8, 70)
    `, [today]);

    db.close();
  });

  afterAll(() => {
    if (existsSync(INTEGRATION_DB_PATH)) {
      unlinkSync(INTEGRATION_DB_PATH);
    }
  });

  it('should include wellness_score in ReadinessScore interface', () => {
    const assessment = assessTrainingReadiness(INTEGRATION_DB_PATH);
    expect(assessment.readinessScore).toHaveProperty('components');
    expect(assessment.readinessScore.components).toHaveProperty('wellness');
  });

  it('should use new weight distribution with 20% wellness', () => {
    // New weights: Sleep 25%, HRV 25%, Body Battery 20%, RHR 10%, Wellness 20%
    const assessment = assessTrainingReadiness(INTEGRATION_DB_PATH);

    // The overall score should be influenced by wellness
    // With good wellness (70), it should contribute positively
    expect(assessment.readinessScore.overall).toBeGreaterThan(0);
    expect(assessment.readinessScore.components.wellness).toBeGreaterThan(0);
  });

  it('should work when wellness data is missing (graceful degradation)', () => {
    // Create DB without wellness data
    const noWellnessDbPath = join(tmpdir(), `test-no-wellness-${Date.now()}.db`);
    const noWellnessDb = new Database(noWellnessDbPath);

    noWellnessDb.run(`
      CREATE TABLE daily_metrics (
        id INTEGER PRIMARY KEY,
        date TEXT UNIQUE,
        sleep_score INTEGER,
        hrv_rmssd REAL,
        hrv_status TEXT,
        resting_heart_rate INTEGER,
        body_battery INTEGER,
        sleep_duration_seconds INTEGER
      )
    `);

    noWellnessDb.run(`
      CREATE TABLE daily_wellness (
        date TEXT PRIMARY KEY,
        sleep_quality INTEGER NOT NULL,
        muscle_soreness INTEGER NOT NULL,
        stress_level INTEGER NOT NULL,
        mood INTEGER NOT NULL,
        wellness_score INTEGER,
        notes TEXT
      )
    `);

    const today = new Date().toISOString().split('T')[0];
    noWellnessDb.run(`
      INSERT INTO daily_metrics (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery)
      VALUES (?, 85, 90, 'balanced', 42, 85)
    `, [today]);

    noWellnessDb.close();

    const assessment = assessTrainingReadiness(noWellnessDbPath);

    // Should still work with existing metrics only
    expect(assessment.readinessScore.overall).toBeGreaterThan(0);
    expect(assessment.readinessScore.dataQuality).toMatch(/partial|complete/);

    unlinkSync(noWellnessDbPath);
  });
});

describe('HRV-Wellness Conflict Resolution', () => {
  let db: Database;
  const CONFLICT_DB_PATH = join(tmpdir(), `test-conflict-${Date.now()}.db`);

  beforeEach(() => {
    db = new Database(CONFLICT_DB_PATH);

    db.run(`
      CREATE TABLE IF NOT EXISTS daily_wellness (
        date TEXT PRIMARY KEY,
        sleep_quality INTEGER NOT NULL,
        muscle_soreness INTEGER NOT NULL,
        stress_level INTEGER NOT NULL,
        mood INTEGER NOT NULL,
        wellness_score INTEGER,
        notes TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS daily_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        sleep_score INTEGER,
        sleep_duration_seconds INTEGER,
        deep_sleep_seconds INTEGER,
        rem_sleep_seconds INTEGER,
        hrv_rmssd REAL,
        hrv_status TEXT,
        resting_heart_rate INTEGER,
        body_battery INTEGER,
        training_readiness INTEGER,
        recovery_score INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  });

  afterEach(() => {
    // Tests close db themselves before calling assessTrainingReadiness
    // Just clean up the file
    if (existsSync(CONFLICT_DB_PATH)) {
      unlinkSync(CONFLICT_DB_PATH);
    }
  });

  it('should recommend rest when HRV high (95%) but wellness low (30)', () => {
    // Scenario: HRV says "ready" but subjective wellness says "terrible"
    // Trust wellness due to 30% HRV error rate
    const today = new Date().toISOString().split('T')[0];

    db.run(`
      INSERT INTO daily_metrics
      (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery)
      VALUES (?, 85, 95, 'balanced', 42, 85)
    `, [today]);

    // Poor wellness: sleep=3, soreness=8, stress=9, mood=2 -> score ~20-30
    db.run(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, 3, 8, 9, 2, 30)
    `, [today]);

    db.close();

    const assessment = assessTrainingReadiness(CONFLICT_DB_PATH);

    // Should recommend rest despite high HRV
    expect(assessment.readinessScore.recommendation).toBe('rest');
    expect(assessment.readinessScore.reasoning).toContain('wellness');
  });

  it('should recommend light when HRV low (80%) but wellness high (85)', () => {
    // Scenario: HRV says "stressed" but person feels great
    // Trust wellness - HRV may be measurement artifact
    const today = new Date().toISOString().split('T')[0];

    db.run(`
      INSERT INTO daily_metrics
      (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery)
      VALUES (?, 70, 50, 'low', 52, 55)
    `, [today]);

    // Great wellness: sleep=9, soreness=1, stress=2, mood=9 -> score ~85-90
    db.run(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, 9, 1, 2, 9, 85)
    `, [today]);

    db.close();

    const assessment = assessTrainingReadiness(CONFLICT_DB_PATH);

    // Should upgrade from "rest" to "light" due to good wellness
    expect(assessment.readinessScore.recommendation).toBe('light');
    expect(assessment.readinessScore.reasoning).toContain('wellness');
  });

  it('should provide reasoning when conflict detected', () => {
    const today = new Date().toISOString().split('T')[0];

    db.run(`
      INSERT INTO daily_metrics
      (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery)
      VALUES (?, 85, 95, 'balanced', 42, 85)
    `, [today]);

    db.run(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, 3, 8, 9, 2, 30)
    `, [today]);

    db.close();

    const assessment = assessTrainingReadiness(CONFLICT_DB_PATH);

    // Should have reasoning explaining the override
    expect(assessment.readinessScore).toHaveProperty('reasoning');
    expect(assessment.readinessScore.reasoning).toBeTruthy();
    expect(assessment.readinessScore.reasoning?.length).toBeGreaterThan(10);
  });

  it('should NOT override when HRV and wellness are aligned', () => {
    const today = new Date().toISOString().split('T')[0];

    // Both HRV and wellness indicate good recovery
    // Include sleep_duration_seconds to avoid "insufficient_sleep_duration" concern
    db.run(`
      INSERT INTO daily_metrics
      (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery, sleep_duration_seconds)
      VALUES (?, 90, 95, 'balanced', 40, 90, 28800)
    `, [today]);

    db.run(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, 8, 2, 2, 8, 80)
    `, [today]);

    db.close();

    const assessment = assessTrainingReadiness(CONFLICT_DB_PATH);

    // Should recommend ready (no conflict)
    expect(assessment.readinessScore.recommendation).toBe('ready');
    // Reasoning should not mention override
    expect(assessment.readinessScore.reasoning || '').not.toContain('override');
  });

  it('should apply 20-point threshold for conflict detection', () => {
    const today = new Date().toISOString().split('T')[0];

    // 15-point difference (below threshold) - no override expected
    // HRV score ~80, wellness score ~65
    db.run(`
      INSERT INTO daily_metrics
      (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery)
      VALUES (?, 80, 85, 'balanced', 45, 75)
    `, [today]);

    db.run(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, 6, 4, 4, 6, 65)
    `, [today]);

    db.close();

    const assessment = assessTrainingReadiness(CONFLICT_DB_PATH);

    // Should NOT apply override logic for <20 point difference
    expect(assessment.readinessScore.reasoning || '').not.toContain('override');
  });
});

describe('Wellness CLI Tool', () => {
  const CLI_TEST_DB_PATH = join(tmpdir(), `test-cli-${Date.now()}.db`);

  beforeAll(() => {
    // Create test database with wellness table
    const db = new Database(CLI_TEST_DB_PATH);
    db.run(`
      CREATE TABLE daily_wellness (
        date TEXT PRIMARY KEY,
        sleep_quality INTEGER NOT NULL,
        muscle_soreness INTEGER NOT NULL,
        stress_level INTEGER NOT NULL,
        mood INTEGER NOT NULL,
        wellness_score INTEGER,
        notes TEXT
      )
    `);
    db.close();
  });

  afterAll(() => {
    if (existsSync(CLI_TEST_DB_PATH)) {
      unlinkSync(CLI_TEST_DB_PATH);
    }
  });

  it('should output wellness_score on successful submission', async () => {
    // This test verifies CLI functionality
    // Run the wellness-check CLI with test input
    const proc = Bun.spawn([
      'bun', 'run', '/Users/maxharar/.claude/skills/FitnessCoach/Tools/wellness-check.ts',
      '--sleep', '7',
      '--soreness', '3',
      '--stress', '4',
      '--mood', '8',
      '--db', CLI_TEST_DB_PATH,
      '--output', 'json'
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('wellness_score');
    expect(parsed.wellness_score).toBeGreaterThan(0);
    expect(parsed.wellness_score).toBeLessThanOrEqual(100);
  });

  it('should fail with helpful error for invalid input', async () => {
    const proc = Bun.spawn([
      'bun', 'run', '/Users/maxharar/.claude/skills/FitnessCoach/Tools/wellness-check.ts',
      '--sleep', '15',  // Invalid - out of range
      '--soreness', '3',
      '--stress', '4',
      '--mood', '8',
      '--db', CLI_TEST_DB_PATH,
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    await proc.exited;
    expect(proc.exitCode).not.toBe(0);
  });
});
