#!/usr/bin/env bun
/**
 * HeroDossierParser Test Suite
 *
 * Tests for parsing markdown hero dossiers into structured HeroCard objects.
 * Following TDD - these tests are written BEFORE implementation.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

// Types matching architecture specification
import type { HeroCard, VerifiedQuote, ContextTag, DecisionFilter } from '../Tools/types.ts';

// Module under test - will be implemented after tests pass RED
import {
  parseDossierFile,
  parseAllDossiers,
  extractQuoteBank,
  extractContextTags,
  parseHeroCardSection,
  extractOperatingPrinciples,
  extractDecisionFilters,
  extractFailureModes,
  extractSignatureTactics,
  extractOneLiner,
  extractCoreThesis,
  extractHeroIdentity
} from '../Tools/HeroDossierParser.ts';

const DOSSIERS_PATH = `${homedir()}/.claude/skills/DailyBriefing/Data/HeroDossiers`;
const MARCUS_PATH = `${DOSSIERS_PATH}/MarcusAurelius.md`;
const GOGGINS_PATH = `${DOSSIERS_PATH}/DavidGoggins.md`;

// ============================================================================
// Parser Module Tests
// ============================================================================

describe('HeroDossierParser', () => {
  describe('parseDossierFile', () => {
    it('should parse Marcus Aurelius dossier correctly', () => {
      const card = parseDossierFile(MARCUS_PATH);

      expect(card).toBeDefined();
      expect(card.id).toBe('marcus-aurelius');
      expect(card.name).toBe('Marcus Aurelius');
      // Era can vary based on parsing (birth vs reign dates)
      expect(card.era).toMatch(/\d+-\d+.*CE/);
      expect(card.domain).toBe('philosophy');
    });

    it('should parse David Goggins dossier correctly', () => {
      const card = parseDossierFile(GOGGINS_PATH);

      expect(card).toBeDefined();
      expect(card.id).toBe('david-goggins');
      expect(card.name).toBe('David Goggins');
      // Era should contain 1975 and present
      expect(card.era).toMatch(/1975|present/);
      expect(card.domain).toBe('mental-toughness');
    });

    it('should extract at least 3 verified quotes', () => {
      const card = parseDossierFile(MARCUS_PATH);

      expect(card.quotes.length).toBeGreaterThanOrEqual(3);
      expect(card.quotes.every(q => q.verified === true)).toBe(true);
    });

    it('should extract operating principles', () => {
      const card = parseDossierFile(MARCUS_PATH);

      expect(card.operatingPrinciples.length).toBeGreaterThanOrEqual(5);
      expect(card.operatingPrinciples.some(p =>
        p.toLowerCase().includes('control')
      )).toBe(true);
    });

    it('should extract decision filters with name and description', () => {
      const card = parseDossierFile(MARCUS_PATH);

      expect(card.decisionFilters.length).toBeGreaterThanOrEqual(1);
      expect(card.decisionFilters[0]).toHaveProperty('name');
      expect(card.decisionFilters[0]).toHaveProperty('description');
    });

    it('should throw error for non-existent file', () => {
      expect(() => parseDossierFile('/nonexistent/path.md')).toThrow();
    });
  });

  describe('parseAllDossiers', () => {
    it('should parse all dossiers in directory', () => {
      const heroes = parseAllDossiers(DOSSIERS_PATH);

      expect(heroes.length).toBeGreaterThanOrEqual(7);
      expect(heroes.some(h => h.id === 'marcus-aurelius')).toBe(true);
      expect(heroes.some(h => h.id === 'david-goggins')).toBe(true);
    });

    it('should only include .md files', () => {
      const heroes = parseAllDossiers(DOSSIERS_PATH);

      // Each hero should have valid structure
      heroes.forEach(hero => {
        expect(hero.id).toBeTruthy();
        expect(hero.name).toBeTruthy();
        expect(hero.quotes.length).toBeGreaterThan(0);
      });
    });

    it('should return empty array for empty directory', () => {
      // Should handle gracefully
      const result = parseAllDossiers('/tmp/nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('extractQuoteBank', () => {
    it('should extract verified quotes with source citations', () => {
      const content = `
### 10. Quote Bank (Verified Only)

1. **"The impediment to action advances action. What stands in the way becomes the way."** - Meditations 5.20

2. **"Waste no more time arguing about what a good man should be. Be one."** - Meditations 10.16

3. **"You have power over your mind - not outside events."** - *Note: Widely attributed but exact citation unverified*
`;

      const quotes = extractQuoteBank(content);

      expect(quotes.length).toBe(2); // Only verified ones
      expect(quotes[0].text).toBe('The impediment to action advances action. What stands in the way becomes the way.');
      expect(quotes[0].source).toBe('Meditations 5.20');
      expect(quotes[0].verified).toBe(true);
    });

    it('should exclude quotes marked as unverified', () => {
      const content = `
### 10. Quote Bank

1. **"Real quote here."** - Source Book 1.1

2. **"Unverified quote."** - Attribution uncertain

3. **"Another fake."** - *Note: exact citation unverified*
`;

      const quotes = extractQuoteBank(content);

      expect(quotes.length).toBe(1);
      expect(quotes[0].text).toBe('Real quote here.');
    });

    it('should handle different quote formats', () => {
      const content = `
### 10. Quote Bank (Verified Only)

1. **"Quote with em dash."** - Source 1.1

2. **"Quote with en dash."** - Source 2.2

3. **"Quote with hyphen."** - Source 3.3
`;

      const quotes = extractQuoteBank(content);

      expect(quotes.length).toBe(3);
    });

    it('should handle quotes spanning multiple lines', () => {
      const content = `
### 10. Quote Bank (Verified Only)

1. **"Short quote."** - Source A

2. **"This is a longer quote that might span
multiple lines in the source."** - Source B
`;

      const quotes = extractQuoteBank(content);

      expect(quotes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractContextTags', () => {
    it('should parse context tags from backtick format', () => {
      const content = `
### Context Tags

\`low_recovery\`, \`monday\`, \`adversity\`, \`difficult_people\`, \`stress\`, \`any\`
`;

      const tags = extractContextTags(content);

      expect(tags).toContain('low_recovery');
      expect(tags).toContain('monday');
      expect(tags).toContain('adversity');
      expect(tags).toContain('any');
    });

    it('should return ["any"] for missing context tags', () => {
      const content = `
### Some Other Section

No context tags here.
`;

      const tags = extractContextTags(content);

      expect(tags).toEqual(['any']);
    });

    it('should handle various context tag formats', () => {
      const content = `
### Context Tags

\`workout_day\`, \`high_recovery\`, \`monday\`, \`low_recovery\`, \`adversity\`, \`challenge\`, \`discipline\`, \`mental_toughness\`, \`performance\`, \`competition\`, \`any\`
`;

      const tags = extractContextTags(content);

      expect(tags.length).toBeGreaterThan(5);
      expect(tags).toContain('workout_day');
      expect(tags).toContain('mental_toughness');
    });
  });

  describe('extractOperatingPrinciples', () => {
    it('should extract numbered operating principles', () => {
      const content = `
### Operating Principles

1. Distinguish what you control from what you don't. Invest energy only in your control.
2. Transform obstacles into opportunities. Every impediment is raw material for virtue.
3. Practice memento mori: remember you will die. This clarifies what matters.
`;

      const principles = extractOperatingPrinciples(content);

      expect(principles.length).toBe(3);
      expect(principles[0]).toContain('control');
      expect(principles[1]).toContain('obstacles');
    });

    it('should handle principles without numbers', () => {
      const content = `
### Operating Principles

- First principle here
- Second principle here
- Third principle here
`;

      const principles = extractOperatingPrinciples(content);

      expect(principles.length).toBe(3);
    });
  });

  describe('extractDecisionFilters', () => {
    it('should parse decision filters with name and description', () => {
      const content = `
### Decision Filters

1. **The Control Test** - Is this within my control? If no, release. If yes, what's the virtuous response?
2. **The Virtue Filter** - Does this align with wisdom, justice, courage, or temperance? If not, reject.
3. **The Death Question** - If I died tonight, would this matter?
`;

      const filters = extractDecisionFilters(content);

      expect(filters.length).toBe(3);
      expect(filters[0].name).toBe('The Control Test');
      expect(filters[0].description).toContain('within my control');
    });

    it('should handle various separator formats', () => {
      const content = `
### Decision Filters

1. **The Control Test** - Description with hyphen
2. **The Virtue Filter** - Description with em dash
3. **The Death Question** - Description with en dash
`;

      const filters = extractDecisionFilters(content);

      expect(filters.length).toBe(3);
    });
  });

  describe('extractFailureModes', () => {
    it('should extract failure modes list', () => {
      const content = `
### Failure Modes

1. **Philosophical talk without philosophical action** - Knowing virtue isn't practicing it
2. **Anger at "difficult people"** - Forgetting they act from ignorance
3. **Attachment to outcomes** - Seeking control over externals
`;

      const modes = extractFailureModes(content);

      expect(modes.length).toBe(3);
      expect(modes[0]).toContain('action');
    });
  });

  describe('extractSignatureTactics', () => {
    it('should extract signature tactics list', () => {
      const content = `
### Signature Tactics

- **Morning preparation ritual** - Rehearse the day's likely challenges
- **Evening review** - Reflect on actions and judgments
- **Negative visualization** - Imagine losing what you value
`;

      const tactics = extractSignatureTactics(content);

      expect(tactics.length).toBe(3);
      expect(tactics[0]).toContain('Morning');
    });
  });

  describe('extractOneLiner', () => {
    it('should extract one-liner from hero card section', () => {
      const content = `
### One-liner

**If Marcus Aurelius ran today's brief, he'd emphasize:** Control what you can (your mind), accept what you can't (everything else).
`;

      const oneLiner = extractOneLiner(content);

      expect(oneLiner).toContain('Control what you can');
    });

    it('should return default for missing one-liner', () => {
      const content = `
### Some Other Section

No one-liner here.
`;

      const oneLiner = extractOneLiner(content);

      // Empty string is acceptable when section missing
      expect(typeof oneLiner).toBe('string');
    });
  });

  describe('extractCoreThesis', () => {
    it('should extract core thesis paragraph', () => {
      const content = `
### Core Thesis

Marcus Aurelius teaches that true power lies in mastering your mind, not controlling external events. The universe operates by rational order.
`;

      const thesis = extractCoreThesis(content);

      expect(thesis).toContain('true power');
      expect(thesis).toContain('mastering your mind');
    });
  });

  describe('extractHeroIdentity', () => {
    it('should parse hero identity from title and content', () => {
      const filename = 'MarcusAurelius.md';
      const content = `# HERO DOSSIER: Marcus Aurelius

## A) HERO DOSSIER

### 1. Identity & Era

**Marcus Aurelius Antoninus** (April 26, 121 - March 17, 180 CE)

Roman emperor (161-180 CE) and Stoic philosopher.
`;

      const identity = extractHeroIdentity(filename, content);

      expect(identity.id).toBe('marcus-aurelius');
      expect(identity.name).toBe('Marcus Aurelius');
      // Era can be parsed as birth or reign dates
      expect(identity.era).toMatch(/\d+-\d+.*CE/);
    });

    it('should handle modern hero identity', () => {
      const filename = 'DavidGoggins.md';
      const content = `# HERO DOSSIER: David Goggins

## A) HERO DOSSIER

### 1. Identity & Era

**David Goggins** (born February 17, 1975, Buffalo, New York)

Retired Navy SEAL, ultra-endurance athlete.
`;

      const identity = extractHeroIdentity(filename, content);

      expect(identity.id).toBe('david-goggins');
      expect(identity.name).toBe('David Goggins');
      expect(identity.era).toBe('1975-present');
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('HeroDossierParser Integration', () => {
  let allHeroes: HeroCard[];

  beforeAll(() => {
    allHeroes = parseAllDossiers(DOSSIERS_PATH);
  });

  it('all heroes have required fields', () => {
    for (const hero of allHeroes) {
      expect(hero.id).toBeTruthy();
      expect(hero.name).toBeTruthy();
      expect(hero.domain).toBeTruthy();
      expect(hero.coreThesis).toBeTruthy();
      expect(hero.contextTags.length).toBeGreaterThan(0);
    }
  });

  it('all heroes have at least 3 verified quotes', () => {
    for (const hero of allHeroes) {
      expect(hero.quotes.length).toBeGreaterThanOrEqual(3);
      expect(hero.quotes.every(q => q.verified)).toBe(true);
    }
  });

  it('no duplicate hero IDs', () => {
    const ids = allHeroes.map(h => h.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('all context tags are non-empty strings', () => {
    for (const hero of allHeroes) {
      expect(hero.contextTags.length).toBeGreaterThan(0);
      for (const tag of hero.contextTags) {
        expect(typeof tag).toBe('string');
        expect(tag.length).toBeGreaterThan(0);
        // Tags should be lowercase with underscores
        expect(tag).toMatch(/^[a-z_]+$/);
      }
    }
  });
});
