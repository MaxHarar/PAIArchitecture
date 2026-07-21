#!/usr/bin/env bun
/**
 * HeroDossierParser Module
 *
 * Parses markdown hero dossiers into structured HeroCard objects.
 * Extracts verified quotes only from Section 10 (Quote Bank).
 *
 * @module HeroDossierParser
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import type { HeroCard, VerifiedQuote, ContextTag, DecisionFilter, HeroIdentity } from './types.ts';
import { HERO_DOMAINS } from './types.ts';

// ============================================================================
// Main Parser Functions
// ============================================================================

/**
 * Parse a single dossier markdown file into a HeroCard
 *
 * @param path - Absolute path to the .md file
 * @returns Parsed HeroCard object
 * @throws Error if file doesn't exist or is malformed
 */
export function parseDossierFile(path: string): HeroCard {
  if (!existsSync(path)) {
    throw new Error(`Dossier file not found: ${path}`);
  }

  const content = readFileSync(path, 'utf-8');
  const filename = basename(path);

  // Extract identity from filename and content
  const identity = extractHeroIdentity(filename, content);

  // Find the Hero Card section (Section B)
  const heroCardSection = extractSection(content, '## B) HERO CARD');

  // Extract all components
  const coreThesis = extractCoreThesis(heroCardSection || content);
  const operatingPrinciples = extractOperatingPrinciples(heroCardSection || content);
  const decisionFilters = extractDecisionFilters(heroCardSection || content);
  const failureModes = extractFailureModes(heroCardSection || content);
  const signatureTactics = extractSignatureTactics(heroCardSection || content);
  const contextTags = extractContextTags(heroCardSection || content);
  const oneLiner = extractOneLiner(heroCardSection || content);

  // Extract verified quotes from Section 10
  const quotes = extractQuoteBank(content);

  // Determine domain from ID or defaults
  const domain = HERO_DOMAINS[identity.id] || 'wisdom';

  return {
    id: identity.id,
    name: identity.name,
    era: identity.era,
    domain,
    coreThesis,
    operatingPrinciples,
    decisionFilters,
    failureModes,
    signatureTactics,
    contextTags,
    oneLiner,
    quotes
  };
}

/**
 * Parse all dossier files in a directory
 *
 * @param directory - Path to directory containing .md files
 * @returns Array of parsed HeroCard objects
 */
export function parseAllDossiers(directory: string): HeroCard[] {
  if (!existsSync(directory)) {
    return [];
  }

  const files = readdirSync(directory)
    .filter(f => f.endsWith('.md'))
    .map(f => join(directory, f));

  const heroes: HeroCard[] = [];

  for (const file of files) {
    try {
      const hero = parseDossierFile(file);
      heroes.push(hero);
    } catch (error) {
      console.error(`Failed to parse ${file}:`, error);
    }
  }

  return heroes;
}

// ============================================================================
// Section Extraction Helpers
// ============================================================================

/**
 * Extract a named section from markdown content
 */
function extractSection(content: string, sectionHeader: string): string | null {
  const headerIndex = content.indexOf(sectionHeader);
  if (headerIndex === -1) return null;

  // Find next h2 section or end
  const afterHeader = content.slice(headerIndex + sectionHeader.length);
  const nextH2 = afterHeader.search(/^## [^#]/m);

  if (nextH2 === -1) {
    return afterHeader;
  }

  return afterHeader.slice(0, nextH2);
}

/**
 * Extract a subsection by h3 header
 */
function extractSubsection(content: string, h3Header: string): string {
  const regex = new RegExp(`### ${h3Header}[\\s\\S]*?(?=\\n### |$)`, 'i');
  const match = content.match(regex);
  return match ? match[0] : '';
}

// ============================================================================
// Quote Bank Parser
// ============================================================================

/**
 * Extract verified quotes from Section 10 (Quote Bank)
 *
 * @param content - Full dossier content
 * @returns Array of verified quotes only
 */
export function extractQuoteBank(content: string): VerifiedQuote[] {
  const quotes: VerifiedQuote[] = [];

  // Find Section 10
  const section10Match = content.match(/###\s*10\.\s*Quote Bank[^]*?(?=###\s*11\.|---\s*\n\n##|$)/i);
  if (!section10Match) return quotes;

  const section10 = section10Match[0];

  // Match numbered quotes: 1. **"Quote text"** - Source
  // Handle various dash types: -, -, -
  const quoteRegex = /^\d+\.\s+\*\*"([^"]+)"\*\*\s*[-\u2013\u2014]\s*(.+?)$/gm;

  for (const match of section10.matchAll(quoteRegex)) {
    const text = match[1].trim();
    const sourceLine = match[2].trim();

    // Check for unverified markers
    const isUnverified =
      sourceLine.toLowerCase().includes('unverified') ||
      sourceLine.toLowerCase().includes('attribution uncertain') ||
      sourceLine.toLowerCase().includes('citation unverified') ||
      sourceLine.includes('*Note:') ||
      sourceLine.toLowerCase().includes('paraphrase') ||
      sourceLine.toLowerCase().includes('widely attributed but');

    // Only include verified quotes
    if (!isUnverified) {
      // Clean up source (remove notes, trailing asterisks)
      const cleanSource = sourceLine
        .replace(/\*Note:.+\*$/i, '')
        .replace(/\s*\(verified.*\)/i, '')
        .replace(/\*+/g, '')
        .trim();

      quotes.push({
        text,
        source: cleanSource,
        verified: true
      });
    }
  }

  return quotes;
}

