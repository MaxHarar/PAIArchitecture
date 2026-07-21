# Hero Dossier Integration Architecture

## Overview

This document defines the architecture for integrating 7 hero dossiers into the Daily Briefing system. The design enables context-aware hero selection based on user state (recovery, sleep, workout schedule, day of week), generates personalized daily insights using verified quotes only, and supports future hero additions.

**Architectural Principles:**
1. **Separation of Data from Logic** - Dossiers are markdown files; runtime uses parsed JSON
2. **Verified Quotes Only** - Only quotes from Section 10 (Quote Bank) with verification status
3. **Context-Aware Selection** - Hero choice adapts to user's physiological and calendar context
4. **Extensibility First** - Adding heroes requires only a new markdown file
5. **Fail-Safe Defaults** - System degrades gracefully if dossiers unavailable

---

## System Components

### Component Diagram

```
+---------------------------+
|     Daily Briefing        |
|     (briefing.ts)         |
+-----------+---------------+
            |
            v
+-----------+---------------+
|     HeroInsight.ts        |
|   (Orchestration Layer)   |
+-----------+---------------+
            |
    +-------+-------+
    |               |
    v               v
+-------+     +-------------+
| Parser|     | Selector    |
| Module|     | Module      |
+---+---+     +------+------+
    |                |
    v                v
+-------+     +-------------+
|Dossier|     | Context     |
| Files |     | Analyzer    |
| (.md) |     |             |
+-------+     +-------------+
```

### 1. HeroInsight.ts (Orchestration Layer)

**Responsibility:** Main entry point. Coordinates parsing, selection, and insight generation.

**Current State:** Contains hardcoded hero data (to be refactored)

**Target State:** Loads heroes from parsed dossiers, delegates to specialized modules

### 2. HeroDossierParser.ts (NEW)

**Responsibility:** Parse markdown dossiers into structured HeroCard objects

**Key Functions:**
- `parseDossierFile(path: string): HeroCard`
- `parseAllDossiers(directory: string): HeroCard[]`
- `extractQuoteBank(content: string): VerifiedQuote[]`
- `extractContextTags(content: string): ContextTag[]`
- `parseHeroCardSection(content: string): HeroCardData`

### 3. HeroSelector.ts (NEW)

**Responsibility:** Context-aware hero selection algorithm

**Key Functions:**
- `selectHeroForContext(context: DailyContext, heroes: HeroCard[]): HeroCard`
- `scoreHeroForContext(hero: HeroCard, context: DailyContext): number`
- `getContextTags(context: DailyContext): ContextTag[]`

### 4. InsightGenerator.ts (NEW)

**Responsibility:** Generate personalized insights from selected hero

**Key Functions:**
- `generateInsight(hero: HeroCard, context: DailyContext): HeroInsight`
- `selectVerifiedQuote(hero: HeroCard): VerifiedQuote`
- `buildActionFromContext(hero: HeroCard, context: DailyContext): string`

---

## File Structure

```
~/.claude/skills/DailyBriefing/
├── SKILL.md                          # Skill documentation
├── HERO_ARCHITECTURE.md              # This document
├── Config/
│   └── settings.json                 # Telegram config
├── Data/
│   ├── HeroDossiers/                 # Source of truth (markdown)
│   │   ├── MarcusAurelius.md
│   │   ├── DavidGoggins.md
│   │   ├── JockoWillink.md
│   │   ├── AndrewHuberman.md
│   │   ├── NavalRavikant.md
│   │   ├── Seneca.md
│   │   └── EliudKipchoge.md
│   └── ParsedHeroes/                 # Cached parsed JSON (NEW)
│       └── heroes.json               # Pre-parsed for runtime speed
├── Tools/
│   ├── briefing.ts                   # Main orchestrator
│   ├── briefing-on-wake.ts           # Wake-triggered daemon
│   ├── HeroInsight.ts                # Hero insight generation (REFACTOR)
│   ├── HeroDossierParser.ts          # Markdown parser (NEW)
│   ├── HeroSelector.ts               # Context-aware selection (NEW)
│   ├── InsightGenerator.ts           # Insight generation (NEW)
│   └── ParseHeroes.ts                # CLI to parse dossiers (NEW)
├── State/
│   └── wake-state.json               # Daemon state
└── Tests/
    ├── HeroDossierParser.test.ts     # Parser tests (NEW)
    ├── HeroSelector.test.ts          # Selection tests (NEW)
    └── InsightGenerator.test.ts      # Generation tests (NEW)
```

---

## Data Flow

### 1. Parse Phase (Build Time / Manual Refresh)

