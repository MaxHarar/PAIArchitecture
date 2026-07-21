#!/usr/bin/env bun
/**
 * InsightGenerator Module
 *
 * Generates personalized insights from selected heroes.
 * Uses only verified quotes from Quote Bank sections.
 *
 * @module InsightGenerator
 */

import type { HeroCard, DailyContext, HeroInsight, VerifiedQuote, ContextTag } from './types.ts';
import { getContextTags, deriveUserState, scoreHeroForContext } from './HeroSelector.ts';

// ============================================================================
// Quote Selection
// ============================================================================

/**
 * Select a random verified quote from a hero
 *
 * @param hero - Hero to get quote from
 * @returns A verified quote
 * @throws Error if hero has no verified quotes
 */
export function selectVerifiedQuote(hero: HeroCard): VerifiedQuote {
  const verifiedQuotes = hero.quotes.filter(q => q.verified === true);

  if (verifiedQuotes.length === 0) {
    throw new Error(`Hero ${hero.name} has no verified quotes`);
  }

  return verifiedQuotes[Math.floor(Math.random() * verifiedQuotes.length)];
}

// ============================================================================
// Component Selection
// ============================================================================

/**
 * Select a random principle from hero's operating principles
 *
 * @param hero - Hero to get principle from
 * @returns A principle string
 */
export function selectPrinciple(hero: HeroCard): string {
  if (!hero.operatingPrinciples || hero.operatingPrinciples.length === 0) {
    return 'Focus on what matters and act with intention.';
  }

  return hero.operatingPrinciples[
    Math.floor(Math.random() * hero.operatingPrinciples.length)
  ];
}

/**
 * Select a random action from hero's signature tactics
 *
 * @param hero - Hero to get action from
 * @returns An action string
 */
export function selectAction(hero: HeroCard): string {
  if (!hero.signatureTactics || hero.signatureTactics.length === 0) {
    return 'Take one meaningful action aligned with your goals today.';
  }

  return hero.signatureTactics[
    Math.floor(Math.random() * hero.signatureTactics.length)
  ];
}

// ============================================================================
// If-Then Generation
// ============================================================================

/**
 * Generate an implementation intention (if-then statement)
 *
 * @param hero - Hero providing the framework
 * @param context - User's current context
 * @returns Implementation intention string
 */
export function generateIfThen(hero: HeroCard, context: DailyContext): string {
  const userState = deriveUserState(context);

  // Context-specific if-then templates
  const ifThenTemplates: Record<string, string[]> = {
    low_recovery: [
      'If I feel tired, then I will focus only on recovery and essentials.',
      'If I encounter obstacles, then I will see them as opportunities for wisdom.',
      'If I feel overwhelmed, then I will retreat to my inner citadel.',
    ],
    high_performance: [
      'If I feel ready to push, then I will give my full effort.',
      'If I face the workout, then I will embrace the challenge completely.',
      'If I doubt myself, then I will remember my past victories.',
    ],
    adversity: [
      'If I face difficulty, then I will use it as fuel for growth.',
      'If challenges arise, then I will see them as tests of my character.',
      'If I feel stressed, then I will focus on what I can control.',
    ],
    grind_mode: [
      'If my mind says quit, then I will push through 10 more minutes.',
      'If the workout gets hard, then I will lean into the discomfort.',
      'If I want to stop, then I will remember I am only 40% done.',
    ],
    rest_day: [
      'If I feel guilty about resting, then I will remember recovery enables growth.',
      'If I have free time, then I will invest in learning and reflection.',
      'If I feel restless, then I will practice intentional stillness.',
    ],
    monday_start: [
      'If I wake up, then I will attack the day immediately.',
      'If I feel resistance, then I will start with the smallest action.',
      'If the week feels daunting, then I will focus only on today.',
    ],
    default: [
      'If I face a decision, then I will ask what virtue demands.',
      'If I encounter difficulty, then I will see it as training.',
      'If I feel uncertain, then I will act with wisdom and courage.',
    ],
  };

  const templates = ifThenTemplates[userState] || ifThenTemplates.default;
  return templates[Math.floor(Math.random() * templates.length)];
}

// ============================================================================
// Question Generation
// ============================================================================

/**
 * Generate a reflective question from hero's perspective
 *
 * @param hero - Hero providing the question
 * @returns Reflective question string
 */
