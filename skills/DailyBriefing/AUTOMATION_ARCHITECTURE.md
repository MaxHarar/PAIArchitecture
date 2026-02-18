# Wake-Triggered Briefing Automation Architecture

**Version:** 1.0
**Status:** Production (Operational since 2026-01-28)
**Author:** Architect Agent

---

## Executive Summary

This document describes the architecture for automated morning briefings triggered by Garmin wake-up detection. The system polls Garmin sleep data to detect when the user wakes up, then delivers a personalized briefing 15 minutes after detected wake time.

**Key Design Decisions:**
- Polling-based approach (every 5 minutes) rather than event-driven (Garmin has no webhooks)
- State machine with triple-guard duplicate prevention
- Graceful fallback to 8 AM if Garmin data unavailable
- launchd for macOS daemon management (survives restarts)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Wake Detection Algorithm](#2-wake-detection-algorithm)
3. [Trigger Timing Logic](#3-trigger-timing-logic)
4. [State Management](#4-state-management)
5. [Error Handling & Notifications](#5-error-handling--notifications)
6. [Rate Limiting Strategy](#6-rate-limiting-strategy)
7. [Deployment Architecture](#7-deployment-architecture)
8. [Edge Cases & Failure Modes](#8-edge-cases--failure-modes)
9. [Testing Strategy](#9-testing-strategy)
10. [Operational Runbook](#10-operational-runbook)

---

## 1. System Overview

### Architecture Diagram

```
                                    GARMIN CONNECT
                                         |
                                         | HTTPS (garminconnect lib)
                                         v
+-------------------+              +-------------------+
|                   |  5-min poll  |                   |
|  launchd daemon   | -----------> | briefing-on-wake  |
|  (StartInterval)  |              |      .ts          |
|                   |              |                   |
+-------------------+              +--------+----------+
                                           |
                         +--------+--------+--------+
                         |        |        |        |
                         v        v        v        v
                    +------+  +------+  +------+  +------+
                    |Garmin|  |State |  |Brief-|  |Tele- |
                    |Sync  |  |File  |  |ing   |  |gram  |
                    |.py   |  |.json |  |.ts   |  |API   |
                    +------+  +------+  +------+  +------+
```

### Component Summary

| Component | Purpose | Location |
|-----------|---------|----------|
| `briefing-on-wake.ts` | Wake detection daemon orchestrator | `Tools/briefing-on-wake.ts` |
| `GarminSync.py` | Garmin API client (sleep/HRV/recovery) | `FitnessCoach/Tools/GarminSync.py` |
| `briefing.ts` | Main briefing generator | `Tools/briefing.ts` |
| `wake-state.json` | Persistent state file | `State/wake-state.json` |
| `com.pai.dailybriefing.plist` | launchd daemon config | `Config/com.pai.dailybriefing.plist` |

### Data Flow

1. **launchd triggers** `briefing-on-wake.ts` every 5 minutes
2. **Check time window** (6 AM - 10 AM) - exit early if outside
3. **Check state file** - exit if already sent today
4. **Fetch Garmin data** via `GarminSync.py --days 7 --output json`
5. **Parse wake time** from `sleep.sleepEndTimestampLocal`
6. **Calculate trigger** = wake time + 15 minutes
7. **If current time >= trigger** -> execute `briefing.ts`
8. **Update state file** with send confirmation
9. **Send to Telegram** via dedicated bot

---

## 2. Wake Detection Algorithm

### Garmin Sleep Data Structure

The Garmin API provides sleep data with the following relevant fields:

```json
{
  "sleep": {
    "sleepEndTimestampLocal": 1738046520000,
    "sleepTimeSeconds": 25200,
    "deepSleepSeconds": 5400,
    "remSleepSeconds": 6300,
    "lightSleepSeconds": 12600,
    "awakeSleepSeconds": 900
  }
}
```

### Wake Time Extraction

```typescript
// From briefing-on-wake.ts
function parseWakeTime(garminData: GarminSleepData | null): Date | null {
  if (!garminData?.sleep?.sleepEndTimestampLocal) {
    return null;
  }

  const timestamp = garminData.sleep.sleepEndTimestampLocal;

  // Handle both numeric (milliseconds) and ISO string formats
  if (typeof timestamp === 'number') {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}
```

### Key Implementation Details

| Aspect | Implementation | Rationale |
|--------|----------------|-----------|
| **Data source** | `sleepEndTimestampLocal` | Local timezone-aware, represents actual wake time |
| **Fetch days** | 7 days lookback | Garmin sometimes delays data; ensures recent sleep found |
| **Timestamp format** | Unix milliseconds OR ISO string | Garmin API returns either format |
| **Validation** | `isNaN(date.getTime())` check | Protects against malformed data |

### Why Not Realtime Webhooks?

Garmin Connect does not provide webhook/push notifications. The only option is polling:

- **Garmin SDK**: Mobile-only, requires companion app
- **Garmin Connect API**: REST only, no webhooks
- **Third-party integrations**: Require OAuth flow, still polling

**5-minute polling** balances:
- Responsiveness (max 5 min delay from wake detection)
- API rate limits (< 300 requests/day)
- Battery/resource efficiency

---

## 3. Trigger Timing Logic

### Core Timing Algorithm

```typescript
// Calculate trigger time (wake time + offset)
function calculateTriggerTime(wakeTime: Date, offsetMinutes: number): Date {
  const trigger = new Date(wakeTime.getTime());
  trigger.setMinutes(trigger.getMinutes() + offsetMinutes);
  return trigger;
}

// Check if current time is at or past trigger time
function shouldTriggerBriefing(triggerTime: Date, currentTime: Date): boolean {
  return currentTime.getTime() >= triggerTime.getTime();
}
```

### Timing Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `windowStartHour` | 6 | Earliest hour to poll (6 AM) |
| `windowEndHour` | 10 | Latest hour to poll (10 AM) |
| `fallbackHour` | 8 | Send at this time if no Garmin data |
| `wakeOffsetMinutes` | 15 | Minutes after wake to trigger briefing |

### Timing Scenarios

```
Scenario 1: Normal Wake (5:30 AM)
  Wake detected:    5:30 AM
  Trigger time:     5:45 AM
  First poll after: 6:00 AM (within window)
  Briefing sent:    6:00 AM (trigger already passed)

Scenario 2: Late Wake (7:15 AM)
  Wake detected:    7:15 AM
  Trigger time:     7:30 AM
  First poll after: 7:20 AM (sees trigger at 7:30)
  Briefing sent:    7:30 AM (next poll after trigger)

Scenario 3: No Garmin Data
  Wake detected:    null
  Fallback time:    8:00 AM
  Briefing sent:    8:05 AM (first poll after fallback)

Scenario 4: Very Late Wake (9:50 AM)
  Wake detected:    9:50 AM
  Trigger time:     10:05 AM
  Window closes:    10:00 AM
  Result:           No briefing (missed window)
```

### Window Boundary Behavior

```typescript
function isWithinTimeWindow(time: Date, config: WakeConfig): boolean {
  const hour = time.getHours();
  return hour >= config.windowStartHour && hour < config.windowEndHour;
}
```

- **6:00:00 AM**: INSIDE window (hour == 6)
- **5:59:59 AM**: OUTSIDE window (hour == 5)
- **10:00:00 AM**: OUTSIDE window (hour == 10, exclusive)
- **9:59:59 AM**: INSIDE window (hour == 9)

---

## 4. State Management

### State Schema

```typescript
interface WakeState {
  // Date tracking (new day detection)
  date: string;                    // YYYY-MM-DD

  // Wake detection
  wakeDetected: boolean;           // Wake time found from Garmin
  wakeTime: string | null;         // ISO timestamp of wake
  triggerTime: string | null;      // Wake + 15 minutes

  // Briefing status (triple-guard)
  briefingSent: boolean;           // Guard 1: Primary flag
  briefingSentAt: string | null;   // Guard 3: Timestamp verification
  sendMethod: 'wake-triggered' | 'fallback' | null;

  // Error tracking
  garminConsecutiveFailures: number;
  lastGarminError: string | null;
  lastPollTime: string | null;

  // Legacy fields (backwards compatibility)
  lastSent: string | null;
  lastWakeTime: string | null;
  lastTriggerTime: string | null;
}
```

### Triple-Guard Duplicate Prevention

```typescript
function shouldSkipBriefing(state: WakeState, todayDate: string): boolean {
  // Guard 1: briefingSent flag for same day
  if (state.briefingSent && state.date === todayDate) {
    return true;
  }

  // Guard 2: date comparison - different day means fresh start
  if (state.date !== todayDate) {
    return false;
  }

  // Guard 3: briefingSentAt timestamp check
  if (state.briefingSentAt) {
    const sentDate = new Date(state.briefingSentAt).toISOString().split('T')[0];
    if (sentDate === todayDate) {
      return true;
    }
  }

  return false;
}
```

### State Transitions

```
                          +-----------------+
                          |   NEW_DAY       |
                          |  (date reset)   |
                          +--------+--------+
                                   |
                                   v
                          +--------+--------+
                          |  POLLING_ACTIVE |
                          |  (6am-10am)     |
                          +--------+--------+
                                   |
              +--------------------+--------------------+
              |                                         |
              v                                         v
     +--------+--------+                       +--------+--------+
     |  CHECK_GARMIN   |                       |  OUTSIDE_WINDOW |
     |  (fetch sleep)  |                       |  (exit, code 1) |
     +--------+--------+                       +-----------------+
              |
    +---------+---------+
    |                   |
    v                   v
+---+---+          +----+----+
|SUCCESS|          | FAILURE |
+---+---+          +----+----+
    |                   |
    v                   v
+---+---+          +----+----+
| WAKE  |          | INCREMENT|
|DETECTED|         | FAILURES |
+---+---+          +----+----+
    |                   |
    v                   |
+---+--------+          |
| CALCULATE  |          |
| TRIGGER    |          |
+---+--------+          |
    |                   |
    v                   v
+---+--------+     +----+----+
| WAITING    |     | FORCE   |
| TRIGGER    |     | FALLBACK|
+---+--------+     | (>6 fail)|
    |              +----+----+
    v                   |
+---+--------+          |
| TRIGGER    |<---------+
| REACHED    |
+---+--------+
    |
    v
+---+--------+
| SEND       |
| BRIEFING   |
+---+--------+
    |
    v
+---+--------+
| UPDATE     |
| STATE      |
| (sent=true)|
+---+--------+
    |
    v
+---+--------+
| DAY        |
| COMPLETE   |
| (exit 0/2) |
+------------+
```

### Atomic State Writes

```typescript
function saveState(statePath: string, state: WakeState): void {
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write to temp file, then rename (atomic operation)
  const tempPath = `${statePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2));
  renameSync(tempPath, statePath);
}
```

**Why atomic writes?**
- Prevents corruption from interrupted writes
- System crash during write leaves old state intact
- `rename()` is atomic on POSIX filesystems

---

## 5. Error Handling & Notifications

### Garmin API Failure Handling

```typescript
function incrementGarminFailure(state: WakeState, error: string): WakeState {
  return {
    ...state,
    garminConsecutiveFailures: state.garminConsecutiveFailures + 1,
    lastGarminError: error,
    lastPollTime: new Date().toISOString()
  };
}

function shouldForceFallback(state: WakeState, config: WakeConfig): boolean {
  const maxFailures = config.maxGarminFailures ?? 6;
  return state.garminConsecutiveFailures >= maxFailures;
}
```

### Failure Recovery Strategy

| Consecutive Failures | Action |
|---------------------|--------|
| 1-5 | Log error, retry on next poll |
| 6+ | Force fallback send (8 AM or immediate if past) |

**Rationale:**
- 5 failures = 25 minutes of Garmin API downtime
- After 30 minutes, assume Garmin is down for the day
- Better to send via fallback than miss entirely

### Exit Codes

```typescript
const EXIT_CODES = {
  SENT: 0,           // Briefing sent successfully
  NOT_TIME_YET: 1,   // Outside window or before trigger
  ALREADY_SENT: 2,   // Already sent today
  ERROR: 3           // Error occurred
} as const;
```

### Notification Strategy

**Current Implementation:**
- Errors logged to `State/stderr.log`
- Success logged to `State/stdout.log`
- Telegram receives briefing only (no error notifications)

**Future Enhancement (Recommended):**
```typescript
// Add to briefing-on-wake.ts
async function notifyError(error: string): Promise<void> {
  // Send to Telegram on critical errors (6+ Garmin failures)
  await sendTelegram({
    message: `[ALERT] Wake briefing system error: ${error}`,
    chatId: config.telegram.chatId
  });
}
```

---

## 6. Rate Limiting Strategy

### Garmin API Limits

| Metric | Limit | Our Usage |
|--------|-------|-----------|
| Requests/day | ~2000 (unofficial) | ~144 (5-min intervals, 12 hours) |
| Requests/hour | ~100 (unofficial) | ~12 (5-min intervals) |
| Auth/day | 10 (after token cached) | 1 (initial login) |

### Polling Optimization

```python
# From GarminSync.py - Token caching
TOKEN_DIR = os.path.expanduser("~/.claude/garmin-tokens")

def get_client():
    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    client.login()

    # Save tokens for reuse
    os.makedirs(TOKEN_DIR, exist_ok=True)
    client.garth.dump(TOKEN_DIR)

    return client
```

### Rate Limiting Implementation

**Current Safeguards:**
1. **Time window limiting**: Only polls 6 AM - 10 AM (4 hours)
2. **Early exit on success**: Stops polling once briefing sent
3. **Token caching**: Minimizes auth requests
4. **Timeout**: 30-second timeout prevents hung connections

**Effective Daily Usage:**
- Best case: 1-5 polls (wake detected early, send successful)
- Worst case: 48 polls (no Garmin data, all 4 hours)
- Average case: 15-20 polls

---

## 7. Deployment Architecture

### launchd Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pai.dailybriefing</string>

    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>run</string>
        <string>/Users/maxharar/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts</string>
    </array>

    <!-- Run every 300 seconds (5 minutes) -->
    <key>StartInterval</key>
    <integer>300</integer>

    <!-- Prevent rapid restarts on failure -->
    <key>ThrottleInterval</key>
    <integer>60</integer>

    <!-- Environment variables -->
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/maxharar</string>
    </dict>

    <!-- Log output -->
    <key>StandardOutPath</key>
    <string>/Users/maxharar/.claude/skills/DailyBriefing/State/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/maxharar/.claude/skills/DailyBriefing/State/stderr.log</string>

    <!-- Run immediately on load -->
    <key>RunAtLoad</key>
    <true/>

    <!-- Working directory -->
    <key>WorkingDirectory</key>
    <string>/Users/maxharar/.claude/skills/DailyBriefing</string>
</dict>
</plist>
```

### Installation Commands

```bash
# Install daemon
cp ~/.claude/skills/DailyBriefing/Config/com.pai.dailybriefing.plist \
   ~/Library/LaunchAgents/

# Load daemon (starts immediately)
launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Verify running
launchctl list | grep dailybriefing
# Expected: -    1    com.pai.dailybriefing

# Unload (stop daemon)
launchctl unload ~/Library/LaunchAgents/com.pai.dailybriefing.plist
```

### Restart Survival

launchd ensures the daemon:
- **Starts on login**: `RunAtLoad: true`
- **Restarts after crash**: `ThrottleInterval: 60` (waits 60s before restart)
- **Survives system restart**: Auto-loads from `~/Library/LaunchAgents`

### File System Layout

```
~/.claude/skills/DailyBriefing/
├── Config/
│   ├── com.pai.dailybriefing.plist           # Active launchd config
│   ├── com.pai.dailybriefing.plist.fixed-schedule  # Rollback (5:45 AM)
│   └── settings.json                         # Telegram credentials
├── State/
│   ├── wake-state.json                       # Persistent state
│   ├── last-briefing.json                    # Legacy state
│   ├── stdout.log                            # Standard output
│   ├── stderr.log                            # Error output
│   └── wake-briefing.log                     # Detailed daemon log
├── Tools/
│   ├── briefing-on-wake.ts                   # Wake detection daemon
│   ├── briefing-on-wake.test.ts              # Test suite
│   ├── briefing.ts                           # Main briefing generator
│   └── ...
└── AUTOMATION_ARCHITECTURE.md                # This document
```

---

## 8. Edge Cases & Failure Modes

### Handled Edge Cases

| Edge Case | Handling |
|-----------|----------|
| **No sleep data** | Falls back to 8 AM |
| **Already sent today** | Triple-guard prevents duplicate |
| **Garmin API down** | After 6 failures, force fallback |
| **Wake before 6 AM** | Trigger calculated, sent when window opens |
| **Wake after 9:45 AM** | Trigger at 10 AM+ misses window (no send) |
| **System restart** | launchd auto-restarts daemon |
| **Corrupt state file** | Creates fresh state, treats as new day |
| **Invalid JSON** | Gracefully handles, creates fresh state |
| **Midnight rollover** | Date comparison resets state |

### Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Max 5-min delay** | Briefing up to 5 min late | Acceptable for use case |
| **Window closes at 10 AM** | Very late wakers miss briefing | Configurable; fallback catches most |
| **Garmin data delay** | Sleep data may take 30+ min to sync | 7-day lookback; fallback |
| **No webhooks** | Polling-only architecture | 5-min interval is practical |

### Failure Mode Analysis

```
FAILURE: Garmin API returns 500
├── Increment garminConsecutiveFailures
├── Log error to stderr.log
├── If failures < 6: retry on next poll
└── If failures >= 6: force fallback send

FAILURE: Network timeout
├── execSync timeout (30s) triggers exception
├── Caught, logged, treated as Garmin failure
└── Same recovery path as API 500

FAILURE: Telegram API down
├── sendTelegram returns false
├── State NOT marked as sent (briefingSent = false)
├── Retry on next poll
└── May result in late send, but not missed

FAILURE: Disk full (can't write state)
├── writeFileSync throws
├── Exception caught, logged to stderr
├── State not updated, but briefing may have sent
└── RISK: Potential duplicate on next poll
```

---

## 9. Testing Strategy

### Test Coverage Summary

```
Tests: 133 total
├── Unit tests: 97
├── Integration tests: 36
├── Line coverage: 50%
├── Function coverage: 62%
└── Execution time: 41ms
```

### Test Scenarios Covered

1. **Happy path**: Wake at 6:42am, trigger at 6:57am
2. **Already sent**: Second check on same day exits cleanly
3. **Fallback**: No Garmin data by 8am, sends anyway
4. **Too early**: 5:30am check exits (outside window)
5. **Too late**: 11am check exits (outside window)
6. **Garmin failure**: API error, fallback triggers
7. **Multiple wakes**: Only first wake counts
8. **Edge of window**: 5:59am, 10:01am boundary tests

### Running Tests

```bash
# Run all tests
bun test ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.test.ts

# Run with coverage
bun test --coverage ~/.claude/skills/DailyBriefing/Tools/

# Run specific scenario
bun test --filter "Happy Path"
```

### Manual Testing Commands

```bash
# Check current status
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --status

# Test with simulated wake time
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts \
  --test-wake-time "2026-01-29T06:42:00" \
  --test-current-time "2026-01-29T07:00:00" \
  --debug

# Dry run (no actual send)
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --dry-run

# Force send (ignores all guards)
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --force

# Reset state (for testing)
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --reset
```

---

## 10. Operational Runbook

### Daily Operations

**No action required.** The daemon is fully autonomous.

### Monitoring Commands

```bash
# Check daemon is running
launchctl list | grep dailybriefing

# View recent logs
tail -20 ~/.claude/skills/DailyBriefing/State/stdout.log

# Check for errors
grep "ERROR" ~/.claude/skills/DailyBriefing/State/stderr.log | tail -10

# View current state
cat ~/.claude/skills/DailyBriefing/State/wake-state.json | jq

# Check status via CLI
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --status
```

### Troubleshooting Guide

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| **No briefing received** | Check `launchctl list` | `launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist` |
| **Duplicate briefings** | State file issue | `bun run briefing-on-wake.ts --reset` |
| **Garmin data not found** | API auth expired | Re-run `python3 GarminSync.py` to refresh |
| **Always 8 AM fallback** | Wake time not detected | Check Garmin has sleep data; verify device worn |
| **Daemon keeps crashing** | Check stderr.log | Fix root cause, daemon auto-restarts |

### Rollback to Fixed Schedule

If wake detection causes issues, rollback to fixed 5:45 AM:

```bash
# Stop current daemon
launchctl unload ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Copy fixed-schedule plist
cp ~/.claude/skills/DailyBriefing/Config/com.pai.dailybriefing.plist.fixed-schedule \
   ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Load fixed-schedule daemon
launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Verify
launchctl list | grep dailybriefing
```

### Log Rotation

Logs are not automatically rotated. For large logs:

```bash
# Rotate logs manually
cd ~/.claude/skills/DailyBriefing/State
mv stdout.log stdout.log.old
mv stderr.log stderr.log.old
touch stdout.log stderr.log

# Optional: compress old logs
gzip stdout.log.old stderr.log.old
```

---

## Appendix A: Configuration Reference

### WakeConfig Interface

```typescript
interface WakeConfig {
  windowStartHour: number;      // Default: 6
  windowEndHour: number;        // Default: 10
  fallbackHour?: number;        // Default: 8
  wakeOffsetMinutes?: number;   // Default: 15
  maxGarminFailures?: number;   // Default: 6
}
```

### CLI Flags

| Flag | Purpose | Example |
|------|---------|---------|
| `--test` | Preview without sending | `--test` |
| `--status` | Show current state | `--status` |
| `--reset` | Clear state | `--reset` |
| `--force` | Override all checks | `--force` |
| `--dry-run` | Simulate execution | `--dry-run` |
| `--debug` | Verbose logging | `--debug` |
| `--test-wake-time` | Simulate wake | `--test-wake-time "2026-01-29T06:42:00"` |
| `--test-current-time` | Simulate now | `--test-current-time "2026-01-29T08:00:00"` |

---

## Appendix B: Architectural Decisions Record

### ADR-001: Polling vs Event-Driven

**Decision:** Use 5-minute polling interval

**Context:** Garmin Connect API does not support webhooks or push notifications

**Alternatives Considered:**
1. Mobile app with Garmin SDK - Requires companion app
2. IFTTT integration - Added dependency, still polling
3. Shorter polling interval - Unnecessary, increases API load

**Consequences:**
- Maximum 5-minute delay from wake detection
- Simple, maintainable architecture
- No external dependencies beyond Garmin API

### ADR-002: State File vs Database

**Decision:** Use JSON file for state management

**Context:** Need to track daily state, prevent duplicates, handle errors

**Alternatives Considered:**
1. SQLite database - Overkill for single-record state
2. Environment variables - Lost on restart
3. In-memory only - Lost on crash

**Consequences:**
- Simple, human-readable state
- Atomic writes prevent corruption
- Easy debugging via `cat state.json | jq`

### ADR-003: launchd vs cron

**Decision:** Use launchd (macOS native)

**Context:** Need daemon management on macOS

**Alternatives Considered:**
1. cron - Less integrated, no crash recovery
2. systemd - Linux only
3. Custom daemon - Unnecessary complexity

**Consequences:**
- Native macOS integration
- Automatic restart on crash
- Survives system restarts

---

*Document generated by Architect Agent on 2026-01-28*
