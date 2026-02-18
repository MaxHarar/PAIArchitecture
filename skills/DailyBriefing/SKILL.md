---
name: DailyBriefing
description: Executive daily summary sent to Telegram. USE WHEN daily briefing, morning summary, telegram briefing, executive summary.
---

# DailyBriefing

Automated executive daily briefing delivered via dedicated Telegram bot (MaxsDailyBreifBot). Uses wake-triggered delivery: sends 15 minutes after detected wake time from Garmin sleep data (6-10 AM window, 8 AM fallback).

## Triggers

- "daily briefing", "morning briefing", "executive summary"
- "send briefing", "telegram briefing", "today's summary"
- "test briefing", "configure briefing"

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **GenerateBriefing** | "daily briefing", "send briefing" | `Workflows/GenerateBriefing.md` |
| **TestBriefing** | "test briefing" | `Workflows/TestBriefing.md` |
| **ConfigureTelegram** | "configure telegram", "setup briefing" | `Workflows/ConfigureTelegram.md` |

## What It Does

Aggregates data from multiple sources and delivers a clean morning briefing via dedicated Telegram bot:

1. **Health Metrics** - Garmin sleep, HRV, recovery score
2. **Workout Schedule** - Today's planned workouts from Google Calendar
3. **Health Suggestions** - AI-powered workout modification recommendations
4. **News Summary** - Top AI and general news headlines
5. **TELOS Focus** - Current goals and challenges from your life system

## Three-Bot Architecture

The PAI system uses three separate Telegram bots for different purposes:

| Bot | Direction | Purpose | Token Location |
|-----|-----------|---------|----------------|
| **Jarvis Bot** | Two-way | General AI assistant, all PAI interactions | `~/.claude/settings.json` |
| **MaxsDailyBreifBot** | One-way | Morning briefing delivery | `~/.claude/skills/DailyBriefing/Config/settings.json` |
| **GogginsFitnessCoachBot** | Two-way | Interactive wellness questionnaires | `~/.claude/skills/FitnessCoach/Config/settings.json` |

**Critical:** DailyBriefing tools read their config from `~/.claude/skills/DailyBriefing/Config/settings.json`, NOT the main `~/.claude/settings.json`.

## Data Sources

| Source | Tool | Data |
|--------|------|------|
| Garmin | `GarminSync.py` (existing) | Sleep, HRV, recovery |
| Calendar | `gcalcli` | Today's workouts |
| News | AIUpdates skill | AI headlines |
| TELOS | File reader | Goals, challenges |

## Configuration

Edit `Config/settings.json`:

```json
{
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "chatId": "YOUR_CHAT_ID"
  },
  "schedule": {
    "sendTime": "05:45",
    "timezone": "America/New_York"
  }
}
```

## Setup Steps

1. **Create Dedicated Briefing Bot:**
   - Message @BotFather on Telegram
   - Send `/newbot`, name it "MaxsDailyBreifBot" (or your preference)
   - Copy the token to `~/.claude/skills/DailyBriefing/Config/settings.json`
   - **Important:** This is a SEPARATE bot from your main Jarvis assistant bot

2. **Get Your Chat ID:**
   - Message @RawDataBot on Telegram
   - Copy your chat ID to `~/.claude/skills/DailyBriefing/Config/settings.json`

3. **Start Chat with Your Bot:**
   - Search for your new bot in Telegram
   - Send `/start` to authorize it to message you

4. **Test:**
   - Run `bun run ~/.claude/skills/DailyBriefing/Tools/briefing.ts --test`
   - Verify message arrives in the briefing bot chat, NOT your Jarvis chat

5. **Install Wake-Triggered System:**
   See "Wake-Triggered Setup" section below.

---

## Wake-Triggered Setup (Current System)

**Status:** ✅ Installed and operational

The briefing system uses **wake detection** via Garmin sleep data instead of a fixed time:

| Feature | Details |
|---------|---------|
| **Polling Frequency** | Every 5 minutes (launchd StartInterval: 300) |
| **Active Window** | 6:00 AM - 10:00 AM (self-limiting) |
| **Wake Detection** | Reads `sleepEndTimestampLocal` from Garmin API |
| **Trigger Delay** | 15 minutes after detected wake time |
| **Fallback Time** | 8:00 AM if no Garmin data available |
| **Duplicate Prevention** | Triple-guard: (1) briefingSent flag, (2) date comparison, (3) timestamp |
| **Error Handling** | Consecutive Garmin failure tracking, force fallback after 6 failures |

### Installation (Already Complete)

The wake-triggered daemon is currently installed and running. If you need to reinstall:

```bash
# Stop daemon
launchctl unload ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Copy plist
cp ~/.claude/skills/DailyBriefing/Config/com.pai.dailybriefing.plist ~/Library/LaunchAgents/

# Load daemon
launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Verify running
launchctl list | grep dailybriefing
# Should show: -	1	com.pai.dailybriefing
```

### State Machine

The wake-triggered system uses a state machine to prevent duplicates:

```typescript
interface WakeState {
  date: string;                    // YYYY-MM-DD for new day detection
  wakeDetected: boolean;           // Wake time found from Garmin
  wakeTime: string | null;         // ISO timestamp of wake
  triggerTime: string | null;      // Wake + 15 minutes
  briefingSent: boolean;           // Primary duplicate guard
  briefingSentAt: string | null;   // Timestamp of send
  sendMethod: 'wake-triggered' | 'fallback' | null;
  garminConsecutiveFailures: number;
  lastGarminError: string | null;
  lastPollTime: string | null;
}
```

**State Transitions:**
1. `NEW_DAY_START` → Reset state at midnight
2. `POLLING_ACTIVE` → Check if within 6-10 AM window
3. `CHECK_GARMIN` → Fetch sleep data from API
4. `WAKE_DETECTED` → Parse `sleepEndTimestampLocal`
5. `WAITING_TRIGGER` → Wait until wake + 15 minutes
6. `SEND_BRIEFING` → Execute briefing, set `briefingSent=true`
7. `DAY_COMPLETE` → Exit polling for the day

### CLI Flags

| Flag | Purpose | Example |
|------|---------|---------|
| `--test` | Dry run without sending | `--test` |
| `--status` | Show current wake state | `--status` |
| `--reset` | Clear state for new day | `--reset` |
| `--force` | Override all checks and send | `--force` |
| `--dry-run` | Simulate without executing | `--dry-run` |
| `--debug` | Verbose logging | `--debug` |
| `--test-wake-time` | Simulate wake time | `--test-wake-time "2026-01-29T06:42:00"` |
| `--test-current-time` | Simulate current time | `--test-current-time "2026-01-29T08:15:00"` |

### Manual Testing

```bash
# Check current status
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --status

# Test with simulated wake time at 6:42 AM (triggers at 6:57 AM)
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts \
  --test-wake-time "2026-01-29T06:42:00" \
  --debug

# Dry run - show what would happen without sending
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --dry-run

# Test duplicate prevention (second run should exit immediately)
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --force
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --debug
# Should output: "Briefing already sent today at ..."

# Reset state to test again
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --reset

# Force send right now (ignores all conditions)
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --force
```

### Monitoring & Troubleshooting

```bash
# Check daemon is running
launchctl list | grep dailybriefing
# Expected: -	1	com.pai.dailybriefing

# View daemon logs (real-time)
tail -f ~/.claude/skills/DailyBriefing/State/stdout.log

# View error logs
tail -f ~/.claude/skills/DailyBriefing/State/stderr.log

# Check wake detection state
cat ~/.claude/skills/DailyBriefing/State/wake-state.json | jq

# Check current status
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --status

# View last 20 poll attempts
tail -20 ~/.claude/skills/DailyBriefing/State/stdout.log | grep "POLL"

# Check for errors
grep "ERROR" ~/.claude/skills/DailyBriefing/State/stderr.log
```