export function generateQuestion(hero: HeroCard): string {
  // Default reflective questions based on hero domain
  const domainQuestions: Record<string, string[]> = {
    philosophy: [
      'What is within my control right now?',
      'Am I acting from principle or from emotion?',
      'How would my best self handle this situation?',
      'Will this matter in five years?',
      'If today were my last, would I be satisfied with how I spent it?',
    ],
    'mental-toughness': [
      'Am I giving everything I have, or holding back?',
      'What would the hardest version of me do right now?',
      'Is this discomfort or actual danger?',
      'Who am I when no one is watching?',
      'What will I regret NOT doing today?',
    ],
    leadership: [
      'What am I avoiding that I need to face?',
      'Am I leading or waiting to be led?',
      'What would extreme ownership look like here?',
      'Am I making excuses or finding solutions?',
      'What decision am I avoiding?',
    ],
    neuroscience: [
      'Am I working with my biology or against it?',
      'What one protocol would most improve my energy today?',
      'Am I prioritizing recovery as much as effort?',
      'When did I last get quality sleep?',
      'Is my focus environment optimized?',
    ],
    'wealth-wisdom': [
      'Am I building assets or just trading time for money?',
      'What specific knowledge am I developing?',
      'Is this a long-term game with long-term people?',
      'What would I do if money were no object?',
      'Am I optimizing for peace of mind?',
    ],
    endurance: [
      'Am I enjoying the process or just chasing the outcome?',
      'Am I being consistent or searching for shortcuts?',
      'Is my mind as trained as my body?',
      'Am I running my own race or comparing to others?',
      'What small improvement can I make today?',
    ],
  };

  const questions = domainQuestions[hero.domain] || domainQuestions.philosophy;
  return questions[Math.floor(Math.random() * questions.length)];
}

// ============================================================================
// Selection Reason Generation
// ============================================================================

/**
 * Generate a reason for why this hero was selected
 *
 * @param hero - Selected hero
 * @param context - User's context
 * @returns Reason string
 */
function generateSelectionReason(hero: HeroCard, context: DailyContext): string {
  const userState = deriveUserState(context);
  const tags = getContextTags(context);

  const reasons: Record<string, string> = {
    low_recovery: `${hero.name}'s wisdom on acceptance and inner strength matches your recovery needs.`,
    high_performance: `${hero.name}'s drive for excellence aligns with your high readiness today.`,
    adversity: `${hero.name}'s resilience philosophy speaks to today's challenges.`,
    grind_mode: `${hero.name}'s intensity mindset matches your hard workout day.`,
    rest_day: `${hero.name}'s reflective wisdom suits your rest and recovery focus.`,
    monday_start: `${hero.name}'s energizing perspective kicks off your fresh week.`,
    default: `${hero.name}'s timeless wisdom applies to your day.`,
  };

  return reasons[userState] || reasons.default;
}

// ============================================================================
// Main Insight Generator
// ============================================================================

/**
 * Generate a complete hero insight for the given context
 *
 * @param hero - Selected hero to generate insight from
 * @param context - User's current context
 * @returns Complete HeroInsight object
 */
export function generateInsight(hero: HeroCard, context: DailyContext): HeroInsight {
  const tags = getContextTags(context);
  const score = scoreHeroForContext(hero, context);
  const reason = generateSelectionReason(hero, context);

  return {
    hero: {
      name: hero.name,
      domain: hero.domain,
      id: hero.id,
    },
    principle: selectPrinciple(hero),
    action: selectAction(hero),
    ifThen: generateIfThen(hero, context),
    question: generateQuestion(hero),
    quote: selectVerifiedQuote(hero),
    contextMatch: {
      tags: tags as ContextTag[],
      score,
      reason,
    },
  };
}

// ============================================================================
// Telegram Formatting
// ============================================================================

/**
 * Format a HeroInsight for Telegram HTML output
 *
 * @param insight - Insight to format
 * @returns HTML-formatted string for Telegram
 */
export function formatHeroInsightForTelegram(insight: HeroInsight | null): string {
  if (!insight) {
    return '';
  }

  return `
<b>HERO INSIGHT</b>
<i>${insight.hero.name} on ${insight.hero.domain}</i>

<b>Principle:</b> ${insight.principle}

<b>Action:</b> ${insight.action}

<b>Implementation:</b> ${insight.ifThen}

<b>Reflect:</b> ${insight.question}

<code>---------------------------------</code>
<i>"${insight.quote.text}"</i>
<i>- ${insight.quote.source}</i>
`.trim();
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const { parseAllDossiers } = await import('./HeroDossierParser.ts');
  const { selectHeroForContext } = await import('./HeroSelector.ts');
  const { homedir } = await import('os');

  const dossierPath = `${homedir()}/.claude/skills/DailyBriefing/Data/HeroDossiers`;
  const heroes = parseAllDossiers(dossierPath);

  // Test with sample context
  const context: DailyContext = {
    recoveryScore: 70,
    sleepScore: 75,
    hasWorkout: true,
    workoutType: 'running',
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
  };

  console.log('Context:', JSON.stringify(context, null, 2));
  console.log('\n--- Selected Hero & Insight ---\n');

  const hero = selectHeroForContext(context, heroes);
  const insight = generateInsight(hero, context);

  console.log(formatHeroInsightForTelegram(insight));
}
