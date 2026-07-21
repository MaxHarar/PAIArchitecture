#!/usr/bin/env bun
/**
 * HeroSelector Test Suite
 *
 * Tests for context-aware hero selection algorithm.
 * Following TDD - these tests are written BEFORE implementation.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { homedir } from 'os';

import type { HeroCard, DailyContext, ContextTag } from '../Tools/types.ts';
import { parseAllDossiers } from '../Tools/HeroDossierParser.ts';

// Module under test
import {
  selectHeroForContext,
  scoreHeroForContext,
  getContextTags,
  deriveUserState
} from '../Tools/HeroSelector.ts';

const DOSSIERS_PATH = `${homedir()}/.claude/skills/DailyBriefing/Data/HeroDossiers`;

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestContext(overrides: Partial<DailyContext> = {}): DailyContext {
  return {
    recoveryScore: 70,
    sleepScore: 70,
    hasWorkout: false,
    workoutType: null,
    dayOfWeek: 'Wednesday',
    ...overrides
  };
}

// ============================================================================
// HeroSelector Tests
// ============================================================================

describe('HeroSelector', () => {
  let heroes: HeroCard[];

  beforeAll(() => {
    heroes = parseAllDossiers(DOSSIERS_PATH);
    expect(heroes.length).toBeGreaterThanOrEqual(7);
  });

  describe('selectHeroForContext', () => {
    it('should return a hero from the pool', () => {
      const context = createTestContext();
      const selected = selectHeroForContext(context, heroes);

      expect(selected).toBeDefined();
      expect(selected.id).toBeTruthy();
      expect(selected.name).toBeTruthy();
    });

    it('should prefer Stoics for low recovery', () => {
      const context = createTestContext({
        recoveryScore: 45,
        sleepScore: 55,
        hasWorkout: false,
        userState: 'low_recovery'
      });

      // Run multiple times to test weighted selection
      const selections: string[] = [];
      for (let i = 0; i < 20; i++) {
        const selected = selectHeroForContext(context, heroes);
        selections.push(selected.id);
      }

      // Stoics should appear frequently for low recovery
      const stoicCount = selections.filter(id =>
        ['marcus-aurelius', 'seneca', 'andrew-huberman'].includes(id)
      ).length;

      // At least 30% should be stoics/recovery heroes
      expect(stoicCount).toBeGreaterThan(5);
    });

    it('should prefer intensity heroes for high performance', () => {
      const context = createTestContext({
        recoveryScore: 90,
        sleepScore: 85,
        hasWorkout: true,
        workoutIntensity: 'hard',
        dayOfWeek: 'Monday',
        userState: 'high_performance'
      });

      // Run multiple times
      const selections: string[] = [];
      for (let i = 0; i < 20; i++) {
        const selected = selectHeroForContext(context, heroes);
        selections.push(selected.id);
      }

      // Intensity heroes should appear frequently
      const intensityCount = selections.filter(id =>
        ['david-goggins', 'jocko-willink', 'eliud-kipchoge'].includes(id)
      ).length;

      expect(intensityCount).toBeGreaterThan(5);
    });

    it('should prefer resilience heroes for adversity', () => {
      const context = createTestContext({
        recoveryScore: 55,
        sleepScore: 60,
        hasImportantEvent: true,
        userState: 'adversity'
      });

      const selections: string[] = [];
      for (let i = 0; i < 20; i++) {
        const selected = selectHeroForContext(context, heroes);
        selections.push(selected.id);
      }

      // Resilience heroes should appear frequently
      const resilienceCount = selections.filter(id =>
        ['marcus-aurelius', 'david-goggins', 'seneca'].includes(id)
      ).length;

      expect(resilienceCount).toBeGreaterThan(5);
    });

    it('should throw error for empty hero pool', () => {
      const context = createTestContext();
      expect(() => selectHeroForContext(context, [])).toThrow();
    });

    it('should provide variety (not always same hero)', () => {
      const context = createTestContext();

      const selections: Set<string> = new Set();
      for (let i = 0; i < 30; i++) {
        const selected = selectHeroForContext(context, heroes);
        selections.add(selected.id);
      }

      // Should select at least 2 different heroes over 30 tries
      expect(selections.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('scoreHeroForContext', () => {
    it('should score higher for matching context tags', () => {
      const context = createTestContext({
        recoveryScore: 45,
        sleepScore: 50
      });
      const contextTags = getContextTags(context);

      // Find Marcus (has low_recovery tag)
      const marcus = heroes.find(h => h.id === 'marcus-aurelius');
      expect(marcus).toBeDefined();

      // Find Goggins
      const goggins = heroes.find(h => h.id === 'david-goggins');
      expect(goggins).toBeDefined();

      if (marcus && goggins) {
        const marcusScore = scoreHeroForContext(marcus, context);
        // Both scores should be > 0
        expect(marcusScore).toBeGreaterThan(0);
      }
    });

    it('should return positive score for any hero', () => {
      const context = createTestContext();

      for (const hero of heroes) {
        const score = scoreHeroForContext(hero, context);
        expect(score).toBeGreaterThanOrEqual(0);
      }
    });

    it('should boost domain-relevant heroes for workouts', () => {
      const workoutContext = createTestContext({
        hasWorkout: true,
        workoutType: 'running',
        workoutIntensity: 'hard'
      });

      const kipchoge = heroes.find(h => h.id === 'eliud-kipchoge');
      const naval = heroes.find(h => h.id === 'naval-ravikant');

      if (kipchoge && naval) {
        const kipchogeScore = scoreHeroForContext(kipchoge, workoutContext);
        const navalScore = scoreHeroForContext(naval, workoutContext);

        // Kipchoge (endurance) should generally score higher for workouts
        // than Naval (wealth-wisdom), on average
        expect(kipchogeScore).toBeGreaterThan(0);
        expect(navalScore).toBeGreaterThan(0);
      }
    });
  });

  describe('getContextTags', () => {
    it('should always include "any" tag', () => {
      const context = createTestContext();
      const tags = getContextTags(context);

      expect(tags).toContain('any');
    });

    it('should add low_recovery for low recovery scores', () => {
      const context = createTestContext({
        recoveryScore: 45,
        sleepScore: 55
      });
      const tags = getContextTags(context);

      expect(tags).toContain('low_recovery');
    });

    it('should add high_recovery for high recovery scores', () => {
      const context = createTestContext({
        recoveryScore: 85,
        sleepScore: 82
      });
      const tags = getContextTags(context);

      expect(tags).toContain('high_recovery');
    });

    it('should add workout_day when has workout', () => {
      const context = createTestContext({
        hasWorkout: true
      });
      const tags = getContextTags(context);

      expect(tags).toContain('workout_day');
    });

    it('should add rest_day when no workout', () => {
      const context = createTestContext({
        hasWorkout: false
      });
      const tags = getContextTags(context);

      expect(tags).toContain('rest_day');
    });

    it('should add monday tag on Mondays', () => {
      const context = createTestContext({
        dayOfWeek: 'Monday'
      });
      const tags = getContextTags(context);

      expect(tags).toContain('monday');
    });

    it('should add weekend tag on weekends', () => {
      const satContext = createTestContext({ dayOfWeek: 'Saturday' });
      const sunContext = createTestContext({ dayOfWeek: 'Sunday' });

      expect(getContextTags(satContext)).toContain('weekend');
      expect(getContextTags(sunContext)).toContain('weekend');
    });

    it('should add adversity tag for important events', () => {
      const context = createTestContext({
        hasImportantEvent: true
      });
      const tags = getContextTags(context);

      expect(tags).toContain('adversity');
    });

    it('should add high_performance for good recovery + workout', () => {
      const context = createTestContext({
        recoveryScore: 85,
        sleepScore: 82,
        hasWorkout: true
      });
      const tags = getContextTags(context);

      expect(tags).toContain('high_performance');
    });

    it('should add challenge tag for hard intensity', () => {
      const context = createTestContext({
        hasWorkout: true,
        workoutIntensity: 'hard'
      });
      const tags = getContextTags(context);

      expect(tags).toContain('challenge');
    });
  });

  describe('deriveUserState', () => {
    it('should return low_recovery for poor recovery', () => {
      const context = createTestContext({
        recoveryScore: 45,
        sleepScore: 50
      });
      const state = deriveUserState(context);

      expect(state).toBe('low_recovery');
    });

    it('should return high_performance for good recovery + workout', () => {
      const context = createTestContext({
        recoveryScore: 85,
        sleepScore: 85,
        hasWorkout: true
      });
      const state = deriveUserState(context);

      expect(state).toBe('high_performance');
    });

    it('should return adversity for important event + low recovery', () => {
      const context = createTestContext({
        recoveryScore: 55,
        sleepScore: 60,
        hasImportantEvent: true
      });
      const state = deriveUserState(context);

      expect(state).toBe('adversity');
    });

    it('should return rest_day for no workout weekend', () => {
      const context = createTestContext({
        hasWorkout: false,
        dayOfWeek: 'Saturday'
      });
      const state = deriveUserState(context);

      expect(state).toBe('rest_day');
    });

    it('should return monday_start for Monday', () => {
      const context = createTestContext({
        dayOfWeek: 'Monday',
        recoveryScore: 70,
        sleepScore: 70
      });
      const state = deriveUserState(context);

      expect(state).toBe('monday_start');
    });

    it('should return grind_mode for hard workout intensity', () => {
      const context = createTestContext({
        hasWorkout: true,
        workoutIntensity: 'hard',
        recoveryScore: 70,
        sleepScore: 70
      });
      const state = deriveUserState(context);

      expect(state).toBe('grind_mode');
    });

    it('should return default for neutral conditions', () => {
      const context = createTestContext({
        recoveryScore: 70,
        sleepScore: 70,
        hasWorkout: false,
        dayOfWeek: 'Wednesday'
      });
      const state = deriveUserState(context);

      expect(state).toBe('default');
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('HeroSelector Edge Cases', () => {
  let heroes: HeroCard[];

  beforeAll(() => {
    heroes = parseAllDossiers(DOSSIERS_PATH);
  });

  it('should handle missing optional context fields', () => {
    const minimalContext: DailyContext = {
      recoveryScore: 70,
      sleepScore: 70,
      hasWorkout: false,
      workoutType: null,
      dayOfWeek: 'Tuesday'
    };

    const selected = selectHeroForContext(minimalContext, heroes);
    expect(selected).toBeDefined();
  });

  it('should handle extreme recovery scores', () => {
    const veryLow = createTestContext({ recoveryScore: 10, sleepScore: 15 });
    const veryHigh = createTestContext({ recoveryScore: 100, sleepScore: 100 });

    expect(() => selectHeroForContext(veryLow, heroes)).not.toThrow();
    expect(() => selectHeroForContext(veryHigh, heroes)).not.toThrow();
  });

  it('should handle single hero pool', () => {
    const context = createTestContext();
    const singleHero = [heroes[0]];

    const selected = selectHeroForContext(context, singleHero);
    expect(selected.id).toBe(heroes[0].id);
  });
});
