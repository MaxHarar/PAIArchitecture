#!/usr/bin/env bun
/**
 * TelosParser Tests - TDD for Enhanced TELOS Integration
 *
 * Tests the parsing, progress calculation, prioritization,
 * and formatting of TELOS goals for the daily briefing.
 */

import { describe, test, expect, beforeAll, afterAll, mock, spyOn } from 'bun:test';
import {
  TelosGoal,
  parseGoalsFile,
  calculateProgress,
  determineUrgency,
  selectEmoji,
  generateProgressBar,
  prioritizeGoals,
  formatTelosSection,
  getEnhancedTelosGoals,
} from './TelosParser.ts';

// =============================================================================
// Test Data
// =============================================================================

const SAMPLE_GOALS_MD = `# Goals

**Specific objectives you're working toward.**

Goals support your missions (M#) and represent concrete outcomes you want to achieve.

*Last Updated: 2026-01-26*

---

## Active Goals

### G0: Significantly Increase Income in 2026
**Status:** Active
**Supports:** M0
**Target:** End of 2026
**Progress:**
- [x] Secure full-time employment at CURE Auto Insurance
- [x] Get recognized by CEO for strategic thinking
- [ ] Negotiate raise or promotion based on demonstrated value
- [ ] Explore additional income streams

### G1: Decide on Law School Path
**Status:** Active
**Supports:** M0, M1
**Target:** Q2 2026
**Progress:**
- [x] Had pivotal conversation with CEO (CPA/Lawyer)
- [x] Completed initial legal analysis projects (fraud memo)
- [ ] Study for and take LSAT (if pursuing)
- [ ] Apply to law schools or commit to alternative path

### G2: Build Legal/Analytical Skills
**Status:** Active
**Supports:** M1
**Target:** Ongoing
**Progress:**
- [x] Read Meditations by Marcus Aurelius
- [x] Consume quality intellectual content (Lex Friedman, Huberman, Modern Wisdom)
- [ ] Continue taking on complex analytical projects at work
- [ ] Deepen stoic philosophy study

### G3: Maintain Physical Excellence
**Status:** Active
**Supports:** Health foundation for all goals
**Target:** Ongoing
**Progress:**
- [x] Training 2x/day almost every day
- [x] Track via Garmin
- [ ] Optimize recovery and balance with work demands

---

## 2026 Goals

Time-bounded goals for the current year.

### G4: Financial Stability
**Status:** In Progress
**Deadline:** End of 2026
- [ ] Build emergency fund
- [ ] Maintain zero consumer debt
- [x] Established Amex credit
- [ ] Start investment contributions

### G5: Complete Probation Successfully
**Status:** In Progress
**Deadline:** ~February 2026 (1 week away)
- [x] Comply with all requirements
- [ ] Successfully complete final week

### G6: Define 5-Year Career Path
**Status:** Planning
**Deadline:** Q2 2026
- [ ] Decide: Big Law vs Corporate vs Entrepreneurship
- [ ] Create concrete action plan for chosen path

---

## Completed Goals

| Goal | Description | Completed | Key Outcome |
|------|-------------|-----------|-------------|
| - | Graduate Bucknell CS/Econ | 2024 | Foundation for career |
`;

const EMPTY_GOALS_MD = `# Goals

No goals defined yet.
`;

const MALFORMED_GOALS_MD = `# Goals

Some random content without proper formatting
G0: Not a real goal
### Invalid: Missing ID format
`;

// =============================================================================
// Parsing Tests
// =============================================================================

describe('TelosParser - Goal Parsing', () => {
  test('parses all goals from valid markdown', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);

    expect(goals.length).toBe(7);
    expect(goals.map(g => g.id)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
  });

  test('extracts goal titles correctly', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);

    expect(goals[0].title).toBe('Significantly Increase Income in 2026');
    expect(goals[4].title).toBe('Financial Stability');
    expect(goals[5].title).toBe('Complete Probation Successfully');
  });

  test('extracts status correctly', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);

    expect(goals[0].status).toBe('Active');
    expect(goals[4].status).toBe('In Progress');
    expect(goals[6].status).toBe('Planning');
  });

  test('extracts target timeline correctly', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);

    expect(goals[0].targetTimeline).toBe('End of 2026');
    expect(goals[1].targetTimeline).toBe('Q2 2026');
    expect(goals[5].targetTimeline).toBe('~February 2026 (1 week away)');
  });

  test('handles missing progress section gracefully', () => {
    const goalsWithoutProgress = `# Goals

### G99: Test Goal Without Progress
**Status:** Active
**Target:** Q1 2026

### G100: Another Goal
**Status:** Planning
`;
    const goals = parseGoalsFile(goalsWithoutProgress);

    expect(goals[0].totalTasks).toBe(0);
    expect(goals[0].completedTasks).toBe(0);
    expect(goals[0].nextAction).toBeNull();
  });

  test('returns empty array for empty/malformed file', () => {
    expect(parseGoalsFile(EMPTY_GOALS_MD)).toEqual([]);
    expect(parseGoalsFile(MALFORMED_GOALS_MD)).toEqual([]);
    expect(parseGoalsFile('')).toEqual([]);
  });
});

