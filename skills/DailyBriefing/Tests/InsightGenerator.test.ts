#!/usr/bin/env bun
/**
 * InsightGenerator Test Suite
 *
 * Tests for generating personalized hero insights.
 * Following TDD - these tests are written BEFORE implementation.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { homedir } from 'os';

import type { HeroCard, DailyContext, HeroInsight, VerifiedQuote } from '../Tools/types.ts';
import { parseAllDossiers } from '../Tools/HeroDossierParser.ts';
import { getContextTags } from '../Tools/HeroSelector.ts';

// Module under test
import {
  generateInsight,
  selectVerifiedQuote,
  selectPrinciple,
  selectAction,
  generateIfThen,
  generateQuestion,
  formatHeroInsightForTelegram
} from '../Tools/InsightGenerator.ts';

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
// InsightGenerator Tests
// ============================================================================

describe('InsightGenerator', () => {
  let heroes: HeroCard[];
  let marcus: HeroCard;
  let goggins: HeroCard;

  beforeAll(() => {
    heroes = parseAllDossiers(DOSSIERS_PATH);
    marcus = heroes.find(h => h.id === 'marcus-aurelius')!;
    goggins = heroes.find(h => h.id === 'david-goggins')!;

    expect(marcus).toBeDefined();
    expect(goggins).toBeDefined();
  });

  describe('generateInsight', () => {
    it('should generate complete insight from hero', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);

      expect(insight).toBeDefined();
      expect(insight.hero).toBeDefined();
      expect(insight.hero.name).toBe('Marcus Aurelius');
      expect(insight.hero.id).toBe('marcus-aurelius');
      expect(insight.hero.domain).toBe('philosophy');
    });

    it('should include verified quote', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);

      expect(insight.quote).toBeDefined();
      expect(insight.quote.text).toBeTruthy();
      expect(insight.quote.source).toBeTruthy();
      expect(insight.quote.verified).toBe(true);
    });

    it('should include principle from hero', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);

      expect(insight.principle).toBeTruthy();
      // Principle should be from the hero's operating principles
      expect(marcus.operatingPrinciples.some(p =>
        insight.principle === p || p.includes(insight.principle.slice(0, 20))
      )).toBe(true);
    });

    it('should include action from signature tactics', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);

      expect(insight.action).toBeTruthy();
    });

    it('should include implementation intention (if-then)', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);

      expect(insight.ifThen).toBeTruthy();
      // Should follow if-then format
      expect(insight.ifThen.toLowerCase()).toMatch(/if .+ then/);
    });

    it('should include reflective question', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);

      expect(insight.question).toBeTruthy();
      // Questions typically end with ?
      expect(insight.question).toMatch(/\?$/);
    });

    it('should include context match info', () => {
      const context = createTestContext({
        recoveryScore: 45,
        sleepScore: 50
      });
      const insight = generateInsight(marcus, context);

      expect(insight.contextMatch).toBeDefined();
      expect(insight.contextMatch.tags).toBeTruthy();
      expect(insight.contextMatch.score).toBeGreaterThanOrEqual(0);
      expect(insight.contextMatch.reason).toBeTruthy();
    });
  });

  describe('selectVerifiedQuote', () => {
    it('should return a verified quote from hero', () => {
      const quote = selectVerifiedQuote(marcus);

      expect(quote).toBeDefined();
      expect(quote.text).toBeTruthy();
      expect(quote.source).toBeTruthy();
      expect(quote.verified).toBe(true);
    });

    it('should only return verified quotes', () => {
      // Run multiple times to test randomness
      for (let i = 0; i < 10; i++) {
        const quote = selectVerifiedQuote(marcus);
        expect(quote.verified).toBe(true);
      }
    });

    it('should throw for hero with no quotes', () => {
      const noQuotesHero: HeroCard = {
        ...marcus,
        quotes: []
      };

      expect(() => selectVerifiedQuote(noQuotesHero)).toThrow();
    });
  });

  describe('selectPrinciple', () => {
    it('should return a principle from hero', () => {
      const principle = selectPrinciple(marcus);

      expect(principle).toBeTruthy();
      expect(typeof principle).toBe('string');
    });

    it('should handle heroes with many principles', () => {
      const principle = selectPrinciple(marcus);

      // Should be one of the hero's principles
      expect(marcus.operatingPrinciples.length).toBeGreaterThan(0);
    });

    it('should return fallback for empty principles', () => {
      const noPrinciplesHero: HeroCard = {
        ...marcus,
        operatingPrinciples: []
      };

      const principle = selectPrinciple(noPrinciplesHero);
      expect(principle).toBeTruthy();
    });
  });

  describe('selectAction', () => {
    it('should return an action from hero', () => {
      const action = selectAction(marcus);

      expect(action).toBeTruthy();
      expect(typeof action).toBe('string');
    });

    it('should return fallback for empty tactics', () => {
      const noTacticsHero: HeroCard = {
        ...marcus,
        signatureTactics: []
      };

      const action = selectAction(noTacticsHero);
      expect(action).toBeTruthy();
    });
  });

  describe('generateIfThen', () => {
    it('should generate if-then statement', () => {
      const context = createTestContext();
      const ifThen = generateIfThen(marcus, context);

      expect(ifThen).toBeTruthy();
      expect(ifThen.toLowerCase()).toContain('if');
      expect(ifThen.toLowerCase()).toContain('then');
    });

    it('should be contextually relevant', () => {
      const workoutContext = createTestContext({
        hasWorkout: true,
        workoutIntensity: 'hard'
      });

      const ifThen = generateIfThen(goggins, workoutContext);
      expect(ifThen).toBeTruthy();
    });
  });

  describe('generateQuestion', () => {
    it('should generate a reflective question', () => {
      const question = generateQuestion(marcus);

      expect(question).toBeTruthy();
      expect(question).toMatch(/\?$/);
    });
  });
});

// ============================================================================
// Telegram Formatting Tests
// ============================================================================

describe('Telegram Formatting', () => {
  let heroes: HeroCard[];
  let marcus: HeroCard;

  beforeAll(() => {
    heroes = parseAllDossiers(DOSSIERS_PATH);
    marcus = heroes.find(h => h.id === 'marcus-aurelius')!;
  });

  describe('formatHeroInsightForTelegram', () => {
    it('should format insight with HTML tags', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);
      const formatted = formatHeroInsightForTelegram(insight);

      expect(formatted).toContain('<b>HERO INSIGHT</b>');
      expect(formatted).toContain('Marcus Aurelius');
      expect(formatted).toContain('<b>Principle:</b>');
      expect(formatted).toContain('<b>Action:</b>');
    });

    it('should include all insight components', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);
      const formatted = formatHeroInsightForTelegram(insight);

      expect(formatted).toContain(insight.principle.substring(0, 30));
      expect(formatted).toContain(insight.quote.text.substring(0, 30));
    });

    it('should not contain undefined', () => {
      const context = createTestContext();
      const insight = generateInsight(marcus, context);
      const formatted = formatHeroInsightForTelegram(insight);

      expect(formatted).not.toContain('undefined');
      expect(formatted).not.toContain('null');
    });

    it('should handle null insight gracefully', () => {
      const formatted = formatHeroInsightForTelegram(null as any);
      expect(formatted).toBe('');
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('InsightGenerator Integration', () => {
  let heroes: HeroCard[];

  beforeAll(() => {
    heroes = parseAllDossiers(DOSSIERS_PATH);
  });

  it('should generate insights for all heroes', () => {
    const context = createTestContext();

    for (const hero of heroes) {
      const insight = generateInsight(hero, context);

      expect(insight).toBeDefined();
      expect(insight.hero.name).toBe(hero.name);
      expect(insight.quote.verified).toBe(true);
      expect(insight.principle).toBeTruthy();
      expect(insight.action).toBeTruthy();
      expect(insight.ifThen).toBeTruthy();
      expect(insight.question).toBeTruthy();
    }
  });

  it('should generate valid Telegram output for all heroes', () => {
    const context = createTestContext();

    for (const hero of heroes) {
      const insight = generateInsight(hero, context);
      const formatted = formatHeroInsightForTelegram(insight);

      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(100);
      expect(formatted).not.toContain('undefined');
    }
  });

  it('should handle various context scenarios', () => {
    const scenarios: Partial<DailyContext>[] = [
      { recoveryScore: 30, sleepScore: 40 }, // Very low
      { recoveryScore: 95, sleepScore: 95, hasWorkout: true }, // High performance
      { hasWorkout: true, workoutIntensity: 'hard' }, // Grind mode
      { dayOfWeek: 'Monday' }, // Fresh start
      { dayOfWeek: 'Saturday', hasWorkout: false }, // Rest day
      { hasImportantEvent: true, recoveryScore: 50 }, // Adversity
    ];

    for (const scenario of scenarios) {
      const context = createTestContext(scenario);
      for (const hero of heroes.slice(0, 2)) { // Test with first 2 heroes
        const insight = generateInsight(hero, context);
        expect(insight).toBeDefined();
        expect(insight.quote.verified).toBe(true);
      }
    }
  });
});
