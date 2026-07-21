# Garmin Integration Architecture Analysis

**Date:** 2026-01-28
**Author:** Architect Agent
**Status:** Recommendation Finalized

---

## Executive Summary

This analysis evaluates whether the Daily Briefing and Fitness systems should share unified Garmin polling infrastructure. After deep analysis of both systems, **the recommendation is to keep them separate** with minor optimizations. The systems have fundamentally different polling patterns, data needs, and operational characteristics that make unification add complexity without proportional benefit.

**Key Finding:** The systems are already partially integrated - Daily Briefing uses FitnessCoach's `GarminSync.py` for data fetching. The question is whether polling/scheduling should be unified, and the answer is no.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [System Comparison](#2-system-comparison)
3. [Overlap Identification](#3-overlap-identification)
4. [Unified Architecture Option](#4-unified-architecture-option)
5. [Separate Architecture Option](#5-separate-architecture-option)
6. [Architectural Decision](#6-architectural-decision)
7. [Recommended Optimizations](#7-recommended-optimizations)

---

## 1. Current State Analysis

### 1.1 Daily Briefing System

**Location:** `~/.claude/skills/DailyBriefing/`

**Purpose:** Wake-triggered morning briefing delivered via Telegram

**Garmin Usage:**
```
briefing-on-wake.ts (Daemon)
        |
        | execSync (every 5 min, 6-10 AM)
        v
GarminSync.py --days 7 --output json
        |
        v
Sleep data only: sleepEndTimestampLocal (wake time detection)
```

**Polling Pattern:**
- **Frequency:** Every 5 minutes via launchd
- **Window:** 6 AM - 10 AM only (4 hours)
- **Daily Polls:** 48 max, typically 5-20
- **Purpose:** Detect wake time, trigger briefing

**Data Consumed:**
- `sleep.sleepEndTimestampLocal` - Wake time detection
- Full Garmin data passed to `briefing.ts` for health summary

**Architecture:**
```
+-------------------+     +-------------------+     +-------------------+
|  launchd daemon   |---->| briefing-on-wake  |---->|   GarminSync.py   |
| (5 min interval)  |     |      .ts          |     |   (Python)        |
+-------------------+     +-------------------+     +-------------------+
                                   |
                                   v
                          +-------------------+
                          |   briefing.ts     |
                          | (uses fitness DB) |
                          +-------------------+
```

### 1.2 Fitness System

**Location:** `~/.claude/fitness/`

**Purpose:** Comprehensive fitness tracking, workout prescriptions, coaching

**Garmin Usage:**
```
GarminSyncService (TypeScript)
        |
        | garmin-connect npm package
        v
Garmin Connect API
        |
        v
SQLite database (~/.claude/fitness/workouts.db)
  - workouts table
  - daily_metrics table
  - sync_logs table
```

**Polling Pattern:**
- **Frequency:** On-demand CLI execution (`bun run garmin:sync`)
- **No scheduled polling** - Manual or triggered by user/agent
- **Daily Syncs:** Typically 1-3 times when needed

**Data Consumed:**
- Activities (workouts, runs, etc.)
- Sleep metrics (duration, stages, scores)
- HRV (rmssd, status)
- Recovery (body battery, training readiness)
- Resting heart rate

**Architecture:**
```
+-------------------+     +-------------------+     +-------------------+
|  Manual trigger   |---->| garmin-sync-cli   |---->| GarminSyncService |
|  (bun run sync)   |     |      .ts          |     |   (TypeScript)    |
+-------------------+     +-------------------+     +-------------------+
                                                             |
                                                             v
                                                    +-------------------+
                                                    |   SQLite DB       |
                                                    |   workouts.db     |
                                                    +-------------------+
```

### 1.3 FitnessCoach Bot (Separate Service)

**Location:** `~/.claude/skills/FitnessCoach/`

**Purpose:** Telegram bot for wellness questionnaires and coaching

**Garmin Usage:**
- Uses `GarminSync.py` (same as Daily Briefing)
- Long-running daemon (KeepAlive in launchd)
- Does NOT continuously poll Garmin

---

## 2. System Comparison

### 2.1 Comparison Table

| Aspect | Daily Briefing | Fitness System |
|--------|----------------|----------------|
| **Trigger Model** | Time-based polling (5 min) | On-demand |
| **Scheduling** | launchd daemon | Manual CLI |
| **Time Window** | 6-10 AM only | Anytime |
| **Daily Calls** | 5-48 | 1-3 |
| **Primary Data** | Wake time (single field) | All metrics + activities |
| **Storage** | State file (JSON) | SQLite database |
| **Garmin Client** | Python (garminconnect) | TypeScript (garmin-connect) |
| **Data Lifetime** | Transient (daily reset) | Persistent (historical) |
| **Failure Mode** | Fallback to 8 AM | Retry on next manual sync |

### 2.2 Data Needs Comparison

```
DAILY BRIEFING                    FITNESS SYSTEM
===============                   ==============
sleepEndTimestampLocal [CRITICAL] Activities [CRITICAL]
                                  - activityId
                                  - startTimeLocal
                                  - duration, distance
                                  - HR, calories

sleep (for display only)          Daily Metrics [CRITICAL]
- sleepTimeSeconds                - sleepDurationSeconds
- deepSleepSeconds                - deepSleepSeconds
- remSleepSeconds                 - lightSleepSeconds
- lightSleepSeconds               - remSleepSeconds
                                  - sleepScore

hrv (for display only)            HRV [CRITICAL]
- lastNightAvg                    - hrvRmssd
- status                          - hrvStatus

recovery (for display only)       Recovery [CRITICAL]
- score                           - bodyBattery
- bodyBattery                     - restingHeartRate
                                  - trainingReadiness
```

**Key Insight:** Daily Briefing needs one critical field (wake time). Everything else is "nice to have" for display. Fitness System needs comprehensive data for coaching algorithms.

---

## 3. Overlap Identification

### 3.1 Actual Shared Infrastructure

```
+----------------------+
|    GarminSync.py     |  <-- ALREADY SHARED
| (FitnessCoach/Tools) |
+----------------------+
        ^         ^
        |         |
        |         |
+-------+    +----+-------+
| Daily |    | briefing.ts|
|Briefing|   | (data only)|
+--------+   +------------+
```

**Finding:** Both systems already share `GarminSync.py`. The Daily Briefing system explicitly uses:
```typescript
const GARMIN_SYNC_SCRIPT = `${homedir()}/.claude/skills/FitnessCoach/Tools/GarminSync.py`;
```

### 3.2 What Is NOT Shared

| Component | Daily Briefing | Fitness System |
|-----------|----------------|----------------|
| Garmin Client | Python (GarminSync.py) | TypeScript (GarminSyncService) |
| Authentication | Python garminconnect | TypeScript garmin-connect |
| Token Storage | `~/.claude/garmin-tokens` | Same (shared) |
| Data Storage | JSON state files | SQLite database |
| Scheduling | launchd (5 min) | None (manual) |

### 3.3 Overlap Assessment

**Overlap Score: 30%**

- **Shared:** Token storage, GarminSync.py script usage
- **Separate:** Clients, scheduling, storage, data models

The overlap is minimal because:
1. Fitness System has its own TypeScript GarminSyncService
2. Daily Briefing only uses Python GarminSync.py
3. Different scheduling needs (continuous polling vs on-demand)

---

## 4. Unified Architecture Option

### 4.1 Proposed Unified Design

```
                        UNIFIED GARMIN POLLING SERVICE
                        ==============================

+-------------------------------------------------------------------+
|                    garmin-poll-daemon.ts                          |
|                    (Unified Polling Service)                       |
|-------------------------------------------------------------------|
| - Runs continuously via launchd                                   |
| - Polls Garmin at configurable intervals                          |
| - Emits events to subscribers                                     |
| - Stores data in shared SQLite                                    |
+-------------------------------------------------------------------+
                    |                           |
                    v                           v
        +-----------------+           +-----------------+
        | Event: WAKE     |           | Event: DATA_SYNC|
        | Subscriber:     |           | Subscriber:     |
        | Daily Briefing  |           | Fitness System  |
        +-----------------+           +-----------------+
                    |                           |
                    v                           v
        +-----------------+           +-----------------+
        | briefing.ts     |           | Database write  |
        | (triggers brief)|           | (metrics/acts)  |
        +-----------------+           +-----------------+
```

### 4.2 Unified Implementation Components

```typescript
// Hypothetical unified-garmin-daemon.ts

interface GarminPollConfig {
  wakeDetection: {
    enabled: boolean;
    windowStart: number;  // 6 AM
    windowEnd: number;    // 10 AM
    interval: number;     // 5 minutes
  };
  fullSync: {
    enabled: boolean;
    times: string[];      // ["06:00", "20:00"]
  };
}

interface GarminEvent {
  type: "WAKE_DETECTED" | "DATA_SYNCED";
  timestamp: Date;
  data: GarminData;
}

class UnifiedGarminDaemon {
  private subscribers: Map<string, (event: GarminEvent) => void>;

  // Poll and emit events
  async poll(): Promise<void> {
    const data = await this.fetchGarminData();

    // Check for wake detection (6-10 AM)
    if (this.inWakeWindow() && !this.wakeDetectedToday()) {
      const wakeTime = this.parseWakeTime(data);
      if (wakeTime) {
        this.emit({ type: "WAKE_DETECTED", timestamp: wakeTime, data });
      }
    }

    // Full data sync
    this.emit({ type: "DATA_SYNCED", timestamp: new Date(), data });
  }

  subscribe(id: string, handler: (event: GarminEvent) => void): void {
    this.subscribers.set(id, handler);
  }
}
```

### 4.3 Unified Architecture Costs

| Cost Category | Estimate | Notes |
|---------------|----------|-------|
| **Development** | 3-5 days | New daemon, event system, subscriber integration |
| **Migration** | 1-2 days | Update both systems to use events |
| **Testing** | 2-3 days | Integration tests, edge cases |
| **Maintenance** | Higher | Single point of failure, more complex |
| **Total Effort** | 6-10 days | Significant investment |

### 4.4 Unified Architecture Benefits

1. **Single Garmin client** - One codebase for API interaction
2. **Shared authentication** - Token management in one place
3. **Reduced API calls** - No duplicate polling (marginal, ~5 calls/day saved)
4. **Consistent data** - Both systems see same Garmin data

### 4.5 Unified Architecture Risks

1. **Single point of failure** - If daemon fails, both systems fail
2. **Coupling** - Changes to one system affect the other
3. **Complexity** - Event system, pub/sub, coordination
4. **Debugging difficulty** - Harder to trace issues
5. **Over-engineering** - Solving a problem that barely exists

---

## 5. Separate Architecture Option

### 5.1 Current Separate Design

```
DAILY BRIEFING                           FITNESS SYSTEM
==============                           ==============

+-------------------+                    +-------------------+
|  launchd daemon   |                    |  Manual trigger   |
| (5 min, 6-10 AM)  |                    |  (bun garmin:sync)|
+-------------------+                    +-------------------+
        |                                         |
        v                                         v
+-------------------+                    +-------------------+
| briefing-on-wake  |                    | GarminSyncService |
|      .ts          |                    |   (TypeScript)    |
+-------------------+                    +-------------------+
        |                                         |
        v                                         v
+-------------------+                    +-------------------+
| GarminSync.py     |                    | garmin-connect    |
| (Python)          |                    | (npm package)     |
+-------------------+                    +-------------------+
        |                                         |
        v                                         v
+-------------------+                    +-------------------+
| JSON state files  |                    | SQLite database   |
+-------------------+                    +-------------------+
```

### 5.2 Separate Architecture Benefits

1. **Single Responsibility** - Each system does one thing well
2. **Independent Failure** - Briefing failure doesn't affect fitness
3. **Simpler Debugging** - Clear ownership, isolated issues
4. **No Coordination** - No event systems, no pub/sub
5. **Already Working** - 133 tests passing, operational since Jan 28

### 5.3 Separate Architecture Costs

1. **Duplicate Garmin Clients** - Python + TypeScript (already exists)
2. **Duplicate Token Management** - Same tokens, different code paths
3. **Extra API Calls** - 5-20 extra calls/day (within limits)

### 5.4 Why Separation is Correct

**Fundamental Constraint Analysis:**

1. **Different Polling Semantics**
   - Daily Briefing: "Poll until wake detected, then stop"
   - Fitness: "Sync when I ask, get everything"
   - These are fundamentally different patterns

2. **Different Time Sensitivities**
   - Daily Briefing: Time-critical (15 min after wake)
   - Fitness: Time-insensitive (sync whenever)

3. **Different Failure Modes**
   - Daily Briefing: Must fallback to 8 AM on failure
   - Fitness: Can retry later, no urgency

4. **Different Data Lifecycles**
   - Daily Briefing: Transient (daily reset)
   - Fitness: Persistent (historical analysis)

**The systems share a data source (Garmin) but have orthogonal operational requirements.**

---

## 6. Architectural Decision

### 6.1 Recommendation: KEEP SEPARATE

**Decision:** Maintain separate polling infrastructure for Daily Briefing and Fitness systems.

**Rationale:**

| Factor | Weight | Separate Wins? | Notes |
|--------|--------|----------------|-------|
| Complexity | High | Yes | Unified adds coordination overhead |
| Reliability | High | Yes | Independent failure domains |
| Development Cost | Medium | Yes | Unified needs 6-10 days work |
| API Efficiency | Low | No | Unified saves ~5 calls/day |
| Maintenance | Medium | Yes | Simpler debugging |
| **Total** | - | **Separate** | Clear winner |

**Key Insight:** The user's intuition ("they are kind of similar") is understandable but masks a deeper truth: **sharing a data source is not the same as sharing infrastructure**. Gmail and Calendar both access Google servers, but they're separate apps because their operational semantics differ.

### 6.2 ADR: Garmin Polling Architecture

**Decision:** Keep Daily Briefing and Fitness Garmin polling separate.

**Context:** User observed that both systems poll Garmin and wondered if they should share infrastructure.

**Analysis:**
- Daily Briefing polls every 5 minutes during a 4-hour morning window to detect wake time
- Fitness system syncs on-demand to import activities and metrics
- Both already share `GarminSync.py` for data fetching
- Different polling patterns, failure modes, and data lifecycles

**Decision Drivers:**
1. Single Responsibility Principle - Each system owns its domain
2. Failure Isolation - Independent failure domains
3. Operational Simplicity - No coordination overhead
4. Already Working - No broken state to fix

**Consequences:**
- Daily Briefing continues using GarminSync.py directly
- Fitness system continues using TypeScript GarminSyncService
- Both share token storage at `~/.claude/garmin-tokens`
- Minor duplication is acceptable given operational benefits

---

## 7. Recommended Optimizations

While keeping systems separate, these optimizations are recommended:

### 7.1 Short-Term (Low Effort)

**1. Consolidate Token Storage (Already Done)**
Both systems already use `~/.claude/garmin-tokens`.

**2. Daily Briefing Should Read from Fitness DB**

Currently, `briefing.ts` fetches fresh Garmin data. It should read from the fitness database instead:

```typescript
// Current (briefing.ts line 81):
function getGarminData(): GarminData {
  const result = execSync(`python3 ${syncScript} --days 7 --output json`);
  // Parse result...
}

// Recommended:
function getGarminData(): GarminData {
  const db = getDatabase();
  const metrics = db.queryOne<DailyMetrics>(
    `SELECT * FROM daily_metrics WHERE date = ? ORDER BY updated_at DESC LIMIT 1`,
    [today]
  );
  // Use cached data from fitness DB
}
```

**Benefit:** Eliminates redundant Garmin API call during briefing generation.

**Note:** `briefing.ts` already imports from fitness DB for prescriptions (line 16). Extending this pattern is natural.

### 7.2 Medium-Term (Moderate Effort)

**3. Port GarminSync.py to TypeScript**

Both systems could use the TypeScript GarminSyncService:

```
Before:
  Daily Briefing -> GarminSync.py (Python)
  Fitness -> GarminSyncService (TypeScript)

After:
  Daily Briefing -> GarminSyncService (TypeScript)
  Fitness -> GarminSyncService (TypeScript)
```

**Benefit:** Single Garmin client codebase, easier maintenance.

**Effort:** 2-3 days

### 7.3 Long-Term (If Needed)

**4. Scheduled Fitness Sync**

If fitness data staleness becomes an issue, add scheduled sync:

```xml
<!-- com.pai.fitness-sync.plist -->
<dict>
  <key>Label</key>
  <string>com.pai.fitness-sync</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Hour</key>
      <integer>6</integer>
    </dict>
    <dict>
      <key>Hour</key>
      <integer>20</integer>
    </dict>
  </array>
  <!-- Sync at 6 AM and 8 PM -->
</dict>
```

**Benefit:** Fitness data always fresh for briefing.

---

## Appendix A: System Files Reference

### Daily Briefing System
| File | Purpose |
|------|---------|
| `Tools/briefing-on-wake.ts` | Wake detection daemon (133 tests) |
| `Tools/briefing.ts` | Main briefing generator |
| `State/wake-state.json` | Daily state tracking |
| `Config/com.pai.dailybriefing.plist` | launchd config |

### Fitness System
| File | Purpose |
|------|---------|
| `src/services/garmin/sync.ts` | TypeScript Garmin client |
| `src/services/garmin/sync-cli.ts` | CLI for manual sync |
| `src/db/client.ts` | SQLite database client |
| `src/config.ts` | Configuration management |

### Shared
| File | Purpose |
|------|---------|
| `FitnessCoach/Tools/GarminSync.py` | Python Garmin sync (used by briefing) |
| `~/.claude/garmin-tokens/` | Shared token storage |

---

## Appendix B: API Rate Limit Analysis

**Garmin Connect Unofficial Limits:**
- ~2000 requests/day
- ~100 requests/hour

**Current Usage:**
- Daily Briefing: 5-48 calls/day (during 6-10 AM window)
- Fitness System: 1-3 calls/day (manual syncs)
- Combined: ~10-50 calls/day

**Unified Would Save:** ~5 calls/day

**Verdict:** Rate limits are not a concern. Current usage is <3% of daily limit.

---

## Appendix C: Decision History

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-28 | Keep separate | Different polling patterns, failure modes, data lifecycles |
| Future | Consider consolidation if | Both systems need real-time data OR maintenance burden increases |

---

*Document generated by Architect Agent on 2026-01-28*