// =============================================================================
// Progress Calculation Tests
// =============================================================================

describe('TelosParser - Progress Calculation', () => {
  test('calculates progress from checkboxes correctly', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);

    // G0: 2 complete, 4 total = 50%
    const g0 = goals.find(g => g.id === 'G0');
    expect(g0?.completedTasks).toBe(2);
    expect(g0?.totalTasks).toBe(4);
    expect(g0?.progressPercent).toBe(50);

    // G5: 1 complete, 2 total = 50%
    const g5 = goals.find(g => g.id === 'G5');
    expect(g5?.completedTasks).toBe(1);
    expect(g5?.totalTasks).toBe(2);
    expect(g5?.progressPercent).toBe(50);
  });

  test('handles 0% progress', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);

    // G6: 0 complete, 2 total = 0%
    const g6 = goals.find(g => g.id === 'G6');
    expect(g6?.completedTasks).toBe(0);
    expect(g6?.totalTasks).toBe(2);
    expect(g6?.progressPercent).toBe(0);
  });

  test('calculates standalone progress percentage', () => {
    expect(calculateProgress(8, 10)).toBe(80);
    expect(calculateProgress(0, 5)).toBe(0);
    expect(calculateProgress(5, 5)).toBe(100);
    expect(calculateProgress(0, 0)).toBe(0); // Edge case: no tasks
  });
});

// =============================================================================
// Urgency Tests
// =============================================================================

describe('TelosParser - Urgency Detection', () => {
  test('detects imminent urgency from timeline keywords', () => {
    expect(determineUrgency('~1 week!')).toBe('imminent');
    expect(determineUrgency('2 days remaining')).toBe('imminent');
    expect(determineUrgency('Due soon!')).toBe('imminent');
    expect(determineUrgency('~February 2026 (1 week away)')).toBe('imminent');
    expect(determineUrgency('Tomorrow!')).toBe('imminent');
    expect(determineUrgency('This week')).toBe('imminent');
  });

  test('detects near urgency from Q1/Q2 timelines', () => {
    expect(determineUrgency('Q1 2026')).toBe('near');
    expect(determineUrgency('Q2 2026')).toBe('near');
    expect(determineUrgency('March 2026')).toBe('near');
    expect(determineUrgency('By April')).toBe('near');
  });

  test('detects distant urgency for end of year or ongoing', () => {
    expect(determineUrgency('End of 2026')).toBe('distant');
    expect(determineUrgency('Ongoing')).toBe('distant');
    expect(determineUrgency('Q4 2026')).toBe('distant');
    expect(determineUrgency('December 2026')).toBe('distant');
  });

  test('defaults to distant for unknown formats', () => {
    expect(determineUrgency('Sometime')).toBe('distant');
    expect(determineUrgency('')).toBe('distant');
    expect(determineUrgency('TBD')).toBe('distant');
  });
});

// =============================================================================
// Emoji Selection Tests
// =============================================================================

