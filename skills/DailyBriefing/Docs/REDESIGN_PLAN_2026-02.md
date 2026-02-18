# DailyBriefingBot Redesign Plan - February 2026

**Created:** 2026-02-12
**Status:** Plan Mode - Ready for Review
**Owner:** Max

---

## Executive Summary

Comprehensive redesign of the DailyBriefingBot to address critical issues and add new capabilities:

1. **Dynamic AI News** - Replace static 5-week-old content with fresh daily fetching
2. **Enhanced TELOS** - Progress tracking with next actions, not just goal titles
3. **Reliable Calendar** - Fix Google OAuth issues, improve integration
4. **Sunday Planning** - New weekly workout planning feature
5. **Critical Fixes** - Strava authentication and Garmin sync timeouts

**Impact:** Transform morning briefing from stale/unreliable to fresh/actionable daily intelligence.

---

## Current State Analysis

### What's Working
- ✅ Wake-triggered delivery (15 min after Garmin detects wake)
- ✅ Health metrics integration (Garmin sleep, HRV, recovery)
- ✅ Hero dossier system (context-aware wisdom)
- ✅ State management (prevents duplicates)
- ✅ Telegram delivery infrastructure

### What's Broken
- ❌ **AI News:** Static for 5 weeks, same content every day
- ❌ **TELOS:** Shows only 3 goal titles, no progress/context
- ❌ **Calendar:** Google OAuth tokens expired, no events showing
- ❌ **Strava:** 100% failure rate (STRAVA_CLIENT_SECRET missing)
- ❌ **Garmin:** 30% timeout failures (60s limit too aggressive)

### What's Missing
- ⚠️ **Weekly Planning:** No Sunday workout planning feature
- ⚠️ **Data Freshness:** No indicators when data is stale
- ⚠️ **Health Alerts:** Sync failures not alerting

---

## Component 1: Dynamic AI News System

### Problem
- `FetchAINews.ts` is a hardcoded static list
- Same 5 stories for past 5 weeks
- No links to original sources
- No freshness tracking

### Solution Architecture

**Multi-Source Free News Aggregation:**

| Source | API | Cost | Update Frequency |
|--------|-----|------|------------------|
| Hacker News | Algolia API | Free | Real-time |
| Reddit r/machinelearning | RSS | Free | Hourly |
| ArXiv AI Papers | RSS | Free | Daily |

**Scoring Algorithm (100 points max):**
- Recency: 30 pts (last 24h = max)
- Source Authority: 25 pts (ArXiv > HN > Reddit)
- Engagement: 25 pts (upvotes, comments)
- AI Relevance: 20 pts (keyword matching)

**Caching Strategy:**
- 12-hour cache TTL (fetch at 3 AM, valid until 3 PM)
- 7-day history retention for trends
- Graceful degradation: Cache → Static fallback → "News unavailable"

**Implementation:**
```
Tools/DynamicAINews/
├── types.ts                  # NewsItem, ScoredArticle interfaces
├── cache-manager.ts          # 12h TTL cache with persistence
├── sources/
│   ├── hackernews-fetcher.ts # Algolia API client
│   ├── reddit-fetcher.ts     # RSS parser
│   └── arxiv-fetcher.ts      # ArXiv RSS parser
├── scoring-engine.ts         # 4-factor ranking algorithm
└── index.ts                  # Main orchestrator
```

**Message Format:**
```html
<b>AI NEWS (Last 24h)</b>
1. <b>Claude 3.5 leads coding benchmarks</b>
   Anthropic's latest maintains top position...
   → https://news.ycombinator.com/item?id=123

2. <b>OpenAI reduces GPT-4 Turbo pricing</b>
   40% cost reduction announced...
   → https://openai.com/blog/...
```

**Zero cost, 100% free APIs.**

---

## Component 2: Enhanced TELOS Integration

### Problem
- Shows only goal titles: "G0: Increase income in 2026"
- No progress indicators
- No active challenges
- No next actions

### Solution Architecture

**Data Extraction:**

Parse TELOS markdown files for:
- **GOALS.md:** Checkbox progress, status, target dates
- **CHALLENGES.md:** Active blockers with status
- **PROJECTS.md:** Next actions, blockers

**Progress Parsing:**
```typescript
interface GoalProgress {
  id: string;              // "G0"
  title: string;           // "Increase Income"
  progressPercent: number; // 40%
  completedTasks: number;  // 2
  totalTasks: number;      // 5
  nextAction: string;      // "Negotiate raise"
  status: string;          // "Active" | "Almost Complete"
}
```