// ============================================================================
// Context Tags Parser
// ============================================================================

/**
 * Extract context tags from the Context Tags section
 *
 * @param content - Section B content or full content
 * @returns Array of context tags
 */
export function extractContextTags(content: string): ContextTag[] {
  // Match: ### Context Tags\n\n`tag1`, `tag2`, `tag3`
  const sectionMatch = content.match(/### Context Tags\s*\n\n([^\n]+)/i);
  if (!sectionMatch) return ['any'];

  const tagLine = sectionMatch[1];

  // Extract tags from backtick format
  const tagMatches = tagLine.match(/`([^`]+)`/g);
  if (!tagMatches) return ['any'];

  const tags: ContextTag[] = tagMatches
    .map(t => t.replace(/`/g, '').trim() as ContextTag)
    .filter(t => t.length > 0);

  return tags.length > 0 ? tags : ['any'];
}

// ============================================================================
// Hero Card Section Parsers
// ============================================================================

/**
 * Parse the Hero Card section
 */
export function parseHeroCardSection(content: string): Partial<HeroCard> {
  const heroCardSection = extractSection(content, '## B) HERO CARD');
  if (!heroCardSection) return {};

  return {
    coreThesis: extractCoreThesis(heroCardSection),
    operatingPrinciples: extractOperatingPrinciples(heroCardSection),
    decisionFilters: extractDecisionFilters(heroCardSection),
    failureModes: extractFailureModes(heroCardSection),
    signatureTactics: extractSignatureTactics(heroCardSection),
    contextTags: extractContextTags(heroCardSection),
    oneLiner: extractOneLiner(heroCardSection)
  };
}

/**
 * Extract Core Thesis paragraph
 */
export function extractCoreThesis(content: string): string {
  const subsection = extractSubsection(content, 'Core Thesis');
  if (!subsection) return '';

  // Get text after the header
  const lines = subsection.split('\n').slice(1);
  const thesis = lines
    .filter(l => l.trim() && !l.startsWith('#'))
    .join(' ')
    .trim();

  return thesis || 'Wisdom through practice.';
}

/**
 * Extract Operating Principles list
 */
export function extractOperatingPrinciples(content: string): string[] {
  const subsection = extractSubsection(content, 'Operating Principles');
  if (!subsection) return [];

  const principles: string[] = [];

  // Match numbered items: 1. Text or - Text
  const numberedRegex = /^(?:\d+\.|[-*])\s+(.+?)(?=\n(?:\d+\.|[-*])|$)/gm;
  const lines = subsection.split('\n').slice(1).join('\n');

  for (const match of lines.matchAll(numberedRegex)) {
    const text = match[1].trim();
    if (text && !text.startsWith('#')) {
      principles.push(text);
    }
  }

  return principles;
}

/**
 * Extract Decision Filters with name and description
 */
export function extractDecisionFilters(content: string): DecisionFilter[] {
  const subsection = extractSubsection(content, 'Decision Filters');
  if (!subsection) return [];

  const filters: DecisionFilter[] = [];

  // Match: 1. **Name** - Description
  const filterRegex = /^\d+\.\s+\*\*([^*]+)\*\*\s*[-\u2013\u2014]\s*(.+?)$/gm;

  for (const match of subsection.matchAll(filterRegex)) {
    filters.push({
      name: match[1].trim(),
      description: match[2].trim()
    });
  }

  return filters;
}

/**
 * Extract Failure Modes list
 */
export function extractFailureModes(content: string): string[] {
  const subsection = extractSubsection(content, 'Failure Modes');
  if (!subsection) return [];

  const modes: string[] = [];

  // Match numbered or bulleted items
  const regex = /^(?:\d+\.|[-*])\s+\*\*([^*]+)\*\*(?:\s*[-\u2013\u2014]\s*(.+))?$/gm;

  for (const match of subsection.matchAll(regex)) {
    const name = match[1].trim();
    const desc = match[2]?.trim() || '';
    modes.push(desc ? `${name} - ${desc}` : name);
  }

  // Also try plain numbered lists without bold
  if (modes.length === 0) {
    const plainRegex = /^(?:\d+\.|[-*])\s+(.+?)$/gm;
    for (const match of subsection.matchAll(plainRegex)) {
      const text = match[1].trim();
      if (text && !text.startsWith('#')) {
        modes.push(text);
      }
    }
  }

  return modes;
}