**Common Issues:**

| Issue | Cause | Fix |
|-------|-------|-----|
| No briefing received | Daemon not running | `launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist` |
| Duplicate briefings | State file corrupted | `bun run briefing-on-wake.ts --reset` |
| Garmin data not found | API authentication expired | Re-run GarminSync.py to refresh tokens |
| Briefing at 8 AM always | Wake time not detected | Check Garmin API has sleep data: `python3 GarminSync.py` |

### Configuration

Edit `~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts` DEFAULT_CONFIG section:

| Setting | Default | Description |
|---------|---------|-------------|
| `windowStartHour` | 6 | Earliest hour to check (6 AM) |
| `windowEndHour` | 10 | Latest hour to check (10 AM) |
| `fallbackHour` | 8 | Send at this time if no Garmin data |
| `wakeOffsetMinutes` | 15 | Minutes after wake to trigger briefing |

**Wake Detection**: Uses Garmin sleep data (`sleepEndTimestampLocal`) to detect when you woke up. Sends briefing 15 minutes after detected wake time.

### Rollback to Fixed Schedule

If wake-detection causes issues, rollback to fixed 5:45 AM:

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

---

## Architecture: Wake-Triggered vs Fixed Schedule

### Current System: Wake-Triggered ✅

**Implementation:** `Tools/briefing-on-wake.ts`
**Schedule:** Polls every 5 minutes (6-10 AM window)
**Trigger:** 15 minutes after Garmin wake detection OR 8 AM fallback
**State:** Persistent state file prevents duplicates
**Tests:** 133 passing tests, 50% line coverage

### Legacy System: Fixed 5:45 AM (Backup)

**Implementation:** `Tools/briefing.ts`
**Schedule:** Fixed 5:45 AM daily (StartCalendarInterval)
**Rollback file:** `Config/com.pai.dailybriefing.plist.fixed-schedule`
**Use when:** Wake detection has issues

**To rollback to fixed schedule:**

```bash
# Stop wake-triggered daemon
launchctl unload ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Copy fixed-schedule plist
cp ~/.claude/skills/DailyBriefing/Config/com.pai.dailybriefing.plist.fixed-schedule \
   ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Load fixed-schedule daemon
launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Verify
launchctl list | grep dailybriefing
```

## Output Format

```
=====================================
GOOD MORNING, MAX
Monday, January 27, 2026 | 5:45 AM
=====================================

HEALTH STATUS
------------------------------------
Sleep: 7.2h (Good)
HRV: 58ms (Normal)
Recovery: 82% (Ready)

WORKOUT RECOMMENDATION
------------------------------------
Green light for scheduled intensity.

TODAY'S WORKOUTS
------------------------------------
06:30 AM - Long Run (10 mi)
03:00 PM - REST

TOP GOALS (TELOS)
------------------------------------
G0: Increase income in 2026
G5: Complete probation (~1 week!)

AI NEWS
------------------------------------
1. Claude 3.6 released
2. GPT-5 preview announced

=====================================
"Discipline over motivation."
=====================================
```

## Files

| File | Purpose |
|------|---------|
| `Tools/briefing.ts` | Main briefing orchestrator |
| `Tools/briefing-on-wake.ts` | Wake-detection daemon |
| `Tools/briefing-daemon.sh` | Optional shell wrapper |
| `Tools/FetchAINews.ts` | AI news fetcher |
| `Config/settings.json` | Configuration |
| `Config/com.pai.dailybriefing.plist` | launchd config (wake-triggered) |
| `Config/com.pai.dailybriefing.plist.fixed-schedule` | Rollback plist (fixed 5:45 AM) |
| `State/last-briefing.json` | Briefing state tracking |
| `State/wake-state.json` | Wake detection state |
| `State/stdout.log` | Standard output log |
| `State/stderr.log` | Error log |

## Health Advisor Logic

