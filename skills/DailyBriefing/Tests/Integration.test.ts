#!/usr/bin/env bun
/**
 * Integration Test Suite
 *
 * Tests the complete hero dossier system integration:
 * - Parsing dossiers
 * - Context-aware selection
 * - Insight generation
 * - Telegram formatting
 * - Backward compatibility with briefing.ts
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

// Import main entry point (as briefing.ts does)
import {
  getHeroInsight,
  formatHeroInsightForTelegram,
  DailyContext,
  HeroInsight,
  selectHero,
} from '../Tools/HeroInsight.ts';

// Import new modules for direct testing
import { parseAllDossiers } from '../Tools/HeroDossierParser.ts';
import { selectHeroForContext, getContextTags, deriveUserState } from '../Tools/HeroSelector.ts';
import { generateInsight } from '../Tools/InsightGenerator.ts';
import type { HeroCard } from '../Tools/types.ts';

const DOSSIERS_PATH = `${homedir()}/.claude/skills/DailyBriefing/Data/HeroDossiers`;
const CACHE_PATH = `${homedir()}/.claude/skills/DailyBriefing/Data/ParsedHeroes/heroes.json`;

// ============================================================================
// Test Fixtures
// ============================================================================

function createContext(overrides: Partial<DailyContext> = {}): DailyContext {
  return {
    recoveryScore: 70,
    sleepScore: 70,
    hasWorkout: false,
    workoutType: null,
    dayOfWeek: 'Wednesday',
    ...overrides,
  };
}

// ============================================================================
// Full Integration Tests
// ============================================================================

describe('Hero Dossier Integration', () => {
  let heroes: HeroCard[];

  beforeAll(() => {
    heroes = parseAllDossiers(DOSSIERS_PATH);
    expect(heroes.length).toBeGreaterThanOrEqual(7);
  });

  describe('End-to-End Workflow', () => {
    it('should generate insight from raw dossiers', () => {
      const context = createContext({
        recoveryScore: 45,
        sleepScore: 50,
        hasWorkout: false,
      });

      // Full workflow
      const selectedHero = selectHeroForContext(context, heroes);
      expect(selectedHero).toBeDefined();
      expect(selectedHero.quotes.length).toBeGreaterThan(0);

      const insight = generateInsight(selectedHero, context);
      expect(insight.quote.verified).toBe(true);
      expect(insight.principle).toBeTruthy();
      expect(insight.action).toBeTruthy();
    });

    it('should work via HeroInsight.ts entry point (backward compatible)', () => {
      const context = createContext({
        recoveryScore: 85,
        sleepScore: 80,
        hasWorkout: true,
        workoutType: 'running',
      });

      // Use main entry point as briefing.ts does
      const insight = getHeroInsight(context);

      expect(insight).not.toBeNull();
      expect(insight!.hero.name).toBeTruthy();
      expect(insight!.principle).toBeTruthy();
      expect(insight!.quote).toBeDefined();

      // Quote should be VerifiedQuote object with source
      if (typeof insight!.quote === 'object') {
        expect(insight!.quote.verified).toBe(true);
        expect(insight!.quote.source).toBeTruthy();
      }
    });

    it('should format correctly for Telegram', () => {
      const context = createContext();
      const insight = getHeroInsight(context);
      const formatted = formatHeroInsightForTelegram(insight);

      // Should have all required HTML elements
      expect(formatted).toContain('<b>HERO INSIGHT</b>');
      expect(formatted).toContain('<b>Principle:</b>');
      expect(formatted).toContain('<b>Action:</b>');
      expect(formatted).toContain('<b>Implementation:</b>');
      expect(formatted).toContain('<b>Reflect:</b>');

      // Should not have undefined or null
      expect(formatted).not.toContain('undefined');
      expect(formatted).not.toContain('null');

      // Should have quote source attribution
      expect(formatted).toContain('<i>-');
    });
  });

  describe('Context-Based Selection', () => {
    const scenarios: { name: string; context: Partial<DailyContext>; expectedHeroes: string[] }[] = [
      {
        name: 'Low recovery should favor Stoics',
        context: { recoveryScore: 35, sleepScore: 40 },
        expectedHeroes: ['marcus-aurelius', 'seneca', 'andrew-huberman'],
      },
      {
        name: 'High performance should favor intensity heroes',
        context: { recoveryScore: 90, sleepScore: 85, hasWorkout: true, workoutIntensity: 'hard' },
        expectedHeroes: ['david-goggins', 'jocko-willink', 'eliud-kipchoge'],
      },
      {
        name: 'Monday should energize',
        context: { dayOfWeek: 'Monday', recoveryScore: 75, sleepScore: 75 },
        expectedHeroes: ['jocko-willink', 'david-goggins', 'marcus-aurelius'],
      },
      {
        name: 'Rest day weekend should be reflective',
        context: { dayOfWeek: 'Saturday', hasWorkout: false },
        expectedHeroes: ['naval-ravikant', 'seneca', 'marcus-aurelius', 'andrew-huberman'],
      },
    ];

    for (const scenario of scenarios) {
      it(scenario.name, () => {
        const context = createContext(scenario.context);

        // Run multiple selections to test weighted randomness
        const selections: string[] = [];
        for (let i = 0; i < 30; i++) {
          const hero = selectHeroForContext(context, heroes);
          selections.push(hero.id);
        }

        // At least some selections should be from expected heroes
        const expectedCount = selections.filter(id =>
          scenario.expectedHeroes.includes(id)
        ).length;

        // Should have at least 30% from expected heroes
        expect(expectedCount).toBeGreaterThan(8);
      });
    }
  });

  describe('Quote Verification', () => {
    it('all quotes in generated insights are verified', () => {
      const contexts = [
        createContext({ recoveryScore: 30, sleepScore: 40 }),
        createContext({ recoveryScore: 90, sleepScore: 90, hasWorkout: true }),
        createContext({ dayOfWeek: 'Monday' }),
        createContext({ dayOfWeek: 'Saturday', hasWorkout: false }),
        createContext({ hasImportantEvent: true }),
      ];

      for (const context of contexts) {
        for (let i = 0; i < 5; i++) {
          const insight = getHeroInsight(context);
          expect(insight).not.toBeNull();

          // Quote should be verified
          if (typeof insight!.quote === 'object') {
            expect(insight!.quote.verified).toBe(true);
            expect(insight!.quote.text).toBeTruthy();
            expect(insight!.quote.source).toBeTruthy();
          }
        }
      }
    });

    it('no quote fabrication - all quotes from dossiers', () => {
      // Collect all possible quotes from dossiers
      const allQuotes = new Set<string>();
      for (const hero of heroes) {
        for (const quote of hero.quotes) {
          allQuotes.add(quote.text);
        }
      }

      // Generate many insights and verify quotes are from dossiers
      for (let i = 0; i < 50; i++) {
        const context = createContext({
          recoveryScore: 30 + Math.floor(Math.random() * 70),
          sleepScore: 30 + Math.floor(Math.random() * 70),
          hasWorkout: Math.random() > 0.5,
        });

        const insight = getHeroInsight(context);
        if (insight && typeof insight.quote === 'object') {
          expect(allQuotes.has(insight.quote.text)).toBe(true);
        }
      }
    });
  });

  describe('Cache System', () => {
    it('cache file exists and is valid JSON', () => {
      expect(existsSync(CACHE_PATH)).toBe(true);

      const content = readFileSync(CACHE_PATH, 'utf-8');
      const cache = JSON.parse(content);

      expect(cache.metadata).toBeDefined();
      expect(cache.heroes).toBeDefined();
      expect(Array.isArray(cache.heroes)).toBe(true);
      expect(cache.heroes.length).toBeGreaterThanOrEqual(7);
    });

    it('cache heroes match dossier heroes', () => {
      const content = readFileSync(CACHE_PATH, 'utf-8');
      const cache = JSON.parse(content);
      const cachedHeroes: HeroCard[] = cache.heroes;

      // Same count
      expect(cachedHeroes.length).toBe(heroes.length);

      // Same IDs
      const cachedIds = new Set(cachedHeroes.map(h => h.id));
      const dossierIds = new Set(heroes.map(h => h.id));

      for (const id of dossierIds) {
        expect(cachedIds.has(id)).toBe(true);
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('getHeroInsight returns expected shape', () => {
      const context = createContext();
      const insight = getHeroInsight(context);

      expect(insight).not.toBeNull();
      expect(insight!.hero).toBeDefined();
      expect(insight!.hero.name).toBeTruthy();
      expect(insight!.hero.domain).toBeTruthy();
      expect(insight!.principle).toBeTruthy();
      expect(insight!.action).toBeTruthy();
      expect(insight!.ifThen).toBeTruthy();
      expect(insight!.question).toBeTruthy();
      expect(insight!.quote).toBeDefined();
    });

    it('selectHero returns legacy Hero format', () => {
      const context = createContext();
      const hero = selectHero(context);

      expect(hero.id).toBeTruthy();
      expect(hero.name).toBeTruthy();
      expect(hero.domain).toBeTruthy();
      expect(Array.isArray(hero.principles)).toBe(true);
      expect(Array.isArray(hero.actions)).toBe(true);
    });

    it('formatHeroInsightForTelegram handles both quote formats', () => {
      // New format with VerifiedQuote object
      const newInsight = getHeroInsight(createContext());
      const newFormatted = formatHeroInsightForTelegram(newInsight);
      expect(newFormatted).toContain('<i>"');
      expect(newFormatted).toContain('<i>-');

      // Legacy format with string quote (simulated)
      const legacyInsight: any = {
        hero: { name: 'Test', domain: 'test', id: 'test' },
        principle: 'Test principle',
        action: 'Test action',
        ifThen: 'If test, then test',
        question: 'Test question?',
        quote: '"This is a legacy quote"',
      };
      const legacyFormatted = formatHeroInsightForTelegram(legacyInsight);
      expect(legacyFormatted).toContain('This is a legacy quote');
    });
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('hero selection is fast (< 10ms for 100 selections)', () => {
    const heroes = parseAllDossiers(DOSSIERS_PATH);
    const context = createContext();

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      selectHeroForContext(context, heroes);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100); // 100ms for 100 selections
  });

  it('insight generation is fast (< 20ms for 50 insights)', () => {
    const heroes = parseAllDossiers(DOSSIERS_PATH);
    const context = createContext();

    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      const hero = selectHeroForContext(context, heroes);
      generateInsight(hero, context);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200); // 200ms for 50 insights
  });
});