/**
 * Extract Signature Tactics list
 */
export function extractSignatureTactics(content: string): string[] {
  const subsection = extractSubsection(content, 'Signature Tactics');
  if (!subsection) return [];

  const tactics: string[] = [];

  // Match bulleted or numbered items with optional bold
  const regex = /^[-*]\s+\*\*([^*]+)\*\*(?:\s*[-\u2013\u2014]\s*(.+))?$/gm;

  for (const match of subsection.matchAll(regex)) {
    const name = match[1].trim();
    const desc = match[2]?.trim() || '';
    tactics.push(desc ? `${name} - ${desc}` : name);
  }

  // Also try plain bulleted lists
  if (tactics.length === 0) {
    const plainRegex = /^[-*]\s+(.+?)$/gm;
    for (const match of subsection.matchAll(plainRegex)) {
      const text = match[1].trim();
      if (text && !text.startsWith('#')) {
        tactics.push(text);
      }
    }
  }

  return tactics;
}

/**
 * Extract One-liner
 */
export function extractOneLiner(content: string): string {
  const subsection = extractSubsection(content, 'One-liner');
  if (!subsection) return '';

  // Look for: **If X ran today's brief...:** text
  const match = subsection.match(/\*\*If .+?:\*\*\s*(.+)/i);
  if (match) {
    return match[1].trim();
  }

  // Fallback: get text after header
  const lines = subsection.split('\n').slice(1);
  const text = lines
    .filter(l => l.trim() && !l.startsWith('#'))
    .join(' ')
    .trim();

  return text || 'Apply wisdom to today.';
}

// ============================================================================
// Hero Identity Parser
// ============================================================================

/**
 * Extract hero identity from filename and content
 *
 * @param filename - Dossier filename (e.g., 'MarcusAurelius.md')
 * @param content - Full dossier content
 * @returns HeroIdentity with id, name, era
 */
export function extractHeroIdentity(filename: string, content: string): HeroIdentity {
  // Generate ID from filename
  const baseName = filename.replace('.md', '');
  const id = baseName
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');

  // Extract name from title
  const titleMatch = content.match(/# HERO DOSSIER:\s*(.+)/i);
  const name = titleMatch ? titleMatch[1].trim() : baseName.replace(/([A-Z])/g, ' $1').trim();

  // Extract era from Identity section
  const identitySection = extractSubsection(content, '1. Identity & Era');
  let era = 'present';

  if (identitySection) {
    // Try to match birth year for modern figures "(born YEAR" FIRST (most specific)
    const bornMatch = identitySection.match(/\(born\s+(?:\w+\s+\d+,\s+)?(\d{4})/i);
    if (bornMatch) {
      era = bornMatch[1] + '-present';
    }
    // Try to match life dates like "(April 26, 121 - March 17, 180 CE)"
    else {
      const lifeMatch = identitySection.match(/\([^)]*?(\d{3,4})\s*[-\u2013]\s*[^)]*?(\d{3,4})\s*(?:CE|AD|BCE|BC)?\)/i);
      if (lifeMatch) {
        const year1 = parseInt(lifeMatch[1]);
        const year2 = parseInt(lifeMatch[2]);
        // For ancient dates, use CE suffix
        if (year1 < 500 || year2 < 500) {
          era = `${year1}-${year2} CE`;
        } else {
          era = `${year1}-${year2}`;
        }
      }
      // Try to match date ranges like "121-180 CE" or "(121 - 180 CE)"
      else {
        const dateRangeMatch = identitySection.match(/\(?\d{3,4}\s*[-\u2013]\s*\d{3,4}\s*(?:CE|AD|BCE|BC)?\)?/i);
        if (dateRangeMatch) {
          era = dateRangeMatch[0]
            .replace(/[()]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        }
      }
    }
  }

  return { id, name, era };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dossierPath = args[0];

  if (!dossierPath) {
    console.log('Usage: bun HeroDossierParser.ts <path-to-dossier.md>');
    console.log('\nExample: bun HeroDossierParser.ts Data/HeroDossiers/MarcusAurelius.md');
    process.exit(1);
  }

  try {
    const hero = parseDossierFile(dossierPath);
    console.log(JSON.stringify(hero, null, 2));
  } catch (error) {
    console.error('Error parsing dossier:', error);
    process.exit(1);
  }
}