**Message Format:**
```html
<b>LIFE TRAJECTORY</b>
G0: Income Growth [##____] 40% (2/5)
   → Negotiate raise based on value
G5: Probation [######_] 95% | ~1 week
   → Complete final week [WIN INCOMING]

<b>CHALLENGES</b>
C0: Building experience [In Progress]

<b>FOCUS TODAY</b>
Take on complex analytical projects
```

**Character count:** ~420 chars (3x current, 10x actionable value)

**Implementation:**
```
Tools/TelosParser.ts
├── parseGoalProgress()      # Extract checkbox completion
├── parseActiveChallenges()  # Surface blockers
├── extractFocusAction()     # Single most important item
└── formatTelosForTelegram() # ASCII progress bars
```

---

## Component 3: Reliable Calendar Integration

### Problem
- Google OAuth tokens expired
- Error: `invalid_grant: Token has been expired or revoked`
- Calendar events not showing in briefing

### Root Cause
OAuth app likely in "Testing" mode = tokens expire every 7 days

### Solution Options

**Option A: Re-authenticate gcalcli (Immediate)**
```bash
gcalcli init  # Re-auth via browser
```
**Pros:** Works immediately
**Cons:** Will expire again in 7 days if app in testing mode

**Option B: Migrate to Google Calendar API (Recommended)**
- TypeScript-native (aligns with stack)
- Full token refresh control
- Better error messages
- Health check before briefing

**Implementation (Option B):**
```
Tools/calendar-client.ts
├── checkCalendarHealth()    # Detect auth issues early
├── refreshTokenIfNeeded()   # Auto-refresh before expiry
├── getTodaysEvents()        # Fetch with retry logic
└── formatEventsForTelegram()
```

**Enhanced Error Handling:**
- "Calendar needs re-auth" (actionable)
- "Token expires in 2 days" (proactive warning)
- Fallback to cached last-known calendar

**Immediate Action Required:**
You need to run `gcalcli init` to re-authenticate before morning briefing will show calendar events again.

---

## Component 4: Sunday Weekly Workout Planning

### Problem
- No proactive weekly planning
- Daily prescriptions are reactive only
- Manual planning every week is tedious

### Solution Architecture

**Hybrid Planning System:**
- Weekly plan = "Guidance" (sets intention)
- Daily prescription = "Execution" (ensures safety)
- Daily always has override authority based on recovery

**Data Inputs (Previous Week):**
- Completed vs prescribed workouts (adherence)
- Average recovery score trend
- Training load and ACWR
- Wellness feedback patterns

**Planning Algorithm:**
```
1. Gather previous week data
2. Calculate constraints (ACWR limits, rest requirements)
3. Generate plan skeleton (rule-based)
4. Enrich with AI rationale (Claude explains "why")
5. Validate safety (never exceed ACWR 1.3, min 1 rest day)
```

**Database Schema (Extend Existing):**
```sql
-- New table
CREATE TABLE planning_metadata (
  id INTEGER PRIMARY KEY,
  week_start TEXT,           -- Monday of planned week
  prev_week_compliance REAL, -- 87%
  acwr_at_planning REAL,     -- 1.05
  planning_rationale TEXT,   -- Claude's reasoning
  ...
);

-- Extend workout_prescriptions
ALTER TABLE workout_prescriptions
  ADD COLUMN week_plan_id INTEGER REFERENCES planning_metadata(id);
ALTER TABLE workout_prescriptions
  ADD COLUMN daily_override_reason TEXT;  -- Why daily differed from plan
```

**Message Format (Sunday only):**
```html
<b>WEEKLY PLAN | Feb 17-23</b>
<i>Week 4 of 8 | Build Phase</i>

<b>LAST WEEK</b>
Completed: 5/6 | Compliance: 87%
Recovery: stable | Avg HRV: 52ms

<b>THIS WEEK</b>
Target load: 450 (+7%)

<code>
Mon: Rest Day
Tue: Easy Run 30min (Z2)
Wed: Tempo Run 45min (Z3-4)
Thu: Recovery Yoga 30min
Fri: Easy Run 35min (Z2)
Sat: Long Run 70min (Z2)
Sun: Rest Day
</code>

<b>KEY SESSIONS</b>
Wed: 3x10min tempo @ 6:15/km
Sat: Build to 8 miles

<b>SAFETY</b>
ACWR: 1.05 (optimal)
2 rest days planned
```

**Daily Integration:**
- Monday: Shows "Executing weekly plan: Rest Day"
- If recovery drops: "Adapted from plan: Easy run → Walk (recovery: 58)"
- Tracks adherence for next week's planning