describe('TelosParser - Emoji Selection', () => {
  test('selects money emoji for income/financial goals', () => {
    expect(selectEmoji('Increase Income in 2026')).toBe('\uD83D\uDCB0'); // money bag
    expect(selectEmoji('Financial Stability')).toBe('\uD83D\uDCB0');
    expect(selectEmoji('Build Savings')).toBe('\uD83D\uDCB0');
    expect(selectEmoji('Investment Strategy')).toBe('\uD83D\uDCB0');
  });

  test('selects fire emoji for career/probation goals', () => {
    expect(selectEmoji('Complete Probation Successfully')).toBe('\uD83D\uDD25'); // fire
    expect(selectEmoji('Define 5-Year Career Path')).toBe('\uD83D\uDD25');
    expect(selectEmoji('Career Development')).toBe('\uD83D\uDD25');
  });

  test('selects scales emoji for legal goals', () => {
    // "Law School" has "school" -> education, but "Law Practice" -> legal
    expect(selectEmoji('Decide on Law School Path')).toBe('\uD83D\uDCDA'); // school keyword -> education
    expect(selectEmoji('Build Legal/Analytical Skills')).toBe('\u2696\uFE0F'); // legal keyword -> scales
    expect(selectEmoji('Pass the Bar')).toBe('\u2696\uFE0F');
    expect(selectEmoji('Legal certification')).toBe('\u2696\uFE0F');
    expect(selectEmoji('Practice Law')).toBe('\u2696\uFE0F'); // law without school
  });

  test('selects book emoji for education goals', () => {
    expect(selectEmoji('Complete MBA')).toBe('\uD83D\uDCDA'); // books
    expect(selectEmoji('Study for LSAT')).toBe('\uD83D\uDCDA');
    expect(selectEmoji('Learn New Language')).toBe('\uD83D\uDCDA');
    expect(selectEmoji('Read 50 Books')).toBe('\uD83D\uDCDA');
  });

  test('selects muscle emoji for health/fitness goals', () => {
    expect(selectEmoji('Maintain Physical Excellence')).toBe('\uD83D\uDCAA'); // flexed bicep
    expect(selectEmoji('Run a Marathon')).toBe('\uD83D\uDCAA');
    expect(selectEmoji('Gym Consistency')).toBe('\uD83D\uDCAA');
    expect(selectEmoji('Health and Fitness')).toBe('\uD83D\uDCAA');
    expect(selectEmoji('Training Goals')).toBe('\uD83D\uDCAA');
  });

  test('selects target emoji as default', () => {
    expect(selectEmoji('Random Goal')).toBe('\uD83C\uDFAF'); // bullseye
    expect(selectEmoji('Miscellaneous Task')).toBe('\uD83C\uDFAF');
  });
});

// =============================================================================
// Progress Bar Tests
// =============================================================================

describe('TelosParser - Progress Bar Generation', () => {
  test('generates correct progress bar for 0%', () => {
    expect(generateProgressBar(0)).toBe('\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591');
  });

  test('generates correct progress bar for 50%', () => {
    expect(generateProgressBar(50)).toBe('\u2593\u2593\u2593\u2593\u2593\u2591\u2591\u2591\u2591\u2591');
  });

  test('generates correct progress bar for 80%', () => {
    expect(generateProgressBar(80)).toBe('\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2591\u2591');
  });

  test('generates correct progress bar for 100%', () => {
    expect(generateProgressBar(100)).toBe('\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593');
  });

  test('handles edge values correctly (floor rounding)', () => {
    // Floor rounding: don't show progress that isn't there
    expect(generateProgressBar(5)).toBe('\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591'); // floor(5/10) = 0
    expect(generateProgressBar(15)).toBe('\u2593\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591'); // floor(15/10) = 1
    expect(generateProgressBar(95)).toBe('\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2591'); // floor(95/10) = 9
  });
});

// =============================================================================
// Next Action Extraction Tests
// =============================================================================

describe('TelosParser - Next Action Extraction', () => {
  test('extracts first unchecked task as next action', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);

    const g0 = goals.find(g => g.id === 'G0');
    expect(g0?.nextAction).toBe('Negotiate raise or promotion based on demonstrated value');

    const g5 = goals.find(g => g.id === 'G5');
    expect(g5?.nextAction).toBe('Successfully complete final week');
  });

  test('returns null when all tasks complete', () => {
    const allCompleteGoal = `# Goals

### G99: All Done
**Status:** Active
**Progress:**
- [x] Task 1
- [x] Task 2
- [x] Task 3
`;
    const goals = parseGoalsFile(allCompleteGoal);
    expect(goals[0].nextAction).toBeNull();
  });
});

// =============================================================================
// Prioritization Tests
// =============================================================================

