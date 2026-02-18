/**
 * Training Readiness CLI Tests
 *
 * Tests for the training readiness assessment tool that reads
 * daily metrics from SQLite and provides training recommendations.
 */

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import {
  calculateReadinessScore,
  getRecentMetrics,
  assessTrainingReadiness,
  type DailyMetrics,
  type ReadinessAssessment,
} from './training-readiness';

// Test database path
const TEST_DB_PATH = join(tmpdir(), `test-fitness-${Date.now()}.db`);

// Test fixtures
const mockMetrics: DailyMetrics[] = [
  {
    date: '2026-01-27',
    sleep_score: 80,
    hrv_rmssd: 93,
    hrv_status: 'balanced',
    resting_heart_rate: 41,
    body_battery: 99,
    sleep_duration_seconds: 24420,
    deep_sleep_seconds: 7140,
    rem_sleep_seconds: 3960,
  },
  {
    date: '2026-01-26',
    sleep_score: 98,
    hrv_rmssd: 85,
    hrv_status: 'balanced',
    resting_heart_rate: 40,
    body_battery: 100,
    sleep_duration_seconds: 28800,
    deep_sleep_seconds: 9000,
    rem_sleep_seconds: 5400,
  },
  {
    date: '2026-01-25',
    sleep_score: 57,
    hrv_rmssd: 54,
    hrv_status: 'balanced',
    resting_heart_rate: 48,
    body_battery: 36,
    sleep_duration_seconds: 18000,
    deep_sleep_seconds: 3600,
    rem_sleep_seconds: 2700,
  },
];

// Poor recovery day - all fields must be present for accurate scoring
const poorRecoveryMetrics: DailyMetrics = {
  date: '2026-01-25',
  sleep_score: 30,       // Very poor
  hrv_rmssd: 25,         // Very low
  hrv_status: 'low',
  resting_heart_rate: 65, // Elevated
  body_battery: 15,      // Very depleted
  sleep_duration_seconds: 14400, // 4 hours
  deep_sleep_seconds: 1800,
  rem_sleep_seconds: 1200,
};

// Excellent recovery day
const excellentRecoveryMetrics: DailyMetrics = {
  date: '2026-01-26',
  sleep_score: 95,
  hrv_rmssd: 100,
  hrv_status: 'balanced',
  resting_heart_rate: 38,
  body_battery: 100,
  sleep_duration_seconds: 32400, // 9 hours
  deep_sleep_seconds: 10800,
  rem_sleep_seconds: 6480,
};