```
[Markdown Dossiers]
        │
        v
[HeroDossierParser.ts]
        │
        │  - Extract Section B (HeroCard)
        │  - Parse Section 10 (Quote Bank)
        │  - Extract Context Tags
        │  - Validate verified quotes
        │
        v
[ParsedHeroes/heroes.json]
        │
        │  Cached for runtime performance
        │  Regenerate on dossier update
```

### 2. Runtime Phase (Daily Briefing)

```
[Garmin Data] + [Calendar Events] + [Day of Week]
        │
        v
[DailyContext object]
        │
        v
[HeroSelector.ts]
        │  - Load parsed heroes from JSON
        │  - Score each hero against context
        │  - Select best match with weighted randomness
        │
        v
[Selected HeroCard]
        │
        v
[InsightGenerator.ts]
        │  - Select verified quote
        │  - Generate contextual action
        │  - Build if-then implementation
        │  - Choose reflective question
        │
        v
[HeroInsight object]
        │
        v
[formatHeroInsightForTelegram()]
        │
        v
[Telegram Message]
```

---

## Interfaces

### DailyContext (existing, extended)

```typescript
interface DailyContext {
  // Physiological
  recoveryScore: number;        // 0-100 from Garmin
  sleepScore: number;           // 0-100 from Garmin
  hrvStatus: 'Low' | 'Normal' | 'High';
  bodyBattery: number;          // 0-100

  // Workout
  hasWorkout: boolean;
  workoutType: string | null;   // 'running', 'lifting', 'recovery', etc.
  workoutIntensity: 'easy' | 'moderate' | 'hard' | null;

  // Calendar
  dayOfWeek: string;
  hasImportantEvent: boolean;   // deadline, presentation, interview
  calendarKeywords: string[];   // ['meeting', 'deadline', 'travel']

  // Derived state (computed)
  userState: UserState;
}

type UserState =
  | 'low_recovery'      // Recovery < 60 or Sleep < 60
  | 'high_performance'  // Recovery >= 80, Sleep >= 80, workout day
  | 'adversity'         // Important event + low recovery
  | 'rest_day'          // No workout, weekend
  | 'monday_start'      // Monday, fresh week
  | 'grind_mode'        // High workout intensity
  | 'default';
```

### HeroCard (from dossier Section B)

```typescript
interface HeroCard {
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

interface DecisionFilter {
  name: string;                 // 'The Control Test'
  description: string;          // Full filter description
}

interface VerifiedQuote {
  text: string;                 // The quote
  source: string;               // 'Meditations 5.20' or 'Can't Hurt Me'
  verified: boolean;            // Only true if from Quote Bank
  note?: string;                // Any verification notes
}

type ContextTag =
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
  | 'uncertainty'
  | 'mortality'
  | 'duty'
  | 'discipline'
  | 'resilience'
  | 'challenge'
  | 'mental_toughness'
  | 'performance'
  | 'competition'
  | 'any';
```

### HeroInsight (output)

```typescript
interface HeroInsight {
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
```

---

## Context-to-Hero Mapping Logic

### Scoring Algorithm

```typescript
function scoreHeroForContext(hero: HeroCard, context: DailyContext): number {
  let score = 0;
  const tags = getContextTags(context);

  // 1. Direct tag match (highest weight)
  for (const tag of hero.contextTags) {
    if (tags.includes(tag)) {
      score += tag === 'any' ? 1 : 5;  // Specific tags worth more
    }
  }

  // 2. Domain relevance
  if (context.hasWorkout && ['mental-toughness', 'endurance'].includes(hero.domain)) {
    score += 3;
  }
  if (!context.hasWorkout && ['philosophy', 'wealth-wisdom'].includes(hero.domain)) {
    score += 2;
  }

  // 3. State-specific boosts
  if (context.userState === 'low_recovery') {
    // Prefer Stoics and recovery-focused heroes
    if (['marcus-aurelius', 'seneca', 'andrew-huberman'].includes(hero.id)) {
      score += 4;
    }
  }
  if (context.userState === 'high_performance') {
    // Prefer intensity heroes
    if (['david-goggins', 'jocko-willink', 'eliud-kipchoge'].includes(hero.id)) {
      score += 4;
    }
  }
  if (context.userState === 'adversity') {
    // Prefer resilience heroes
    if (['marcus-aurelius', 'david-goggins', 'seneca'].includes(hero.id)) {
      score += 4;
    }
  }

  // 4. Add controlled randomness for variety
  score += Math.random() * 2;

  return score;
}
```

### Context Tag Derivation

