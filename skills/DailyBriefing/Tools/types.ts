/**
 * Hero Dossier Types
 *
 * Type definitions for the hero dossier system as specified in HERO_ARCHITECTURE.md
 */

// ============================================================================
// Context Types
// ============================================================================

/**
 * Valid context tags for hero selection matching
 */
/**
 * Core context tags used for hero selection matching.
 * Additional tags from dossiers are also valid.
 */
export type CoreContextTag =
  | 'low_recovery'
  | 'high_recovery'
  | 'high_performance'
  | 'workout_day'
  | 'rest_day'
  | 'monday'
  | 'weekend'
  | 'adversity'
  | 'difficult_people'
  | 'stress'
  | 'any';

/**
 * Context tag - either a core tag or custom string from dossier.
 * Extensible to support any tag defined in hero dossiers.
 */
export type ContextTag = string;

/**
 * User's physiological and contextual state
 */
export type UserState =
  | 'low_recovery'      // Recovery < 60 or Sleep < 60
  | 'high_performance'  // Recovery >= 80, Sleep >= 80, workout day
  | 'adversity'         // Important event + low recovery
  | 'rest_day'          // No workout, weekend
  | 'monday_start'      // Monday, fresh week
  | 'grind_mode'        // High workout intensity
  | 'default';

// ============================================================================
// Daily Context
// ============================================================================

/**
 * Daily context for hero selection (extended from existing)
 */
export interface DailyContext {
  // Physiological
  recoveryScore: number;        // 0-100 from Garmin
  sleepScore: number;           // 0-100 from Garmin
  hrvStatus?: 'Low' | 'Normal' | 'High';
  bodyBattery?: number;         // 0-100

  // Workout
  hasWorkout: boolean;
  workoutType: string | null;   // 'running', 'lifting', 'recovery', etc.
  workoutIntensity?: 'easy' | 'moderate' | 'hard' | null;

  // Calendar
  dayOfWeek: string;
  hasImportantEvent?: boolean;   // deadline, presentation, interview
  calendarKeywords?: string[];   // ['meeting', 'deadline', 'travel']
  calendarEvents?: CalendarEvent[];

  // Derived state (computed)
  userState?: UserState;
}

export interface CalendarEvent {
  title: string;
  time: string;
  description?: string;
}

// ============================================================================
// Quote Types
// ============================================================================

/**
 * A verified quote from a hero's Quote Bank
 */
export interface VerifiedQuote {
  text: string;                 // The quote text
  source: string;               // 'Meditations 5.20' or 'Can't Hurt Me'
  verified: boolean;            // Only true if from Quote Bank
  note?: string;                // Any verification notes
}

// ============================================================================
// Decision Filter
// ============================================================================

/**
 * A decision filter/heuristic from the hero
 */
export interface DecisionFilter {
  name: string;                 // 'The Control Test'
  description: string;          // Full filter description
}

// ============================================================================
// Hero Card (parsed from dossier Section B)
// ============================================================================

/**
 * Complete hero card parsed from markdown dossier
 */
export interface HeroCard {
  id: string;                   // 'marcus-aurelius', 'david-goggins'
  name: string;                 // 'Marcus Aurelius'
  era: string;                  // '121-180 CE' or '1975-present'
  domain: string;               // 'philosophy', 'mental-toughness'

  coreThesis: string;           // 1-2 sentence summary

  operatingPrinciples: string[];  // 10-12 principles
  decisionFilters: DecisionFilter[];
  failureModes: string[];
  signatureTactics: string[];

  contextTags: ContextTag[];    // From "Context Tags" line
  oneLiner: string;             // "If X ran today's brief..."

  quotes: VerifiedQuote[];      // From Section 10, verified only
}

// ============================================================================
// Hero Insight (output)
// ============================================================================

/**
 * Generated insight from a selected hero
 */
export interface HeroInsight {
  hero: {
    name: string;
    domain: string;
    id: string;
  };

  principle: string;           // From operatingPrinciples
  action: string;              // From signatureTactics, contextualized
  ifThen: string;              // Implementation intention
  question: string;            // Reflective question
  quote: VerifiedQuote;        // ONLY from Quote Bank

  contextMatch: {
    tags: ContextTag[];
    score: number;
    reason: string;            // Why this hero was selected
  };
}

// ============================================================================
// Hero Identity (parsed from dossier header)
// ============================================================================

/**
 * Hero identity extracted from dossier filename and content
 */
export interface HeroIdentity {
  id: string;
  name: string;
  era: string;
}

// ============================================================================
// Domain Mappings
// ============================================================================

/**
 * Map of hero names to their domains for parsing
 */
export const HERO_DOMAINS: Record<string, string> = {
  'marcus-aurelius': 'philosophy',
  'david-goggins': 'mental-toughness',
  'jocko-willink': 'leadership',
  'andrew-huberman': 'neuroscience',
  'naval-ravikant': 'wealth-wisdom',
  'seneca': 'philosophy',
  'eliud-kipchoge': 'endurance'
};
