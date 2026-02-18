#!/usr/bin/env bun
/**
 * HeroSelector Module
 *
 * Context-aware hero selection algorithm.
 * Scores heroes based on user context and selects with weighted randomness.
 *
 * @module HeroSelector
 */

import type { HeroCard, DailyContext, ContextTag, UserState } from './types.ts';

// ============================================================================
// Context Tag Derivation
// ============================================================================

/**
 * Derive context tags from user's daily context
 *
 * @param context - User's current physiological and calendar context
 * @returns Array of matching context tags
 */
export function getContextTags(context: DailyContext): ContextTag[] {
  const tags: ContextTag[] = ['any'];

  // Physiological state
  if (context.recoveryScore < 60 || context.sleepScore < 60) {
    tags.push('low_recovery');
  }
  if (context.recoveryScore >= 80 && context.sleepScore >= 80) {
    tags.push('high_recovery');
    if (context.hasWorkout) {
      tags.push('high_performance');
    }
  }

  // Workout state
  if (context.hasWorkout) {
    tags.push('workout_day');
    if (context.workoutIntensity === 'hard') {
      tags.push('challenge');
      tags.push('mental_toughness');
    }
  } else {
    tags.push('rest_day');
  }

  // Calendar state
  const day = context.dayOfWeek?.toLowerCase() || '';
  if (day === 'monday') {
    tags.push('monday');
  }
  if (['saturday', 'sunday'].includes(day)) {
    tags.push('weekend');
  }

  // Adversity detection
  if (context.hasImportantEvent) {
    tags.push('adversity');
    tags.push('stress');
  }

  // Keyword-based tags from calendar
  if (context.calendarKeywords?.some(k =>
    ['meeting', 'leadership', 'team', 'presentation'].includes(k.toLowerCase())
  )) {
    tags.push('duty');
    tags.push('difficult_people');
  }

  return tags;
}

// ============================================================================
// User State Derivation
// ============================================================================

/**
 * Derive user state from context for hero selection
 *
 * @param context - User's current context
 * @returns Derived user state
 */
export function deriveUserState(context: DailyContext): UserState {
  // Explicit state override
  if (context.userState) {
    return context.userState;
  }

  const recovery = context.recoveryScore ?? 70;
  const sleep = context.sleepScore ?? 70;
  const day = context.dayOfWeek?.toLowerCase() || '';

  // Low recovery takes priority
  if (recovery < 60 || sleep < 60) {
    // Adversity if important event during low recovery
    if (context.hasImportantEvent) {
      return 'adversity';
    }
    return 'low_recovery';
  }

  // High performance day
  if (recovery >= 80 && sleep >= 80 && context.hasWorkout) {
    return 'high_performance';
  }

  // Adversity (important event)
  if (context.hasImportantEvent) {
    return 'adversity';
  }

  // Monday fresh start
  if (day === 'monday') {
    return 'monday_start';
  }

  // Grind mode (hard workout)
  if (context.hasWorkout && context.workoutIntensity === 'hard') {
    return 'grind_mode';
  }

  // Rest day (no workout, especially weekend)
  if (!context.hasWorkout) {
    if (['saturday', 'sunday'].includes(day)) {
      return 'rest_day';
    }
  }

  return 'default';
}

// ============================================================================
// Hero Scoring
// ============================================================================

/**
 * Score a hero based on context match
 *
 * @param hero - Hero to score
 * @param context - User's current context
 * @returns Numeric score (higher = better match)
 */
export function scoreHeroForContext(hero: HeroCard, context: DailyContext): number {
  let score = 0;
  const tags = getContextTags(context);
  const userState = deriveUserState(context);

  // 1. Direct tag match (highest weight)
  for (const tag of hero.contextTags) {
    if (tags.includes(tag)) {
      score += tag === 'any' ? 1 : 5; // Specific tags worth more
    }
  }

  // 2. Domain relevance
  if (context.hasWorkout) {
    if (['mental-toughness', 'endurance'].includes(hero.domain)) {
      score += 3;
    }
  } else {
    if (['philosophy', 'wealth-wisdom', 'neuroscience'].includes(hero.domain)) {
      score += 2;
    }
  }

  // 3. State-specific boosts
  switch (userState) {
    case 'low_recovery':
      // Prefer Stoics and recovery-focused heroes
      if (['marcus-aurelius', 'seneca', 'andrew-huberman'].includes(hero.id)) {
        score += 4;
      }
      break;

    case 'high_performance':
      // Prefer intensity heroes
      if (['david-goggins', 'jocko-willink', 'eliud-kipchoge'].includes(hero.id)) {
        score += 4;
      }
      break;

    case 'adversity':
      // Prefer resilience heroes
      if (['marcus-aurelius', 'david-goggins', 'seneca'].includes(hero.id)) {
        score += 4;
      }
      break;

    case 'rest_day':
      // Prefer reflective heroes
      if (['naval-ravikant', 'seneca', 'andrew-huberman', 'marcus-aurelius'].includes(hero.id)) {
        score += 3;
      }
      break;

    case 'monday_start':
      // Prefer energizing heroes
      if (['jocko-willink', 'david-goggins', 'marcus-aurelius'].includes(hero.id)) {
        score += 3;
      }
      break;

    case 'grind_mode':
      // Prefer intensity heroes
      if (['david-goggins', 'eliud-kipchoge', 'jocko-willink'].includes(hero.id)) {
        score += 4;
      }
      break;
  }

  // 4. Add controlled randomness for variety
  score += Math.random() * 2;

  return score;
}

// ============================================================================
// Hero Selection
// ============================================================================

/**
 * Select the best hero for the given context
 *
 * @param context - User's current context
 * @param heroes - Pool of available heroes
 * @returns Selected hero based on scoring with weighted randomness
 * @throws Error if hero pool is empty
 */
export function selectHeroForContext(
  context: DailyContext,
  heroes: HeroCard[]
): HeroCard {
  if (heroes.length === 0) {
    throw new Error('No heroes available for selection');
  }

  if (heroes.length === 1) {
    return heroes[0];
  }

  // Score all heroes
  const scored = heroes.map(hero => ({
    hero,
    score: scoreHeroForContext(hero, context)
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Pick from top 3 candidates with weighted randomness
  const topCandidates = scored.slice(0, Math.min(3, scored.length));

  // Weights favor higher-scored heroes: 1, 0.6, 0.36
  const weights = topCandidates.map((_, i) => Math.pow(0.6, i));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let random = Math.random() * totalWeight;
  for (let i = 0; i < topCandidates.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return topCandidates[i].hero;
    }
  }

  // Fallback to top scorer
  return topCandidates[0].hero;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const { parseAllDossiers } = await import('./HeroDossierParser.ts');
  const { homedir } = await import('os');

  const dossierPath = `${homedir()}/.claude/skills/DailyBriefing/Data/HeroDossiers`;
  const heroes = parseAllDossiers(dossierPath);

  // Test with sample context
  const context: DailyContext = {
    recoveryScore: 70,
    sleepScore: 75,
    hasWorkout: true,
    workoutType: 'running',
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' })
  };

  console.log('Context:', JSON.stringify(context, null, 2));
  console.log('\nContext Tags:', getContextTags(context));
  console.log('User State:', deriveUserState(context));
  console.log('\n--- Hero Scores ---');

  for (const hero of heroes) {
    const score = scoreHeroForContext(hero, context);
    console.log(`${hero.name}: ${score.toFixed(2)}`);
  }

  console.log('\n--- Selected Hero ---');
  const selected = selectHeroForContext(context, heroes);
  console.log(selected.name);
}
