#!/usr/bin/env bun
/**
 * ParseHeroes CLI Tool
 *
 * Parses all hero dossier markdown files and generates a cached heroes.json file.
 * This pre-parsing improves runtime performance of the daily briefing.
 *
 * Usage:
 *   bun run ParseHeroes.ts           # Parse all dossiers and generate cache
 *   bun run ParseHeroes.ts --verify  # Verify existing cache is up to date
 *   bun run ParseHeroes.ts --stats   # Show statistics about parsed heroes
 *
 * @module ParseHeroes
 */

import { writeFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parseAllDossiers } from './HeroDossierParser.ts';
import type { HeroCard } from './types.ts';

// ============================================================================
// Paths
// ============================================================================

const DOSSIERS_DIR = `${homedir()}/.claude/skills/DailyBriefing/Data/HeroDossiers`;
const CACHE_DIR = `${homedir()}/.claude/skills/DailyBriefing/Data/ParsedHeroes`;
const CACHE_FILE = `${CACHE_DIR}/heroes.json`;

// ============================================================================
// Cache Management
// ============================================================================

interface CacheMetadata {
  version: string;
  generatedAt: string;
  heroCount: number;
  sourceDir: string;
}

interface HeroCache {
  metadata: CacheMetadata;
  heroes: HeroCard[];
}

/**
 * Check if cache needs regeneration based on file modification times
 */
function cacheNeedsUpdate(): boolean {
  if (!existsSync(CACHE_FILE)) {
    return true;
  }

  const cacheStats = statSync(CACHE_FILE);
  const cacheTime = cacheStats.mtimeMs;

  // Check if any dossier file is newer than cache
  const dossierFiles = readdirSync(DOSSIERS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => join(DOSSIERS_DIR, f));

  for (const file of dossierFiles) {
    const stats = statSync(file);
    if (stats.mtimeMs > cacheTime) {
      return true;
    }
  }

  return false;
}

/**
 * Generate the cache file from dossiers
 */
function generateCache(): HeroCache {
  console.log('Parsing dossiers from:', DOSSIERS_DIR);

  const heroes = parseAllDossiers(DOSSIERS_DIR);

  const cache: HeroCache = {
    metadata: {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      heroCount: heroes.length,
      sourceDir: DOSSIERS_DIR,
    },
    heroes,
  };

  // Ensure cache directory exists
  if (!existsSync(CACHE_DIR)) {
    const { mkdirSync } = require('fs');
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`Cache written to: ${CACHE_FILE}`);

  return cache;
}

/**
 * Verify cache integrity and completeness
 */
function verifyCache(): boolean {
  if (!existsSync(CACHE_FILE)) {
    console.error('Cache file does not exist');
    return false;
  }

  try {
    const cacheContent = require(CACHE_FILE) as HeroCache;

    // Check metadata
    if (!cacheContent.metadata || !cacheContent.heroes) {
      console.error('Cache file is malformed');
      return false;
    }

    // Check hero count matches dossier count
    const dossierCount = readdirSync(DOSSIERS_DIR)
      .filter(f => f.endsWith('.md')).length;

    if (cacheContent.heroes.length !== dossierCount) {
      console.error(`Hero count mismatch: cache has ${cacheContent.heroes.length}, dossiers has ${dossierCount}`);
      return false;
    }

    // Verify each hero has required fields
    for (const hero of cacheContent.heroes) {
      if (!hero.id || !hero.name || !hero.quotes || hero.quotes.length === 0) {
        console.error(`Hero ${hero.id || 'unknown'} has missing required fields`);
        return false;
      }
    }

    console.log('Cache verification passed');
    console.log(`  Version: ${cacheContent.metadata.version}`);
    console.log(`  Generated: ${cacheContent.metadata.generatedAt}`);
    console.log(`  Hero count: ${cacheContent.metadata.heroCount}`);

    return true;
  } catch (error) {
    console.error('Failed to verify cache:', error);
    return false;
  }
}

/**
 * Print statistics about parsed heroes
 */
function printStats(heroes: HeroCard[]): void {
  console.log('\n=== Hero Statistics ===\n');

  let totalQuotes = 0;
  let totalPrinciples = 0;
  let totalTactics = 0;

  for (const hero of heroes) {
    const quoteCount = hero.quotes.length;
    const principleCount = hero.operatingPrinciples.length;
    const tacticCount = hero.signatureTactics.length;

    totalQuotes += quoteCount;
    totalPrinciples += principleCount;
    totalTactics += tacticCount;

    console.log(`${hero.name} (${hero.id})`);
    console.log(`  Domain: ${hero.domain}`);
    console.log(`  Era: ${hero.era}`);
    console.log(`  Quotes: ${quoteCount}`);
    console.log(`  Principles: ${principleCount}`);
    console.log(`  Tactics: ${tacticCount}`);
    console.log(`  Context Tags: ${hero.contextTags.join(', ')}`);
    console.log('');
  }

  console.log('=== Totals ===');
  console.log(`Heroes: ${heroes.length}`);
  console.log(`Total Quotes: ${totalQuotes}`);
  console.log(`Total Principles: ${totalPrinciples}`);
  console.log(`Total Tactics: ${totalTactics}`);
  console.log(`Average Quotes/Hero: ${(totalQuotes / heroes.length).toFixed(1)}`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
ParseHeroes - Hero Dossier Cache Generator

Usage:
  bun run ParseHeroes.ts           # Parse all dossiers and generate cache
  bun run ParseHeroes.ts --verify  # Verify existing cache is up to date
  bun run ParseHeroes.ts --stats   # Show statistics about parsed heroes
  bun run ParseHeroes.ts --force   # Force regeneration even if cache is current

Paths:
  Dossiers: ${DOSSIERS_DIR}
  Cache:    ${CACHE_FILE}
`);
    return;
  }

  if (args.includes('--verify')) {
    const valid = verifyCache();
    process.exit(valid ? 0 : 1);
  }

  if (args.includes('--stats')) {
    const heroes = parseAllDossiers(DOSSIERS_DIR);
    printStats(heroes);
    return;
  }

  // Check if update needed (unless --force)
  if (!args.includes('--force') && !cacheNeedsUpdate()) {
    console.log('Cache is up to date. Use --force to regenerate.');
    return;
  }

  // Generate cache
  const cache = generateCache();

  console.log(`\nSuccessfully parsed ${cache.heroes.length} heroes:`);
  for (const hero of cache.heroes) {
    console.log(`  - ${hero.name} (${hero.quotes.length} quotes)`);
  }
}

main().catch(console.error);