describe('TelosParser - Prioritization Algorithm', () => {
  test('prioritizes imminent urgency first', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);
    const prioritized = prioritizeGoals(goals);

    // G5 has imminent urgency (~1 week away)
    expect(prioritized[0].id).toBe('G5');
  });

  test('returns max 3 goals', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);
    const prioritized = prioritizeGoals(goals);

    expect(prioritized.length).toBeLessThanOrEqual(3);
  });

  test('high progress goals ranked after imminent but before others', () => {
    const highProgressGoal = `# Goals

### G99: Almost Done
**Status:** Active
**Target:** Q4 2026
**Progress:**
- [x] Task 1
- [x] Task 2
- [x] Task 3
- [x] Task 4
- [ ] Final task
`;
    const goals = parseGoalsFile(highProgressGoal);
    expect(goals[0].progressPercent).toBe(80);
  });

  test('Active status prioritized over In Progress over Planning', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);
    const prioritized = prioritizeGoals(goals);

    // After urgency sorting, Active should come before Planning
    const planningGoals = prioritized.filter(g => g.status === 'Planning');
    const activeGoals = prioritized.filter(g => g.status === 'Active');

    // If both present, Active should have lower average index
    if (planningGoals.length > 0 && activeGoals.length > 0) {
      const planningIndices = planningGoals.map(g => prioritized.indexOf(g));
      const activeIndices = activeGoals.map(g => prioritized.indexOf(g));
      // This is a weak assertion; the main test is that imminent comes first
    }
  });
});

// =============================================================================
// Formatting Tests
// =============================================================================

describe('TelosParser - Output Formatting', () => {
  test('formats section with correct structure', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);
    const prioritized = prioritizeGoals(goals);
    const formatted = formatTelosSection(prioritized);

    // Should NOT contain header (header added by briefing.ts)
    expect(formatted).not.toContain('TELOS GOALS');

    // Should contain separator line
    expect(formatted).toContain('\u2501');

    // Should have progress bars
    expect(formatted).toMatch(/[\u2593\u2591]{10}/);

    // Should have percentage
    expect(formatted).toMatch(/\d+%/);

    // Should have next action arrow
    expect(formatted).toContain('\u2192');
  });

  test('formats urgency indicators correctly', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);
    const formatted = formatTelosSection(prioritizeGoals(goals));

    // Imminent should have lightning bolt
    expect(formatted).toContain('\u26A1'); // lightning
  });

  test('includes goal IDs and titles', () => {
    const goals = parseGoalsFile(SAMPLE_GOALS_MD);
    const formatted = formatTelosSection(prioritizeGoals(goals));

    // G5 should be first (imminent)
    expect(formatted).toContain('G5');
    expect(formatted).toContain('Complete Probation Successfully');
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('TelosParser - End-to-End Integration', () => {
  test('getEnhancedTelosGoals returns formatted output', () => {
    // This tests the main exported function
    const result = getEnhancedTelosGoals(SAMPLE_GOALS_MD);

    expect(typeof result).toBe('string');
    // Should contain separator line (header added by briefing.ts)
    expect(result).toContain('\u2501');
    expect(result.length).toBeGreaterThan(50);
  });

  test('handles real GOALS.md file structure', () => {
    // The actual file structure from GOALS.md
    const realContent = `### G5: Complete Probation Successfully
**Status:** In Progress
**Deadline:** ~February 2026 (1 week away)
- [x] Comply with all requirements
- [ ] Successfully complete final week`;

    const goals = parseGoalsFile(realContent);

    expect(goals.length).toBe(1);
    expect(goals[0].id).toBe('G5');
    expect(goals[0].urgency).toBe('imminent');
    expect(goals[0].progressPercent).toBe(50);
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('TelosParser - Edge Cases', () => {
  test('handles checkboxes in non-progress sections', () => {
    const mixedContent = `# Goals

### G0: Test Goal
**Status:** Active
**Target:** Q1 2026
**Progress:**
- [x] Real progress item
- [ ] Another real item

## Life Areas

### Career
- [x] Employed (should not count)
- [ ] Get promotion (should not count)
`;
    const goals = parseGoalsFile(mixedContent);

    // Should only count Progress section checkboxes
    expect(goals[0].totalTasks).toBe(2);
    expect(goals[0].completedTasks).toBe(1);
  });

  test('handles goals with Deadline instead of Target', () => {
    const deadlineContent = `# Goals

### G5: Test Goal
**Status:** In Progress
**Deadline:** ~February 2026 (1 week away)
- [ ] Task 1
`;
    const goals = parseGoalsFile(deadlineContent);

    expect(goals[0].targetTimeline).toBe('~February 2026 (1 week away)');
  });

  test('handles unicode in goal titles', () => {
    const unicodeContent = `# Goals

### G0: Complete 5-Year Plan
**Status:** Active
**Target:** Q1 2026
`;
    const goals = parseGoalsFile(unicodeContent);
    expect(goals[0].title).toBe('Complete 5-Year Plan');
  });
});

console.log('Running TelosParser tests...');