| Condition | Recommendation |
|-----------|----------------|
| Sleep < 6h | Suggest lighter workout |
| HRV < 40 | Recovery day recommended |
| Recovery > 80% | Green light |
| 3+ intense days | Suggest active recovery |

---

---

## Technical Summary

**Current Status:** Wake-triggered system installed and operational (2026-01-28)

**Key Components:**
- `briefing-on-wake.ts` - Wake detection orchestrator (24,980 bytes)
- `briefing.ts` - Legacy fixed-schedule tool (17,818 bytes, kept for fallback)
- `com.pai.dailybriefing.plist` - Active launchd config (wake-triggered)
- `com.pai.dailybriefing.plist.fixed-schedule` - Rollback config (fixed 5:45 AM)

**Test Coverage:**
- 133 total tests (97 original + 36 expanded)
- 50% line coverage, 62% function coverage
- 41ms execution time
- All tests passing ✅

**Daemon Configuration:**
- Polls: Every 5 minutes (StartInterval: 300)
- Active: 6:00 AM - 10:00 AM only (self-limiting)
- Logs: `State/stdout.log` and `State/stderr.log`
- State: `State/wake-state.json` (atomic writes)

**Delivery:**
- Bot: YOUR_BRIEFING_BOT (configured in Config/settings.json)
- Chat ID: YOUR_CHAT_ID
- Parse Mode: HTML

*Last updated: 2026-01-28*

---

## Hero Dossier System

The Hero Insight feature delivers personalized wisdom from historical and contemporary heroes, matched to your daily context (recovery, workout, day of week).

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Hero Dossier System                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐    │
│  │ HeroDossier  │────▶│ HeroSelector │────▶│ InsightGenerator │    │
│  │   Parser     │     │              │     │                  │    │
│  └──────────────┘     └──────────────┘     └──────────────────┘    │
│         ▲                    ▲                      │               │
│         │                    │                      ▼               │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐    │
│  │   Markdown   │     │ DailyContext │     │   HeroInsight    │    │
│  │   Dossiers   │     │ (Garmin,Cal) │     │   (to Telegram)  │    │
│  └──────────────┘     └──────────────┘     └──────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Modules

| Module | Purpose | Location |
|--------|---------|----------|
| **HeroDossierParser.ts** | Parses markdown dossiers into HeroCard objects | `Tools/HeroDossierParser.ts` |
| **HeroSelector.ts** | Context-aware hero selection with scoring | `Tools/HeroSelector.ts` |
| **InsightGenerator.ts** | Generates personalized insights with verified quotes | `Tools/InsightGenerator.ts` |
| **ParseHeroes.ts** | CLI tool for cache generation | `Tools/ParseHeroes.ts` |
| **HeroInsight.ts** | Main entry point (backward compatible) | `Tools/HeroInsight.ts` |
| **types.ts** | Type definitions | `Tools/types.ts` |

### Data Files

| File | Purpose |
|------|---------|
| `Data/HeroDossiers/*.md` | Markdown dossier files (7 heroes) |
| `Data/ParsedHeroes/heroes.json` | Cached parsed heroes for performance |

### Current Heroes

| Hero | Domain | Quotes | Context Tags |
|------|--------|--------|--------------|
| Marcus Aurelius | philosophy | 5 | adversity, low-energy, any |
| David Goggins | mental-toughness | 9 | hard-workout, grind, intensity |
| Jocko Willink | leadership | 10 | morning, leadership, discipline |
| Andrew Huberman | neuroscience | 6 | recovery, sleep, science |
| Naval Ravikant | wealth-wisdom | 10 | rest-day, reflection, long-term |
| Seneca | philosophy | 11 | adversity, evening, mortality |
| Eliud Kipchoge | endurance | 12 | race-day, consistency, joy |

### Usage

**CLI Tools:**