**Implementation:**
```
Tools/weekly-planner.ts
├── getPreviousWeekSummary()     # SQL query last 7 days
├── calculateWeeklyConstraints() # ACWR, rest requirements
├── generatePlanSkeleton()       # Rule-based structure
├── enrichPlanWithAI()           # Claude writes rationale
└── validateAndAdjustPlan()      # Final safety check

prescription-engine.ts (modified)
├── getWeeklyPlanPrescription()  # Check if plan exists
├── evaluateWeeklyPlanVsRecovery() # Can execute as planned?
└── generateSaferAlternative()   # Override if needed
```

---

## Component 5: Critical Sync Fixes

### Problem 1: Strava Authentication (100% Failure)

**Root Cause:**
- `STRAVA_CLIENT_SECRET` environment variable not set
- LaunchAgents don't inherit shell env vars
- Unlike Garmin (Keychain), Strava uses env vars

**Fix:**
Migrate Strava to macOS Keychain (matches Garmin pattern)

```bash
# Store credentials
security add-generic-password \
  -a "strava-client-secret" \
  -s "com.pai.fitness" \
  -w "YOUR_SECRET"
```

Update `config.ts`:
```typescript
strava: {
  clientSecret: getKeychainPassword("strava-client-secret", "com.pai.fitness") ||
                process.env.STRAVA_CLIENT_SECRET,
}
```

### Problem 2: Garmin Sync Timeouts (30% Failure)

**Root Cause:**
- 60-second timeout too aggressive
- Garmin API: 100 activities + 7 days of metrics = can exceed 60s

**Fix:**
- Increase timeout to 180 seconds
- Add retry logic with exponential backoff

```typescript
timeout: 180000, // 3 minutes

// Add retry with backoff
private async withRetry(syncFn, maxRetries = 3, baseDelay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const success = syncFn();
    if (success) return { success: true, attempts: attempt };

    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  return { success: false, attempts: maxRetries };
}
```

### Problem 3: Flawed Success Metrics

**Root Cause:**
```typescript
const success = garminSuccess || stravaSuccess;  // WRONG
```
Marks sync "successful" if EITHER works, masking Strava's 100% failure.

**Fix:**
```typescript
const success = garminSuccess && stravaSuccess;  // BOTH required
const partialSuccess = garminSuccess || stravaSuccess;

// Track per-source
interface SyncState {
  garminSuccessCount: number;
  stravaSuccessCount: number;
  consecutiveGarminFailures: number;
  consecutiveStravaFailures: number;
}
```

### Problem 4: No Per-Source Alerts

**Root Cause:**
- Health monitor tracks overall success only
- No alerts when specific source fails repeatedly

**Fix:**
```typescript
// Alert on 3 consecutive failures per source
if (consecutiveStravaFailures >= 3) {
  sendTelegramAlert(
    "🚨 CRITICAL: Strava Sync Failing\n" +
    "3+ consecutive failures\n" +
    "Action: Check Strava credentials (Keychain)"
  );
}
```

---

## Integration Architecture

### How Components Work Together

```
┌─────────────────────────────────────────────────────────┐
│ SUNDAY SPECIAL FLOW                                     │
│                                                          │
│ 1. Wake-triggered (normal)                              │
│ 2. Detect isSunday()                                    │
│ 3. Generate weekly workout plan                         │
│ 4. Append to regular briefing                           │
└─────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────┐
│ DAILY BRIEFING FLOW (All Days)                          │
│                                                          │
│ 1. Sync daemon (every 20 min) ──→ Garmin + Strava data │
│ 2. Wake detected ──→ Trigger briefing                   │
│ 3. Fetch components in parallel:                        │
│    - Dynamic AI News (cache-first)                      │
│    - Enhanced TELOS (parse GOALS.md)                    │
│    - Calendar events (OAuth check first)                │
│    - Today's workout (check weekly plan)                │
│    - Hero insight (context-aware)                       │
│ 4. Format message                                       │
│ 5. Send via Telegram                                    │
│ 6. Update state                                         │
└─────────────────────────────────────────────────────────┘
```

### Data Flow Dependencies

```
Sync Daemon (20 min interval)
  ↓
[Garmin + Strava] → fitness/workouts.db
  ↓
Morning Briefing (wake-triggered)
  ├─ AI News ← [HackerNews, Reddit, ArXiv]
  ├─ TELOS ← [GOALS.md, CHALLENGES.md]
  ├─ Calendar ← [Google Calendar API]
  ├─ Workout ← [workouts.db + weekly_plan if Sunday]
  └─ Hero ← [HeroDossiers]
  ↓
Telegram Message → MaxsDailyBreifBot → Max
```

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
**Priority: URGENT - Unblocks everything**

