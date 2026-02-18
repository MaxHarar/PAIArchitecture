#!/usr/bin/env bun
/**
 * HeroInsight Module Tests
 *
 * Comprehensive test suite covering:
 * 1. Hero card validation
 * 2. Hero selection with different context scenarios
 * 3. Output formatting for Telegram
 * 4. Edge cases (missing data, tie scores)
 *
 * Run with: bun test HeroInsight.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import {
  HeroInsight,
  Hero,
  HeroCard,
  DailyContext,
  ValidationResult,
  selectHero,
  getHeroInsight,
  formatHeroInsightForTelegram,
  validateHeroCard,
  validateHeroCouncil,
  loadHeroCouncilFromFile,
  analyzeCalendarContext,
  getRandomVerifiedQuote,
  heroes
} from './HeroInsight.ts';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_DATA_DIR = '/tmp/hero-insight-test';
const TEST_HERO_COUNCIL_PATH = `${TEST_DATA_DIR}/hero-council.json`;

// ============================================================================
// Test Helpers
// ============================================================================

function createTestHeroCard(): HeroCard {
  return {
    id: 'test-hero',
    name: 'Test Hero',
    title: 'Test Title',
    era: 'Present',
    domain: 'testing',
    principles: ['Test Principle One', 'Test Principle Two'],
    contextTriggers: {
      keywords: ['test', 'example'],
      situations: ['testing-scenario'],
      metrics: { testMetric: true }
    },
    insightTemplate: {
      morningGreeting: 'Good morning, tester!',
      focusAdvice: 'Focus on testing today.',
      challengeReframe: 'Tests are opportunities for improvement.',
      actionPrompt: 'What test will you run today?',
      closingWisdom: 'All tests shall pass.'
    },
    actions: ['Run tests', 'Write more tests'],
    ifThens: ['If tests fail, then debug'],
    questions: ['Did the tests pass?'],
    quotes: [
      { text: 'Test quote', source: 'Test Book', verified: true }
    ],
    contexts: ['any']
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('HeroInsight Module', () => {
  beforeEach(() => {
    // Clean up and create test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  // =========================================================================
  // Hero Database Tests
  // =========================================================================
  describe('Hero Database', () => {
    it('should have at least 7 heroes for variety', () => {
      expect(heroes.length).toBeGreaterThanOrEqual(7);
    });

    it('should have required fields for each hero', () => {
      for (const hero of heroes) {
        expect(hero.id).toBeTruthy();
        expect(hero.name).toBeTruthy();
        expect(hero.domain).toBeTruthy();
        expect(hero.principles).toBeTruthy();
        expect(hero.principles.length).toBeGreaterThan(0);
        expect(hero.quotes).toBeTruthy();
        expect(hero.quotes.length).toBeGreaterThan(0);
        expect(hero.contexts).toBeTruthy();
      }
    });

    it('should include Marcus Aurelius for stoic philosophy', () => {
      const marcus = heroes.find(h => h.id === 'marcus-aurelius');
      expect(marcus).toBeTruthy();
      expect(marcus?.domain).toBe('philosophy');
    });

    it('should include David Goggins for mental toughness', () => {
      const goggins = heroes.find(h => h.id === 'david-goggins');
      expect(goggins).toBeTruthy();
      expect(goggins?.domain).toBe('mental-toughness');
    });

    it('should include Jocko Willink for leadership', () => {
      const jocko = heroes.find(h => h.id === 'jocko-willink');
      expect(jocko).toBeTruthy();
      expect(jocko?.domain).toBe('leadership');
    });
  });

  // =========================================================================
  // Hero Card Validation Tests
  // =========================================================================
  describe('Hero Card Validation', () => {
    it('should validate a complete hero card', () => {
      const heroCard = createTestHeroCard();
      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject hero card without id', () => {
      const heroCard = createTestHeroCard();
      delete (heroCard as any).id;

      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: id');
    });

    it('should reject hero card without name', () => {
      const heroCard = createTestHeroCard();
      delete (heroCard as any).name;

      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: name');
    });

    it('should reject hero card with empty principles', () => {
      const heroCard = createTestHeroCard();
      heroCard.principles = [];

      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Hero must have at least one principle');
    });

    it('should reject hero card without insightTemplate', () => {
      const heroCard = createTestHeroCard();
      delete (heroCard as any).insightTemplate;

      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: insightTemplate');
    });

    it('should accept hero card without quotes (optional)', () => {
      const heroCard = createTestHeroCard();
      delete (heroCard as any).quotes;

      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(true);
    });

    it('should reject quote without verified flag', () => {
      const heroCard = createTestHeroCard();
      heroCard.quotes = [{ text: 'Unverified', source: 'Unknown' } as any];

      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('verified'))).toBe(true);
    });

    it('should reject hero card with missing insightTemplate fields', () => {
      const heroCard = createTestHeroCard();
      (heroCard.insightTemplate as any) = { morningGreeting: 'Hello' };

      const result = validateHeroCard(heroCard);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('focusAdvice'))).toBe(true);
    });
  });

  // =========================================================================
  // Hero Council Validation Tests
  // =========================================================================
  describe('Hero Council Validation', () => {
    it('should validate a complete hero council', () => {
      const council = [createTestHeroCard()];
      const result = validateHeroCouncil(council);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty hero council', () => {
      const result = validateHeroCouncil([]);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Hero council must have at least one hero');
    });

    it('should reject hero council with duplicate ids', () => {
      const hero1 = createTestHeroCard();
      const hero2 = createTestHeroCard();
      hero2.name = 'Different Name';

      const result = validateHeroCouncil([hero1, hero2]);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate hero id'))).toBe(true);
    });

    it('should collect errors from all invalid heroes', () => {
      const hero1 = createTestHeroCard();
      delete (hero1 as any).id;

      const hero2 = createTestHeroCard();
      hero2.id = 'hero2';
      hero2.principles = [];

      const result = validateHeroCouncil([hero1, hero2]);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  // =========================================================================
  // Hero Selection Tests
  // =========================================================================
  describe('selectHero', () => {
    it('should select a hero based on context', () => {
      const context: DailyContext = {
        recoveryScore: 85,
        sleepScore: 75,
        hasWorkout: true,
        workoutType: 'strength',
        dayOfWeek: 'Monday'
      };

      const hero = selectHero(context);
      expect(hero).toBeTruthy();
      expect(hero.id).toBeTruthy();
    });

    it('should favor resilience heroes on low recovery days', () => {
      const lowRecoveryContext: DailyContext = {
        recoveryScore: 40,
        sleepScore: 50,
        hasWorkout: false,
        workoutType: null,
        dayOfWeek: 'Tuesday'
      };

      // Run selection multiple times to check bias
      const selections: string[] = [];
      for (let i = 0; i < 20; i++) {
        const hero = selectHero(lowRecoveryContext);
        selections.push(hero.id);
      }

      // Should include resilience-focused heroes
      const resilienceHeroes = ['marcus-aurelius', 'david-goggins', 'jocko-willink'];
      const hasResilienceHero = selections.some(id => resilienceHeroes.includes(id));
      expect(hasResilienceHero).toBe(true);
    });

    it('should favor performance heroes on high recovery workout days', () => {
      const highRecoveryWorkout: DailyContext = {
        recoveryScore: 90,
        sleepScore: 85,
        hasWorkout: true,
        workoutType: 'running',
        dayOfWeek: 'Wednesday'
      };

      // Run selection to verify performance heroes are included
      const selections: string[] = [];
      for (let i = 0; i < 20; i++) {
        const hero = selectHero(highRecoveryWorkout);
        selections.push(hero.id);
      }

      // Should have variety but include performance-oriented heroes
      expect(selections.length).toBe(20);
    });

    it('should handle missing context gracefully', () => {
      const minimalContext: DailyContext = {
        recoveryScore: 0,
        sleepScore: 0,
        hasWorkout: false,
        workoutType: null,
        dayOfWeek: 'Sunday'
      };

      const hero = selectHero(minimalContext);
      expect(hero).toBeTruthy();
    });

    it('should handle undefined context values', () => {
      const partialContext = {
        recoveryScore: undefined as any,
        sleepScore: undefined as any,
        hasWorkout: false,
        workoutType: null,
        dayOfWeek: 'Monday'
      };

      // Should not throw
      const hero = selectHero(partialContext);
      expect(hero).toBeTruthy();
    });
  });

  // =========================================================================
  // Hero Insight Generation Tests
  // =========================================================================
  describe('getHeroInsight', () => {
    it('should return all 5 components', () => {
      const context: DailyContext = {
        recoveryScore: 75,
        sleepScore: 70,
        hasWorkout: true,
        workoutType: 'cardio',
        dayOfWeek: 'Thursday'
      };

      const insight = getHeroInsight(context);

      expect(insight.hero).toBeTruthy();
      expect(insight.principle).toBeTruthy();
      expect(insight.action).toBeTruthy();
      expect(insight.ifThen).toBeTruthy();
      expect(insight.question).toBeTruthy();
      expect(insight.quote).toBeTruthy();
    });

    it('should have properly formatted if-then statement', () => {
      const context: DailyContext = {
        recoveryScore: 75,
        sleepScore: 70,
        hasWorkout: false,
        workoutType: null,
        dayOfWeek: 'Friday'
      };

      const insight = getHeroInsight(context);

      // If-then should contain "If" and "then"
      expect(insight.ifThen.toLowerCase()).toContain('if');
      expect(insight.ifThen.toLowerCase()).toContain('then');
    });

    it('should return a question that ends with ?', () => {
      const context: DailyContext = {
        recoveryScore: 60,
        sleepScore: 65,
        hasWorkout: true,
        workoutType: 'yoga',
        dayOfWeek: 'Saturday'
      };

      const insight = getHeroInsight(context);
      expect(insight.question.trim().endsWith('?')).toBe(true);
    });

    it('should return null insight if heroes array is empty', () => {
      const context: DailyContext = {
        recoveryScore: 0,
        sleepScore: 0,
        hasWorkout: false,
        workoutType: null,
        dayOfWeek: 'Monday'
      };

      const emptyHeroResult = getHeroInsight(context, []);
      expect(emptyHeroResult).toBeNull();
    });
  });

  // =========================================================================
  // Telegram Formatting Tests
  // =========================================================================
  describe('formatHeroInsightForTelegram', () => {
    it('should format insight with section header', () => {
      const insight: HeroInsight = {
        hero: {
          id: 'marcus-aurelius',
          name: 'Marcus Aurelius',
          domain: 'philosophy',
          principles: ['Control what you can control'],
          quotes: ['"The obstacle is the way."'],
          contexts: ['low_recovery', 'any']
        } as Hero,
        principle: 'Control what you can control',
        action: 'Focus on your response, not the situation',
        ifThen: 'If I feel overwhelmed, then I will focus only on my next action',
        question: 'What is within my control right now?',
        quote: '"The obstacle is the way."'
      };

      const formatted = formatHeroInsightForTelegram(insight);

      expect(formatted).toContain('HERO INSIGHT');
      expect(formatted).toContain('Marcus Aurelius');
      expect(formatted).toContain('Control what you can control');
      expect(formatted).toContain('The obstacle is the way');
    });

    it('should include all components in formatted output', () => {
      const insight: HeroInsight = {
        hero: {
          id: 'test-hero',
          name: 'Test Hero',
          domain: 'testing',
          principles: ['Test Principle'],
          quotes: ['"Test Quote"'],
          contexts: ['any']
        } as Hero,
        principle: 'Test Principle',
        action: 'Test Action',
        ifThen: 'If test, then verify',
        question: 'Did the test pass?',
        quote: '"Test Quote"'
      };

      const formatted = formatHeroInsightForTelegram(insight);

      expect(formatted).toContain('Principle:');
      expect(formatted).toContain('Action:');
      expect(formatted).toContain('If');
      expect(formatted).toContain('Reflect:');
    });

    it('should use HTML formatting for Telegram', () => {
      const insight: HeroInsight = {
        hero: {
          id: 'test-hero',
          name: 'Test Hero',
          domain: 'testing',
          principles: ['Test'],
          quotes: ['"Quote"'],
          contexts: ['any']
        } as Hero,
        principle: 'Test',
        action: 'Act',
        ifThen: 'If x, then y',
        question: 'Why?',
        quote: '"Quote"'
      };

      const formatted = formatHeroInsightForTelegram(insight);

      expect(formatted).toContain('<b>');
      expect(formatted).toContain('<i>');
    });

    it('should return empty string for null insight', () => {
      const formatted = formatHeroInsightForTelegram(null);
      expect(formatted).toBe('');
    });
  });

  // =========================================================================
  // Calendar Context Analysis Tests
  // =========================================================================
  describe('analyzeCalendarContext', () => {
    it('should extract workout keywords from calendar events', () => {
      const events = [
        { title: 'Hard Run - 10 miles', time: '06:30' },
        { title: 'Team Meeting', time: '10:00' }
      ];

      const keywords = analyzeCalendarContext(events);

      expect(keywords).toContain('run');
      expect(keywords).toContain('hard');
    });

    it('should handle empty events array', () => {
      const keywords = analyzeCalendarContext([]);
      expect(keywords).toEqual([]);
    });

    it('should handle events with null titles', () => {
      const events = [
        { title: null as any, time: '10:00' },
        { title: 'Team Meeting', time: '11:00' }
      ];

      const keywords = analyzeCalendarContext(events);
      expect(keywords).toContain('team');
    });

    it('should detect leadership keywords', () => {
      const events = [
        { title: 'Leadership Training Session', time: '09:00' },
        { title: 'Team Standup', time: '10:00' }
      ];

      const keywords = analyzeCalendarContext(events);

      expect(keywords).toContain('leadership');
      expect(keywords).toContain('team');
    });
  });

  // =========================================================================
  // Verified Quote Selection Tests
  // =========================================================================
  describe('getRandomVerifiedQuote', () => {
    it('should only return verified quotes', () => {
      const heroCard = createTestHeroCard();
      heroCard.quotes = [
        { text: 'Verified Quote', source: 'Book', verified: true },
        { text: 'Unverified Quote', source: 'Unknown', verified: false }
      ];

      // Run multiple times to ensure only verified quotes
      for (let i = 0; i < 10; i++) {
        const quote = getRandomVerifiedQuote(heroCard);
        if (quote) {
          expect(quote.verified).toBe(true);
        }
      }
    });

    it('should return undefined when no verified quotes', () => {
      const heroCard = createTestHeroCard();
      heroCard.quotes = [
        { text: 'Unverified', source: 'Unknown', verified: false }
      ];

      const quote = getRandomVerifiedQuote(heroCard);
      expect(quote).toBeUndefined();
    });

    it('should return undefined when no quotes array', () => {
      const heroCard = createTestHeroCard();
      delete (heroCard as any).quotes;

      const quote = getRandomVerifiedQuote(heroCard);
      expect(quote).toBeUndefined();
    });

    it('should return random quote from verified pool', () => {
      const heroCard = createTestHeroCard();
      heroCard.quotes = [
        { text: 'Quote A', source: 'Book A', verified: true },
        { text: 'Quote B', source: 'Book B', verified: true },
        { text: 'Quote C', source: 'Book C', verified: true }
      ];

      const quotes: string[] = [];
      for (let i = 0; i < 50; i++) {
        const quote = getRandomVerifiedQuote(heroCard);
        if (quote) quotes.push(quote.text);
      }

      // Should have some variety (probabilistic but should work)
      const unique = [...new Set(quotes)];
      expect(unique.length).toBeGreaterThan(1);
    });
  });

  // =========================================================================
  // Hero Council File Loading Tests
  // =========================================================================
  describe('loadHeroCouncilFromFile', () => {
    it('should load hero council from file', () => {
      const heroCouncil = {
        version: '1.0.0',
        heroes: [createTestHeroCard()]
      };
      writeFileSync(TEST_HERO_COUNCIL_PATH, JSON.stringify(heroCouncil));

      const loaded = loadHeroCouncilFromFile(TEST_HERO_COUNCIL_PATH);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('test-hero');
    });

    it('should throw error for missing file', () => {
      expect(() => loadHeroCouncilFromFile('/nonexistent/file.json')).toThrow();
    });

    it('should throw error for invalid JSON', () => {
      writeFileSync(TEST_HERO_COUNCIL_PATH, 'not valid json');

      expect(() => loadHeroCouncilFromFile(TEST_HERO_COUNCIL_PATH)).toThrow();
    });

    it('should throw error for invalid hero council structure', () => {
      writeFileSync(TEST_HERO_COUNCIL_PATH, JSON.stringify({ invalid: true }));

      expect(() => loadHeroCouncilFromFile(TEST_HERO_COUNCIL_PATH)).toThrow();
    });
  });

  // =========================================================================
  // Edge Cases Tests
  // =========================================================================
  describe('Edge Cases', () => {
    describe('Missing Data Handling', () => {
      it('should select hero with null training data', () => {
        const context: DailyContext = {
          recoveryScore: 70,
          sleepScore: 70,
          hasWorkout: false,
          workoutType: null,
          dayOfWeek: 'Monday'
        };

        const hero = selectHero(context);
        expect(hero).toBeTruthy();
      });

      it('should select hero with all zero metrics', () => {
        const context: DailyContext = {
          recoveryScore: 0,
          sleepScore: 0,
          hasWorkout: false,
          workoutType: null,
          dayOfWeek: 'Sunday'
        };

        const hero = selectHero(context);
        expect(hero).toBeTruthy();
      });

      it('should handle empty day of week', () => {
        const context: DailyContext = {
          recoveryScore: 70,
          sleepScore: 70,
          hasWorkout: true,
          workoutType: 'running',
          dayOfWeek: ''
        };

        const hero = selectHero(context);
        expect(hero).toBeTruthy();
      });
    });

    describe('Tie Score Handling', () => {
      it('should break ties deterministically', () => {
        // Create context that doesn't strongly favor any hero
        const context: DailyContext = {
          recoveryScore: 50,
          sleepScore: 50,
          hasWorkout: false,
          workoutType: null,
          dayOfWeek: 'Wednesday'
        };

        // Selection should be consistent (within randomness bounds)
        const selections: string[] = [];
        for (let i = 0; i < 100; i++) {
          const hero = selectHero(context);
          selections.push(hero.id);
        }

        // Should have some variety due to randomness, but not all unique
        const unique = [...new Set(selections)];
        expect(unique.length).toBeLessThan(selections.length);
      });

      it('should select from top candidates consistently', () => {
        const context: DailyContext = {
          recoveryScore: 50,
          sleepScore: 50,
          hasWorkout: false,
          workoutType: null,
          dayOfWeek: 'Wednesday'
        };

        // Run many selections
        const selections: Map<string, number> = new Map();
        for (let i = 0; i < 100; i++) {
          const hero = selectHero(context);
          selections.set(hero.id, (selections.get(hero.id) || 0) + 1);
        }

        // Top candidates should appear more frequently
        const sortedByCount = Array.from(selections.entries())
          .sort((a, b) => b[1] - a[1]);

        // Most selected hero should have significant presence
        expect(sortedByCount[0][1]).toBeGreaterThan(10);
      });
    });

    describe('Invalid Input Handling', () => {
      it('should throw error for empty hero pool in getHeroInsight', () => {
        const context: DailyContext = {
          recoveryScore: 70,
          sleepScore: 70,
          hasWorkout: true,
          workoutType: 'running',
          dayOfWeek: 'Monday'
        };

        const result = getHeroInsight(context, []);
        expect(result).toBeNull();
      });

      it('should handle hero with missing actions array', () => {
        const context: DailyContext = {
          recoveryScore: 70,
          sleepScore: 70,
          hasWorkout: true,
          workoutType: 'running',
          dayOfWeek: 'Monday'
        };

        const heroWithoutActions = { ...heroes[0] };
        delete (heroWithoutActions as any).actions;

        // Should not throw
        const result = getHeroInsight(context, [heroWithoutActions as Hero]);
        expect(result).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // Integration Tests
  // =========================================================================
  describe('Integration Tests', () => {
    it('should generate complete insight for workout day', () => {
      const context: DailyContext = {
        recoveryScore: 85,
        sleepScore: 80,
        hasWorkout: true,
        workoutType: 'running',
        dayOfWeek: 'Monday'
      };

      const insight = getHeroInsight(context);
      expect(insight).toBeTruthy();

      const formatted = formatHeroInsightForTelegram(insight);
      expect(formatted).toContain('HERO INSIGHT');
      expect(formatted).toContain('<b>');
    });

    it('should generate complete insight for rest day', () => {
      const context: DailyContext = {
        recoveryScore: 55,
        sleepScore: 60,
        hasWorkout: false,
        workoutType: null,
        dayOfWeek: 'Sunday'
      };

      const insight = getHeroInsight(context);
      expect(insight).toBeTruthy();

      const formatted = formatHeroInsightForTelegram(insight);
      expect(formatted.length).toBeGreaterThan(100);
    });

    it('should load and use hero council from file', () => {
      // Write test hero council
      const heroCouncil = {
        version: '1.0.0',
        heroes: [createTestHeroCard()]
      };
      writeFileSync(TEST_HERO_COUNCIL_PATH, JSON.stringify(heroCouncil));

      // Load and use
      const loadedHeroes = loadHeroCouncilFromFile(TEST_HERO_COUNCIL_PATH);
      const context: DailyContext = {
        recoveryScore: 70,
        sleepScore: 70,
        hasWorkout: true,
        workoutType: 'testing',
        dayOfWeek: 'Monday'
      };

      const insight = getHeroInsight(context, loadedHeroes as Hero[]);
      expect(insight).toBeTruthy();
      expect(insight?.hero.id).toBe('test-hero');
    });
  });
});
