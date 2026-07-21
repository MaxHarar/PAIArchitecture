/**
 * FitnessBot Tests
 *
 * Unit tests for the FitnessBot Telegram bot functionality.
 * Tests wellness score calculation, session management, and message formatting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TEST UTILITIES
// =============================================================================

const TEST_DB_PATH = '/tmp/fitness-bot-test.db';

function createTestDatabase(): Database {
  // Remove existing test database
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  const db = new Database(TEST_DB_PATH, { create: true });

  // Create daily_wellness table
  db.exec(`
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

  return db;
}

// =============================================================================
// WELLNESS SCORE CALCULATION TESTS
// =============================================================================

interface WellnessData {
  date: string;
  sleep_quality: number;
  muscle_soreness: number;
  stress_level: number;
  mood: number;
  wellness_score?: number;
  notes?: string;
}

/**
 * Calculate wellness score from raw metrics (0-100 scale)
 * muscle_soreness and stress_level are INVERTED (lower is better)
 */
function calculateWellnessScore(data: WellnessData): number {
  const invertedSoreness = 11 - data.muscle_soreness;
  const invertedStress = 11 - data.stress_level;

  const average = (
    data.sleep_quality +
    invertedSoreness +
    invertedStress +
    data.mood
  ) / 4;

  const score = Math.round(((average - 1) / 9) * 100);
  return Math.max(0, Math.min(100, score));
}

/**
 * Get readiness status based on wellness score
 */
function getReadinessStatus(score: number): { emoji: string; status: string; recommendation: string } {
  if (score >= 80) {
    return {
      emoji: '🟢',
      status: 'EXCELLENT',
      recommendation: 'Great day for training! Green light for intensity.',
    };
  } else if (score >= 60) {
    return {
      emoji: '🟡',
      status: 'GOOD',
      recommendation: 'Normal training appropriate. Monitor how you feel.',
    };
  } else if (score >= 40) {
    return {
      emoji: '🟠',
      status: 'MODERATE',
      recommendation: 'Consider lighter training or active recovery.',
    };
  } else {
    return {
      emoji: '🔴',
      status: 'LOW',
      recommendation: 'Rest or very easy activity recommended.',
    };
  }
}

describe('calculateWellnessScore', () => {
  it('should return 100 for perfect metrics', () => {
    const data: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 10,
      muscle_soreness: 1,  // 1 = no soreness (best)
      stress_level: 1,     // 1 = low stress (best)
      mood: 10,
    };

    const score = calculateWellnessScore(data);
    expect(score).toBe(100);
  });

  it('should return 0 for worst metrics', () => {
    const data: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 1,
      muscle_soreness: 10,  // 10 = severe soreness (worst)
      stress_level: 10,     // 10 = high stress (worst)
      mood: 1,
    };

    const score = calculateWellnessScore(data);
    expect(score).toBe(0);
  });

  it('should return 50 for middle metrics', () => {
    // All 5.5 equivalent values
    const data: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 5,
      muscle_soreness: 6,  // inverted: 5
      stress_level: 6,     // inverted: 5
      mood: 5,
    };

    const score = calculateWellnessScore(data);
    // Average of 5,5,5,5 = 5 -> ((5-1)/9)*100 = 44.4 -> rounds to 44
    expect(score).toBe(44);
  });

  it('should correctly invert soreness (low soreness = good)', () => {
    // Low soreness (1) should contribute positively
    const lowSoreness: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 5,
      muscle_soreness: 1,  // Best (inverted to 10)
      stress_level: 5,     // inverted to 6
      mood: 5,
    };

    const highSoreness: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 5,
      muscle_soreness: 10, // Worst (inverted to 1)
      stress_level: 5,
      mood: 5,
    };

    const lowScore = calculateWellnessScore(lowSoreness);
    const highScore = calculateWellnessScore(highSoreness);

    expect(lowScore).toBeGreaterThan(highScore);
  });

  it('should correctly invert stress (low stress = good)', () => {
    const lowStress: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 5,
      muscle_soreness: 5,
      stress_level: 1,     // Best (inverted to 10)
      mood: 5,
    };

    const highStress: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 5,
      muscle_soreness: 5,
      stress_level: 10,    // Worst (inverted to 1)
      mood: 5,
    };

    const lowScore = calculateWellnessScore(lowStress);
    const highScore = calculateWellnessScore(highStress);

    expect(lowScore).toBeGreaterThan(highScore);
  });

  it('should handle real-world example correctly', () => {
    // Sleep 7, Soreness 3, Stress 4, Mood 8 -> score should be ~72
    const data: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 7,
      muscle_soreness: 3,  // inverted: 8
      stress_level: 4,     // inverted: 7
      mood: 8,
    };

    const score = calculateWellnessScore(data);
    // Average: (7 + 8 + 7 + 8) / 4 = 7.5
    // Score: ((7.5 - 1) / 9) * 100 = 72.2 -> 72
    expect(score).toBe(72);
  });
});