```bash
# Generate/update heroes.json cache
bun run ~/.claude/skills/DailyBriefing/Tools/ParseHeroes.ts

# Verify cache integrity
bun run ~/.claude/skills/DailyBriefing/Tools/ParseHeroes.ts --verify

# Show hero statistics
bun run ~/.claude/skills/DailyBriefing/Tools/ParseHeroes.ts --stats

# Force regeneration
bun run ~/.claude/skills/DailyBriefing/Tools/ParseHeroes.ts --force

# Test insight generation
bun run ~/.claude/skills/DailyBriefing/Tools/InsightGenerator.ts
```

**Programmatic API:**

```typescript
import { getHeroInsight, formatHeroInsightForTelegram } from './Tools/HeroInsight.ts';

const context = {
  recoveryScore: 70,
  sleepScore: 75,
  hasWorkout: true,
  workoutType: 'running',
  dayOfWeek: 'Monday',
};

const insight = getHeroInsight(context);
const formatted = formatHeroInsightForTelegram(insight);
```

### Adding a New Hero

1. **Create dossier file** at `Data/HeroDossiers/{hero-id}.md`
2. **Follow the 11-section template**:
   - Section 1: Meta (name, era, domain)
   - Section 2: Core Thesis
   - Section 3: Operating Principles
   - Section 4: Decision Filters
   - Section 5: Failure Modes
   - Section 6: Signature Tactics
   - Section 7: Context Tags
   - Section 8: Application Mapping
   - Section 9: One-Liner
   - Section 10: Quote Bank (verified quotes only)
   - Section 11: Memory Anchors

3. **Regenerate cache**:
   ```bash
   bun run ~/.claude/skills/DailyBriefing/Tools/ParseHeroes.ts --force
   ```

4. **Verify parsing**:
   ```bash
   bun run ~/.claude/skills/DailyBriefing/Tools/ParseHeroes.ts --stats
   ```

### Quote Verification

**Critical:** Only quotes from Section 10 (Quote Bank) are used. Quotes must:
- Be formatted as: `1. **"Quote text"** - Source`
- NOT contain "unverified" or "attribution uncertain"
- Have a verifiable source attribution

### Context-Aware Selection

Heroes are selected based on weighted scoring:

| Factor | Weight | Description |
|--------|--------|-------------|
| Tag Match | 5 pts | Direct match between hero tags and context |
| Domain Relevance | 2-3 pts | Domain matches user's current state |
| State Boost | 4 pts | Special boost for certain hero/state combos |
| Randomness | 0-2 pts | Controlled variety to prevent repetition |

**User States:**
- `low_recovery` - Recovery < 60, favors Stoics
- `high_performance` - Recovery > 80 + workout, favors intensity heroes
- `grind_mode` - Hard workout day, favors Goggins/Jocko
- `rest_day` - No workout, favors reflective heroes
- `monday_start` - Monday, favors energizing heroes
- `adversity` - Important event/challenge day

### Test Coverage

```
Tests: 101 total (4 files)
- HeroDossierParser.test.ts: 31 tests
- HeroSelector.test.ts: 29 tests
- InsightGenerator.test.ts: 25 tests
- Integration.test.ts: 16 tests

Run tests:
bun test ~/.claude/skills/DailyBriefing/Tests/
```

### Example Output (Telegram)

```html
<b>HERO INSIGHT</b>
<i>Marcus Aurelius on philosophy</i>

<b>Principle:</b> Focus only on what you can control

<b>Action:</b> Morning journaling for 10 minutes on today's obstacles

<b>Implementation:</b> If I feel overwhelmed, then I will retreat to my inner citadel.

<b>Reflect:</b> What is within my control right now?

<code>---------------------------------</code>
<i>"The impediment to action advances action. What stands in the way becomes the way."</i>
<i>- Meditations, Book 5</i>
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| No insight generated | Run `ParseHeroes.ts --force` to regenerate cache |
| Quote not found | Check dossier Section 10 has verified quotes |
| Hero not selected | Verify context tags in dossier match scoring rules |
| Cache out of date | Delete `heroes.json` and regenerate |

### Performance

- Cache load: < 5ms
- Hero selection (100x): < 100ms
- Insight generation (50x): < 200ms