```typescript
function getContextTags(context: DailyContext): ContextTag[] {
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
      tags.push('challenge', 'mental_toughness');
    }
  } else {
    tags.push('rest_day');
  }

  // Calendar state
  const day = context.dayOfWeek.toLowerCase();
  if (day === 'monday') tags.push('monday');
  if (['saturday', 'sunday'].includes(day)) tags.push('weekend');

  // Adversity detection
  if (context.hasImportantEvent) {
    tags.push('adversity', 'stress');
  }

  // Keyword-based tags
  if (context.calendarKeywords.some(k => ['meeting', 'leadership', 'team'].includes(k))) {
    tags.push('duty', 'difficult_people');
  }

  return tags;
}
```

### Hero Mapping Table

| User State | Primary Heroes | Secondary Heroes |
|------------|----------------|------------------|
| `low_recovery` | Marcus Aurelius, Seneca, Huberman | Naval |
| `high_performance` | Goggins, Jocko, Kipchoge | Marcus |
| `adversity` | Marcus Aurelius, Goggins, Seneca | Jocko |
| `rest_day` | Naval, Seneca, Huberman | Marcus |
| `monday_start` | Jocko, Goggins, Marcus | Kipchoge |
| `grind_mode` | Goggins, Kipchoge, Jocko | Marcus |
| `default` | Any (weighted random) | - |

---

## Dossier Parsing Specification

### Section Detection

The parser identifies sections by markdown headers:

```markdown
## A) HERO DOSSIER
### 1. Identity & Era
### 2. Telos (Core Aim)
...
### 10. Quote Bank (Verified Only)
### 11. Modern Translation for the User

## B) HERO CARD (RUNTIME SUMMARY)
### Core Thesis
### Operating Principles
### Decision Filters
### Failure Modes
### Signature Tactics
### Context Tags
### One-liner
```

### Quote Bank Parsing

Section 10 contains verified quotes. Parser extracts:

```typescript
interface RawQuote {
  number: number;
  text: string;
  source: string;
  note?: string;  // If marked with "Note:" or verification status
}

function extractQuoteBank(section10Content: string): VerifiedQuote[] {
  const quotes: VerifiedQuote[] = [];

  // Match numbered quotes: 1. **"Quote text"** - Source
  const quoteRegex = /^\d+\.\s+\*\*"(.+?)"\*\*\s*[-–—]\s*(.+?)$/gm;

  for (const match of section10Content.matchAll(quoteRegex)) {
    const text = match[1];
    const sourceLine = match[2];

    // Check for verification notes
    const isUnverified = sourceLine.toLowerCase().includes('unverified') ||
                         sourceLine.toLowerCase().includes('attribution uncertain');

    // Only include verified quotes
    if (!isUnverified && !sourceLine.includes('*Note:')) {
      quotes.push({
        text,
        source: sourceLine.replace(/\*Note:.+\*$/, '').trim(),
        verified: true
      });
    }
  }

  return quotes;
}
```

### Context Tags Parsing

From Section B, "Context Tags" line:

```typescript
function extractContextTags(content: string): ContextTag[] {
  // Match: ### Context Tags\n\n`tag1`, `tag2`, `tag3`
  const match = content.match(/### Context Tags\n\n`([^`]+)`/);
  if (!match) return ['any'];

  const tagString = match[1];
  const tags = tagString.split('`,\s*`');

  return tags.map(t => t.replace(/`/g, '').trim() as ContextTag);
}
```

---

## Integration Points with Daily Briefing

### 1. briefing.ts Integration

```typescript
// Current integration (line 17)
import { getHeroInsight, formatHeroInsightForTelegram, DailyContext, HeroInsight } from './HeroInsight.ts';

// No change needed - interface remains the same
// HeroInsight.ts internally refactored to use parsed dossiers
```

### 2. Context Building (enhanced)

```typescript
// In briefing.ts main():
const heroContext: DailyContext = {
  // Existing
  recoveryScore: garmin.recoveryScore,
  sleepScore: garmin.sleepScore,
  hasWorkout: workouts.some(w => isWorkoutEvent(w)),
  workoutType: prescription?.name || null,
  dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),

  // New (enhanced)
  hrvStatus: garmin.hrvStatus,
  bodyBattery: garmin.bodyBattery,
  workoutIntensity: prescription ? getIntensityFromZone(prescription.zone) : null,
  hasImportantEvent: detectImportantEvent(workouts),
  calendarKeywords: extractKeywordsFromEvents(workouts),
  userState: deriveUserState(garmin, workouts, prescription)
};
```

### 3. Telegram Formatting

```typescript
export function formatHeroInsightForTelegram(insight: HeroInsight): string {
  return `
<b>HERO INSIGHT</b>
<i>${insight.hero.name} on ${insight.hero.domain}</i>

<b>Principle:</b> ${insight.principle}

<b>Today's Action:</b> ${insight.action}

<b>Implementation:</b> ${insight.ifThen}

<b>Reflect:</b> ${insight.question}

<code>---------------------------------</code>
<i>"${insight.quote.text}"</i>
<i>— ${insight.quote.source}</i>
`.trim();
}
```

---

## Caching Strategy

### Build-Time Parse (Recommended)

```bash
# Parse all dossiers to JSON (run after dossier updates)
bun run ~/.claude/skills/DailyBriefing/Tools/ParseHeroes.ts

# Output: Data/ParsedHeroes/heroes.json
```

### Runtime Load

```typescript
function loadHeroes(): HeroCard[] {
  const cachePath = `${DOSSIER_DIR}/../ParsedHeroes/heroes.json`;

  if (existsSync(cachePath)) {
    // Fast path: load pre-parsed JSON
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  // Slow path: parse on demand (fallback)
  const dossierFiles = readdirSync(DOSSIER_DIR).filter(f => f.endsWith('.md'));
  return dossierFiles.map(f => parseDossierFile(join(DOSSIER_DIR, f)));
}
```

### Cache Invalidation

Cache is invalidated when:
1. Manual `ParseHeroes.ts` run
2. Dossier file modification detected (mtime check)
3. Explicit `--refresh` flag on briefing

---

## Testing Strategy

### 1. Unit Tests

**HeroDossierParser.test.ts:**
```typescript
describe('HeroDossierParser', () => {
  it('parses Marcus Aurelius dossier correctly', () => {
    const card = parseDossierFile(MARCUS_PATH);
    expect(card.id).toBe('marcus-aurelius');
    expect(card.quotes.length).toBeGreaterThan(0);
    expect(card.quotes.every(q => q.verified)).toBe(true);
  });

  it('extracts only verified quotes', () => {
    const card = parseDossierFile(MARCUS_PATH);
    // Marcus has some unverified quotes marked with notes
    expect(card.quotes).not.toContain(
      expect.objectContaining({ text: expect.stringContaining('exact citation unverified') })
    );
  });

  it('parses context tags from HeroCard section', () => {
    const card = parseDossierFile(MARCUS_PATH);
    expect(card.contextTags).toContain('low_recovery');
    expect(card.contextTags).toContain('adversity');
  });
});
```

**HeroSelector.test.ts:**
```typescript
describe('HeroSelector', () => {
  const heroes = loadTestHeroes();

  it('selects Stoics for low recovery', () => {
    const context: DailyContext = {
      recoveryScore: 45,
      sleepScore: 55,
      hasWorkout: false,
      dayOfWeek: 'Wednesday',
      userState: 'low_recovery'
    };

    const selected = selectHeroForContext(context, heroes);
    expect(['marcus-aurelius', 'seneca', 'andrew-huberman']).toContain(selected.id);
  });

  it('selects intensity heroes for high performance', () => {
    const context: DailyContext = {
      recoveryScore: 90,
      sleepScore: 85,
      hasWorkout: true,
      workoutIntensity: 'hard',
      dayOfWeek: 'Monday',
      userState: 'high_performance'
    };

    const selected = selectHeroForContext(context, heroes);
    expect(['david-goggins', 'jocko-willink', 'eliud-kipchoge']).toContain(selected.id);
  });
});
```

### 2. Integration Tests

```typescript
describe('Hero Integration', () => {
  it('generates complete insight from dossier', () => {
    const context = buildTestContext({ recoveryScore: 75, hasWorkout: true });
    const insight = getHeroInsight(context);

    expect(insight).toBeDefined();
    expect(insight.quote.verified).toBe(true);
    expect(insight.quote.source).toBeTruthy();
  });

  it('formats correctly for Telegram', () => {
    const insight = getHeroInsight(buildTestContext());
    const formatted = formatHeroInsightForTelegram(insight);

    expect(formatted).toContain('<b>HERO INSIGHT</b>');
    expect(formatted).toContain(insight.hero.name);
    expect(formatted).not.toContain('undefined');
  });
});
```

### 3. Regression Tests

```typescript
describe('Quote Verification', () => {
  it('all heroes have at least 3 verified quotes', () => {
    const heroes = loadAllHeroes();

    for (const hero of heroes) {
      expect(hero.quotes.length).toBeGreaterThanOrEqual(3);
      expect(hero.quotes.every(q => q.verified)).toBe(true);
    }
  });
});
```

---

## Future Extensibility

### Adding a New Hero

1. **Create Dossier:** Write full 11-section dossier + HeroCard
   ```
   Data/HeroDossiers/NewHero.md
   ```

2. **Ensure Context Tags:** Include appropriate tags in Section B
   ```markdown
   ### Context Tags

   `low_recovery`, `rest_day`, `any`
   ```

3. **Verify Quotes:** Only include quotes in Section 10 that are verified
   ```markdown
   ### 10. Quote Bank (Verified Only)

   1. **"Quote text"** - Source with page/verse number
   ```

4. **Regenerate Cache:**
   ```bash
   bun run ParseHeroes.ts
   ```

5. **Test:**
   ```bash
   bun test HeroDossierParser
   ```

### Future Enhancements

| Enhancement | Effort | Value |
|-------------|--------|-------|
| User hero preferences (favorites) | Medium | High |
| Hero rotation memory (avoid repeats) | Low | Medium |
| Context learning (track what resonates) | High | High |
| Custom hero creation workflow | Medium | Low |
| Multi-hero insights (council mode) | High | Medium |

---

## Implementation Phases

### Phase 1: Parser Module (1-2 hours)
- [ ] Create `HeroDossierParser.ts`
- [ ] Implement section detection
- [ ] Implement quote extraction with verification
- [ ] Implement context tag extraction
- [ ] Add unit tests

### Phase 2: Refactor HeroInsight.ts (1 hour)
- [ ] Remove hardcoded hero data
- [ ] Import parser module
- [ ] Update `loadHeroes()` to use parsed JSON
- [ ] Ensure backward compatibility

### Phase 3: Enhanced Selection (1 hour)
- [ ] Extract selector to `HeroSelector.ts`
- [ ] Implement enhanced scoring algorithm
- [ ] Add user state derivation
- [ ] Add selection tests

### Phase 4: Cache & CLI (30 min)
- [ ] Create `ParseHeroes.ts` CLI
- [ ] Implement cache read/write
- [ ] Add mtime-based cache invalidation

### Phase 5: Integration Testing (1 hour)
- [ ] Test with real briefing run
- [ ] Verify Telegram formatting
- [ ] Test all 7 heroes
- [ ] Performance benchmarking

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Dossier format changes break parser | Medium | High | Schema validation, versioned format |
| No verified quotes for edge cases | Low | Medium | Fallback to generic wisdom |
| Performance regression from parsing | Low | Low | Pre-parsed JSON cache |
| Context scoring produces poor matches | Medium | Medium | Weighted randomness, testing |
| Quote attribution disputes | Low | Low | Conservative "verified" standard |

---

## Appendix: Sample Parsed Hero JSON

```json
{
  "id": "marcus-aurelius",
  "name": "Marcus Aurelius",
  "era": "121-180 CE",
  "domain": "philosophy",
  "coreThesis": "True power lies in mastering your mind, not controlling external events. The only genuine good is virtue; everything else is indifferent.",
  "operatingPrinciples": [
    "Distinguish what you control from what you don't. Invest energy only in your control.",
    "Transform obstacles into opportunities. Every impediment is raw material for virtue.",
    "Practice memento mori: remember you will die. This clarifies what matters."
  ],
  "decisionFilters": [
    {
      "name": "The Control Test",
      "description": "Is this within my control? If no, release. If yes, what's the virtuous response?"
    },
    {
      "name": "The Death Question",
      "description": "If I died tonight, would this matter? Would I regret spending time on this?"
    }
  ],
  "failureModes": [
    "Philosophical talk without philosophical action",
    "Anger at difficult people - forgetting they act from ignorance",
    "Attachment to outcomes - seeking control over externals"
  ],
  "signatureTactics": [
    "Morning preparation ritual - rehearse the day's likely challenges",
    "Evening review - reflect on actions and judgments",
    "Obstacle reframe - ask: How does this reveal the way forward?"
  ],
  "contextTags": ["low_recovery", "monday", "adversity", "difficult_people", "stress", "any"],
  "oneLiner": "Control what you can (your mind), accept what you can't (everything else), and remember - you'll be dead soon, so waste no time on trivialities.",
  "quotes": [
    {
      "text": "The impediment to action advances action. What stands in the way becomes the way.",
      "source": "Meditations 5.20",
      "verified": true
    },
    {
      "text": "Waste no more time arguing about what a good man should be. Be one.",
      "source": "Meditations 10.16",
      "verified": true
    }
  ]
}
```

---

*Architecture Document Version 1.0*
*Created: 2026-01-28*
*Author: Architect Agent (PAI System)*