| Task | Time | Owner | Dependency |
|------|------|-------|------------|
| 1.1 Strava Keychain migration | 30 min | Implementation | None |
| 1.2 Garmin timeout increase | 15 min | Implementation | None |
| 1.3 Fix success metrics (AND logic) | 30 min | Implementation | None |
| 1.4 Per-source health alerts | 45 min | Implementation | 1.3 |
| 1.5 Calendar re-auth (gcalcli init) | 5 min | **MAX** | None |

**Deliverable:** Strava working, Garmin reliable, calendar showing events

---

### Phase 2: Dynamic AI News (Week 1-2)
**Priority: HIGH - Most visible improvement**

| Task | Time | Owner | Dependency |
|------|------|-------|------------|
| 2.1 Create types.ts, cache-manager.ts | 2h | Implementation | None |
| 2.2 HackerNews fetcher | 3h | Implementation | 2.1 |
| 2.3 Reddit fetcher | 2h | Implementation | 2.1 |
| 2.4 Scoring engine | 3h | Implementation | 2.2, 2.3 |
| 2.5 Integration with briefing.ts | 1h | Implementation | 2.4 |
| 2.6 Testing + cache validation | 2h | Implementation | 2.5 |

**Deliverable:** Fresh AI news daily with top 5 + links

---

### Phase 3: Enhanced TELOS (Week 2)
**Priority: MEDIUM - Quality of life improvement**

| Task | Time | Owner | Dependency |
|------|------|-------|------------|
| 3.1 TelosParser.ts core | 4h | Implementation | None |
| 3.2 Progress bar formatter | 1h | Implementation | 3.1 |
| 3.3 Challenge parser | 2h | Implementation | 3.1 |
| 3.4 Focus extraction | 2h | Implementation | 3.1 |
| 3.5 Integration with briefing.ts | 1h | Implementation | 3.4 |
| 3.6 Testing with real TELOS files | 1h | Implementation | 3.5 |

**Deliverable:** TELOS section shows progress, challenges, next actions

---

### Phase 4: Calendar Migration (Week 2-3)
**Priority: MEDIUM - Long-term reliability**

| Task | Time | Owner | Dependency |
|------|------|-------|------------|
| 4.1 Google Cloud OAuth app setup | 1h | **MAX** | None |
| 4.2 calendar-client.ts skeleton | 2h | Implementation | 4.1 |
| 4.3 Token management + Keychain | 3h | Implementation | 4.2 |
| 4.4 Event fetching with retry | 2h | Implementation | 4.2 |
| 4.5 Health check integration | 2h | Implementation | 4.3 |
| 4.6 Integration with briefing.ts | 1h | Implementation | 4.4, 4.5 |
| 4.7 Deprecate gcalcli fallback | 1h | Implementation | 4.6 |

**Deliverable:** TypeScript-native calendar with auto-refresh

---

### Phase 5: Sunday Weekly Planning (Week 3-4)
**Priority: MEDIUM-LOW - New feature, not a fix**

| Task | Time | Owner | Dependency |
|------|------|-------|------------|
| 5.1 Database schema migration | 2h | Implementation | None |
| 5.2 weekly-planner.ts core | 6h | Implementation | 5.1 |
| 5.3 Previous week summary SQL | 2h | Implementation | 5.1 |
| 5.4 Constraint calculation | 3h | Implementation | 5.2 |
| 5.5 AI enrichment (Claude rationale) | 3h | Implementation | 5.4 |
| 5.6 Telegram formatter | 2h | Implementation | 5.2 |
| 5.7 Sunday trigger in briefing-on-wake | 1h | Implementation | 5.6 |
| 5.8 Daily prescription integration | 4h | Implementation | 5.2 |
| 5.9 Override tracking | 2h | Implementation | 5.8 |
| 5.10 Testing full Sunday flow | 3h | Implementation | All |

**Deliverable:** Sunday briefings include weekly workout plan

---

## Testing Strategy

### Unit Tests
```typescript
// AI News
describe('DynamicAINews', () => {
  it('fetches from HackerNews Algolia API');
  it('scores articles using 4-factor algorithm');
  it('caches results for 12 hours');
  it('falls back to cache on fetch failure');
});

// TELOS
describe('TelosParser', () => {
  it('parses checkbox progress from GOALS.md');
  it('calculates completion percentage');
  it('extracts next action from first unchecked item');
  it('handles empty/malformed files gracefully');
});

// Weekly Planner
describe('WeeklyPlanner', () => {
  it('respects ACWR constraints');
  it('never schedules back-to-back hard workouts');
  it('includes minimum 1 rest day');
  it('generates 7 prescriptions for Mon-Sun');
});

// Sync Fixes
describe('SyncCoordinator', () => {
  it('retries Garmin sync up to 3 times');
  it('marks success only when BOTH sources work');
  it('tracks per-source failure counts');
});
```