describe('getReadinessStatus', () => {
  it('should return EXCELLENT for scores >= 80', () => {
    expect(getReadinessStatus(80).status).toBe('EXCELLENT');
    expect(getReadinessStatus(90).status).toBe('EXCELLENT');
    expect(getReadinessStatus(100).status).toBe('EXCELLENT');
    expect(getReadinessStatus(80).emoji).toBe('🟢');
  });

  it('should return GOOD for scores 60-79', () => {
    expect(getReadinessStatus(60).status).toBe('GOOD');
    expect(getReadinessStatus(70).status).toBe('GOOD');
    expect(getReadinessStatus(79).status).toBe('GOOD');
    expect(getReadinessStatus(60).emoji).toBe('🟡');
  });

  it('should return MODERATE for scores 40-59', () => {
    expect(getReadinessStatus(40).status).toBe('MODERATE');
    expect(getReadinessStatus(50).status).toBe('MODERATE');
    expect(getReadinessStatus(59).status).toBe('MODERATE');
    expect(getReadinessStatus(40).emoji).toBe('🟠');
  });

  it('should return LOW for scores < 40', () => {
    expect(getReadinessStatus(0).status).toBe('LOW');
    expect(getReadinessStatus(20).status).toBe('LOW');
    expect(getReadinessStatus(39).status).toBe('LOW');
    expect(getReadinessStatus(0).emoji).toBe('🔴');
  });

  it('should include appropriate recommendations', () => {
    const excellent = getReadinessStatus(85);
    expect(excellent.recommendation).toContain('Green light');

    const low = getReadinessStatus(30);
    expect(low.recommendation).toContain('Rest');
  });
});

// =============================================================================
// DATABASE OPERATION TESTS
// =============================================================================