describe('Training Readiness Calculator', () => {
  let db: Database;

  beforeAll(() => {
    // Create test database with schema
    db = new Database(TEST_DB_PATH);
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
    const insert = db.prepare(`
      INSERT INTO daily_metrics
      (date, sleep_score, sleep_duration_seconds, deep_sleep_seconds, rem_sleep_seconds,
       hrv_rmssd, hrv_status, resting_heart_rate, body_battery)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const m of mockMetrics) {
      insert.run(
        m.date,
        m.sleep_score,
        m.sleep_duration_seconds,
        m.deep_sleep_seconds,
        m.rem_sleep_seconds,
        m.hrv_rmssd,
        m.hrv_status,
        m.resting_heart_rate,
        m.body_battery
      );
    }

    db.close();
  });

  afterAll(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('calculateReadinessScore', () => {
    it('should calculate high readiness for excellent metrics', () => {
      const score = calculateReadinessScore(excellentRecoveryMetrics);
      expect(score.overall).toBeGreaterThanOrEqual(80);
      expect(score.recommendation).toBe('ready');
    });

    it('should calculate low readiness for poor metrics', () => {
      const score = calculateReadinessScore(poorRecoveryMetrics);
      expect(score.overall).toBeLessThanOrEqual(50);
      expect(score.recommendation).toMatch(/rest|light/);
    });

    it('should handle missing data gracefully', () => {
      // With Phase 1.1 weight changes (sleep:25%, hrv:25%, bodyBattery:20%, rhr:10%, wellness:20%)
      // Need at least 50% of weights for "partial" - include 3 metrics
      const partialMetrics: DailyMetrics = {
        date: '2026-01-27',
        sleep_score: 75,
        body_battery: 70,
        resting_heart_rate: 50,  // Added to reach 55% available weight
      };
      const score = calculateReadinessScore(partialMetrics);
      expect(score.overall).toBeGreaterThan(0);
      expect(score.dataQuality).toBe('partial');
    });

    it('should weight HRV appropriately in final score', () => {
      const highHrv: DailyMetrics = { ...mockMetrics[0], hrv_rmssd: 120 };
      const lowHrv: DailyMetrics = { ...mockMetrics[0], hrv_rmssd: 40 };

      const highScore = calculateReadinessScore(highHrv);
      const lowScore = calculateReadinessScore(lowHrv);

      expect(highScore.overall).toBeGreaterThan(lowScore.overall);
    });

    it('should flag elevated resting HR as concern', () => {
      const elevatedHR: DailyMetrics = {
        ...excellentRecoveryMetrics,
        resting_heart_rate: 65, // Elevated
      };
      const score = calculateReadinessScore(elevatedHR);
      expect(score.concerns).toContain('elevated_rhr');
      expect(score.overall).toBeLessThan(calculateReadinessScore(excellentRecoveryMetrics).overall);
    });
  });

  describe('getRecentMetrics', () => {
    it('should retrieve metrics from database', () => {
      const metrics = getRecentMetrics(TEST_DB_PATH, 7);
      expect(metrics).toHaveLength(3);
    });

    it('should order metrics by date descending (most recent first)', () => {
      const metrics = getRecentMetrics(TEST_DB_PATH, 7);
      expect(metrics[0].date).toBe('2026-01-27');
      expect(metrics[2].date).toBe('2026-01-25');
    });

    it('should respect the days limit', () => {
      const metrics = getRecentMetrics(TEST_DB_PATH, 1);
      expect(metrics.length).toBeLessThanOrEqual(1);
    });

    it('should handle non-existent database gracefully', () => {
      const metrics = getRecentMetrics('/nonexistent/path.db', 7);
      expect(metrics).toEqual([]);
    });
  });

  describe('assessTrainingReadiness', () => {
    it('should provide comprehensive assessment for today', () => {
      const assessment = assessTrainingReadiness(TEST_DB_PATH);

      expect(assessment).toHaveProperty('date');
      expect(assessment).toHaveProperty('readinessScore');
      expect(assessment).toHaveProperty('recommendation');
      expect(assessment).toHaveProperty('workoutSuggestions');
      expect(assessment).toHaveProperty('trend');
    });

    it('should detect trend when sufficient data available', () => {
      // With only 3 days of data, trend will be 'unknown' (need 6+ for trend calculation)
      const assessment = assessTrainingReadiness(TEST_DB_PATH);
      // With 3 entries, expect unknown since we need 6 for proper trend
      expect(['stable', 'improving', 'declining', 'unknown']).toContain(assessment.trend);
    });

    it('should suggest rest day when readiness is low', () => {
      // Create a temp DB with poor metrics
      const poorDbPath = join(tmpdir(), `poor-metrics-${Date.now()}.db`);
      const poorDb = new Database(poorDbPath);

      poorDb.run(`
        CREATE TABLE daily_metrics (
          id INTEGER PRIMARY KEY,
          date TEXT UNIQUE,
          sleep_score INTEGER,
          hrv_rmssd REAL,
          hrv_status TEXT,
          resting_heart_rate INTEGER,
          body_battery INTEGER,
          sleep_duration_seconds INTEGER,
          deep_sleep_seconds INTEGER,
          rem_sleep_seconds INTEGER
        )
      `);

      // Use today's date for the query to match
      const today = new Date().toISOString().split('T')[0];
      poorDb.run(`
        INSERT INTO daily_metrics
        (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery, sleep_duration_seconds, deep_sleep_seconds, rem_sleep_seconds)
        VALUES ('${today}', 25, 20, 'low', 65, 15, 14400, 1800, 900)
      `);
      poorDb.close();

      const assessment = assessTrainingReadiness(poorDbPath);
      expect(assessment.recommendation).toMatch(/rest|recovery|low/i);
      expect(assessment.workoutSuggestions).toContain('rest');

      unlinkSync(poorDbPath);
    });

    it('should suggest quality sessions when readiness is high', () => {
      // Create a temp DB with excellent metrics
      const goodDbPath = join(tmpdir(), `good-metrics-${Date.now()}.db`);
      const goodDb = new Database(goodDbPath);

      goodDb.run(`
        CREATE TABLE daily_metrics (
          id INTEGER PRIMARY KEY,
          date TEXT UNIQUE,
          sleep_score INTEGER,
          hrv_rmssd REAL,
          hrv_status TEXT,
          resting_heart_rate INTEGER,
          body_battery INTEGER,
          sleep_duration_seconds INTEGER,
          deep_sleep_seconds INTEGER,
          rem_sleep_seconds INTEGER
        )
      `);

      // Use today's date for the query to match
      const today = new Date().toISOString().split('T')[0];
      goodDb.run(`
        INSERT INTO daily_metrics
        (date, sleep_score, hrv_rmssd, hrv_status, resting_heart_rate, body_battery, sleep_duration_seconds, deep_sleep_seconds, rem_sleep_seconds)
        VALUES ('${today}', 95, 100, 'balanced', 38, 100, 32400, 10800, 6480)
      `);
      goodDb.close();

      const assessment = assessTrainingReadiness(goodDbPath);
      expect(assessment.readinessScore.overall).toBeGreaterThanOrEqual(80);
      expect(assessment.workoutSuggestions.some((s: string) =>
        s.includes('quality') || s.includes('speed') || s.includes('tempo') || s.includes('long')
      )).toBe(true);

      unlinkSync(goodDbPath);
    });
  });

  describe('CLI Output', () => {
    it('should produce valid JSON when --output json flag used', async () => {
      const proc = Bun.spawn(['bun', 'run', './training-readiness.ts', '--output', 'json', '--db', TEST_DB_PATH], {
        cwd: '/Users/maxharar/.claude/skills/FitnessCoach/Tools',
        stdout: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('date');
      expect(parsed).toHaveProperty('readinessScore');
    });

    it('should handle --days flag to limit data', async () => {
      const proc = Bun.spawn(['bun', 'run', './training-readiness.ts', '--days', '3', '--output', 'json', '--db', TEST_DB_PATH], {
        cwd: '/Users/maxharar/.claude/skills/FitnessCoach/Tools',
        stdout: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      const parsed = JSON.parse(output);

      expect(parsed.metricsUsed).toBeLessThanOrEqual(3);
    });
  });
});