### Integration Tests
```bash
# AI News end-to-end
bun test Tools/DynamicAINews/index.test.ts

# TELOS with real files
bun test Tools/TelosParser.test.ts

# Full briefing generation
bun run briefing.ts --test --dry-run

# Sunday flow
bun run briefing.ts --test --force-sunday
```

### Manual Testing
- [ ] Run morning briefing, verify all sections present
- [ ] Check Telegram formatting on mobile device
- [ ] Verify links in AI News are clickable
- [ ] Confirm TELOS progress bars render correctly
- [ ] Test Sunday weekly plan message length < 4096 chars
- [ ] Verify calendar events show after re-auth
- [ ] Monitor sync logs for Strava/Garmin success

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| AI news APIs change/break | Medium | Medium | Multi-source + static fallback |
| Calendar re-auth expires again | High | Low | Migrate to API with auto-refresh |
| Weekly plan too aggressive | Medium | High | Daily prescription always has veto |
| Strava Keychain access fails | Low | High | Keep env var as fallback |
| Message too long for Telegram | Low | Low | 4096 char limit enforced, tested |
| TELOS parsing breaks on format change | Medium | Medium | Defensive parsing, graceful degradation |

---

## Success Metrics

### Phase 1 (Critical Fixes)
- ✅ Strava sync: 0 failures in 24 hours
- ✅ Garmin sync: <5% timeout rate
- ✅ Calendar events: Show in briefing every morning
- ✅ Health alerts: Fire within 1 hour of 3rd consecutive failure

### Phase 2 (AI News)
- ✅ News updates daily (verify timestamps)
- ✅ Top 5 articles from last 24h
- ✅ All links clickable and relevant
- ✅ Cache prevents redundant fetches

### Phase 3 (TELOS)
- ✅ Progress bars show for all active goals
- ✅ Next action extracted and displayed
- ✅ Active challenges surface with status
- ✅ Message <500 chars (mobile-friendly)

### Phase 4 (Calendar)
- ✅ Events show every morning without re-auth
- ✅ Token auto-refreshes before expiry
- ✅ Health check warns 2 days before expiry

### Phase 5 (Weekly Planning)
- ✅ Sunday briefing includes 7-day plan
- ✅ Weekly plan respects ACWR limits
- ✅ Daily prescription can override when needed
- ✅ Override reason tracked and logged

---

## Rollback Plan

If any phase causes issues:

**Phase 1 (Sync Fixes):**
- Revert to env var for Strava (add to plist)
- Revert timeout to 60s
- Revert to OR logic for success

**Phase 2 (AI News):**
- Revert to static FetchAINews.ts
- Remove dynamic fetcher imports

**Phase 3 (TELOS):**
- Revert to title-only display
- Remove TelosParser.ts calls

**Phase 4 (Calendar):**
- Keep gcalcli, disable googleapis
- Manual re-auth every 7 days

**Phase 5 (Weekly Planning):**
- Disable Sunday trigger
- Daily prescriptions work independently

---

## Next Steps

### Immediate (Today)
1. **Max:** Run `gcalcli init` to restore calendar access
2. **Review:** Review this plan, approve/modify phases
3. **Prioritize:** Confirm Phase 1 is the starting point

### Phase 1 Kickoff (This Week)
1. Store Strava credentials in Keychain
2. Update config.ts for Keychain retrieval
3. Increase Garmin timeout to 180s
4. Add retry logic with exponential backoff
5. Fix success metrics (AND logic)
6. Add per-source health alerts
7. Test full sync cycle

### Weekly Checkpoints
- Monday: Review previous week's implementation
- Wednesday: Mid-week progress check
- Friday: Phase completion review, plan next phase

---

## Questions for Max

Before starting implementation, please confirm:

1. **Priority:** Is Phase 1 (Critical Fixes) → Phase 2 (AI News) the right order?
2. **Calendar:** Should I implement the full googleapis migration (Phase 4) or just re-auth gcalcli for now?
3. **Weekly Planning:** Do you want this feature in the first release or can it wait?
4. **AI News Sources:** HackerNews + Reddit sufficient, or add more sources?
5. **Testing:** Should I implement unit tests during development or after all features complete?

---

**Status:** Ready for review and approval
**Next Action:** Max reviews plan, provides feedback, approves Phase 1 start