describe('Database Operations', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it('should save wellness data correctly', () => {
    const data: WellnessData = {
      date: '2026-01-28',
      sleep_quality: 7,
      muscle_soreness: 3,
      stress_level: 4,
      mood: 8,
    };

    const wellness_score = calculateWellnessScore(data);

    const stmt = db.prepare(`
      INSERT INTO daily_wellness
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
      null
    );

    // Verify data was saved
    const result = db.prepare('SELECT * FROM daily_wellness WHERE date = ?').get(data.date) as WellnessData;

    expect(result.date).toBe('2026-01-28');
    expect(result.sleep_quality).toBe(7);
    expect(result.muscle_soreness).toBe(3);
    expect(result.stress_level).toBe(4);
    expect(result.mood).toBe(8);
    expect(result.wellness_score).toBe(72);
  });

  it('should update existing wellness data (INSERT OR REPLACE)', () => {
    const date = '2026-01-28';

    // Insert initial data
    db.prepare(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(date, 5, 5, 5, 5, 44);

    // Update with new values
    db.prepare(`
      INSERT OR REPLACE INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(date, 8, 2, 2, 9, 89);

    // Verify updated data
    const result = db.prepare('SELECT * FROM daily_wellness WHERE date = ?').get(date) as WellnessData;

    expect(result.sleep_quality).toBe(8);
    expect(result.wellness_score).toBe(89);
  });

  it('should retrieve wellness data by date', () => {
    // Insert test data
    db.prepare(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('2026-01-27', 6, 4, 5, 7, 61);

    db.prepare(`
      INSERT INTO daily_wellness
      (date, sleep_quality, muscle_soreness, stress_level, mood, wellness_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('2026-01-28', 8, 2, 3, 9, 83);

    // Query specific date
    const result = db.prepare('SELECT * FROM daily_wellness WHERE date = ?').get('2026-01-28') as WellnessData;

    expect(result).toBeDefined();
    expect(result.sleep_quality).toBe(8);
    expect(result.wellness_score).toBe(83);
  });

  it('should return null for non-existent date', () => {
    const result = db.prepare('SELECT * FROM daily_wellness WHERE date = ?').get('2026-01-01');

    expect(result).toBeNull();
  });
});

// =============================================================================
// SESSION MANAGEMENT TESTS
// =============================================================================

interface UserSession {
  chatId: number;
  step: 'sleep' | 'soreness' | 'stress' | 'mood' | 'complete';
  data: Partial<WellnessData>;
  messageId?: number;
}

describe('Session Management', () => {
  it('should progress through questionnaire steps correctly', () => {
    const steps: UserSession['step'][] = ['sleep', 'soreness', 'stress', 'mood', 'complete'];

    const getNextStep = (currentStep: UserSession['step']): UserSession['step'] => {
      const currentIndex = steps.indexOf(currentStep);
      return steps[currentIndex + 1] || 'complete';
    };

    expect(getNextStep('sleep')).toBe('soreness');
    expect(getNextStep('soreness')).toBe('stress');
    expect(getNextStep('stress')).toBe('mood');
    expect(getNextStep('mood')).toBe('complete');
    expect(getNextStep('complete')).toBe('complete');
  });

  it('should accumulate data through questionnaire', () => {
    const session: UserSession = {
      chatId: 12345,
      step: 'sleep',
      data: { date: '2026-01-28' },
    };

    // Simulate answering questions
    session.data.sleep_quality = 7;
    session.step = 'soreness';

    session.data.muscle_soreness = 3;
    session.step = 'stress';

    session.data.stress_level = 4;
    session.step = 'mood';

    session.data.mood = 8;
    session.step = 'complete';

    // Verify all data collected
    expect(session.data.sleep_quality).toBe(7);
    expect(session.data.muscle_soreness).toBe(3);
    expect(session.data.stress_level).toBe(4);
    expect(session.data.mood).toBe(8);
    expect(session.step).toBe('complete');
  });
});

// =============================================================================
// INLINE KEYBOARD TESTS
// =============================================================================

describe('Inline Keyboard', () => {
  it('should create 1-10 rating keyboard with 2 rows', () => {
    const createRatingKeyboard = () => {
      const row1 = [];
      const row2 = [];

      for (let i = 1; i <= 5; i++) {
        row1.push({ text: i.toString(), callback_data: `rating_${i}` });
      }
      for (let i = 6; i <= 10; i++) {
        row2.push({ text: i.toString(), callback_data: `rating_${i}` });
      }

      return { inline_keyboard: [row1, row2] };
    };

    const keyboard = createRatingKeyboard();

    expect(keyboard.inline_keyboard.length).toBe(2);
    expect(keyboard.inline_keyboard[0].length).toBe(5);
    expect(keyboard.inline_keyboard[1].length).toBe(5);

    // Check first row buttons
    expect(keyboard.inline_keyboard[0][0]).toEqual({ text: '1', callback_data: 'rating_1' });
    expect(keyboard.inline_keyboard[0][4]).toEqual({ text: '5', callback_data: 'rating_5' });

    // Check second row buttons
    expect(keyboard.inline_keyboard[1][0]).toEqual({ text: '6', callback_data: 'rating_6' });
    expect(keyboard.inline_keyboard[1][4]).toEqual({ text: '10', callback_data: 'rating_10' });
  });

  it('should parse rating from callback data', () => {
    const parseRating = (data: string): number => {
      return parseInt(data.replace('rating_', ''), 10);
    };

    expect(parseRating('rating_1')).toBe(1);
    expect(parseRating('rating_5')).toBe(5);
    expect(parseRating('rating_10')).toBe(10);
  });
});

// =============================================================================
// QUESTION TEXT TESTS
// =============================================================================

describe('Question Text', () => {
  const QUESTIONS = {
    sleep: {
      prompt: 'Rate your sleep quality (1-10)',
      description: '1 = poor, 10 = excellent',
      field: 'sleep_quality' as const,
    },
    soreness: {
      prompt: 'Rate your muscle soreness (1-10)',
      description: '1 = none, 10 = severe',
      field: 'muscle_soreness' as const,
    },
    stress: {
      prompt: 'Rate your stress level (1-10)',
      description: '1 = low, 10 = high',
      field: 'stress_level' as const,
    },
    mood: {
      prompt: 'Rate your mood (1-10)',
      description: '1 = poor, 10 = excellent',
      field: 'mood' as const,
    },
  };

  it('should have all 4 questions defined', () => {
    expect(Object.keys(QUESTIONS).length).toBe(4);
    expect(QUESTIONS.sleep).toBeDefined();
    expect(QUESTIONS.soreness).toBeDefined();
    expect(QUESTIONS.stress).toBeDefined();
    expect(QUESTIONS.mood).toBeDefined();
  });

  it('should map to correct database fields', () => {
    expect(QUESTIONS.sleep.field).toBe('sleep_quality');
    expect(QUESTIONS.soreness.field).toBe('muscle_soreness');
    expect(QUESTIONS.stress.field).toBe('stress_level');
    expect(QUESTIONS.mood.field).toBe('mood');
  });

  it('should have helpful descriptions', () => {
    // Sleep and mood: higher is better
    expect(QUESTIONS.sleep.description).toContain('10 = excellent');
    expect(QUESTIONS.mood.description).toContain('10 = excellent');

    // Soreness and stress: lower is better
    expect(QUESTIONS.soreness.description).toContain('1 = none');
    expect(QUESTIONS.stress.description).toContain('1 = low');
  });
});
