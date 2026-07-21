# DailyBriefing State Directory

This directory contains runtime state files for the wake-triggered daily briefing system.

## State Files

| File | Purpose |
|------|---------|
| `wake-state.json` | Tracks wake-triggered briefing state (last sent, wake time, method) |
| `last-briefing.json` | Tracks briefing.ts execution state (success/failure) |
| `stdout.log` | Standard output from launchd daemon |
| `stderr.log` | Error output from launchd daemon |

---

## File Contents

### wake-state.json

```json
{
  "lastSent": "2026-01-28T12:00:00.000Z",  // ISO timestamp of last briefing
  "lastWakeTime": "2026-01-28T11:42:00.000Z",  // Detected wake time from Garmin
  "lastTriggerTime": "2026-01-28T11:57:00.000Z",  // Wake + 15min offset
  "sendMethod": "wake-triggered"  // "wake-triggered" or "fallback"
}
```

**Fields:**
- `lastSent` - When the briefing was last sent (null if never sent)
- `lastWakeTime` - Wake time from Garmin sleep data (null if using fallback)
- `lastTriggerTime` - Calculated trigger time (wake + 15 minutes)
- `sendMethod` - How the briefing was triggered:
  - `wake-triggered` - Sent based on Garmin wake time
  - `fallback` - Sent at fallback hour (8 AM) due to no Garmin data

### last-briefing.json

```json
{
  "lastSent": "2026-01-28T12:00:00.000Z",
  "lastStatus": "success",
  "consecutiveFailures": 0
}
```

---

## Checking System Status

### Is the daemon running?

```bash
launchctl list | grep dailybriefing
```

Expected output shows PID and status:
```
-       0       com.pai.dailybriefing
```
- First column: PID (- if not currently running, number if running)
- Second column: Last exit status (0 = success)
- Third column: Label

### Was a briefing sent today?

```bash
cat ~/.claude/skills/DailyBriefing/State/wake-state.json
```

Check if `lastSent` is today's date.

### View recent daemon activity

```bash
# Last 50 lines of output
tail -50 ~/.claude/skills/DailyBriefing/State/stdout.log

# Last 50 lines of errors
tail -50 ~/.claude/skills/DailyBriefing/State/stderr.log
```

### Check wake detection status

```bash
cat ~/.claude/skills/DailyBriefing/State/wake-state.json | jq .
```

---

## Troubleshooting

### Briefing not sending

1. **Check if daemon is loaded:**
   ```bash
   launchctl list | grep dailybriefing
   ```
   If not listed, load it:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist
   ```

2. **Check time window:**
   - Daemon only checks between 6 AM - 10 AM
   - Outside this window, it exits immediately

3. **Check if already sent today:**
   ```bash
   cat ~/.claude/skills/DailyBriefing/State/wake-state.json
   ```
   If `lastSent` is today, use `--force` to resend:
   ```bash
   bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --force
   ```

4. **Check Garmin data availability:**
   ```bash
   python3 ~/.claude/skills/FitnessCoach/Tools/GarminSync.py --days 7 --output json
   ```
   Look for `sleep.sleepEndTimestampLocal`

5. **Check error logs:**
   ```bash
   tail -100 ~/.claude/skills/DailyBriefing/State/stderr.log
   ```

### Briefing sends at wrong time

1. **Check wake time detection:**
   ```bash
   cat ~/.claude/skills/DailyBriefing/State/wake-state.json | jq .lastWakeTime
   ```

2. **If using fallback (8 AM):**
   - Garmin data may not be available
   - Check Garmin sync is working
   - Verify your watch synced overnight

3. **Adjust timing in config:**
   Edit `~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts` DEFAULT_CONFIG:
   - `wakeOffsetMinutes`: Time after wake to send (default: 15)
   - `fallbackHour`: Fallback time if no Garmin data (default: 8)

### Duplicate briefings

This should not happen. The system checks `lastSent` before sending.

If it does occur:
1. Check if `--force` flag was used
2. Check if state file was corrupted/deleted
3. Check stderr.log for errors

---

## Manual Operations

### Manually trigger briefing (for testing)

```bash
# Dry run - shows what would happen
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --dry-run --debug

# Force send regardless of state
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts --force

# Test with simulated wake time
bun run ~/.claude/skills/DailyBriefing/Tools/briefing-on-wake.ts \
  --test-wake-time "2026-01-28T06:42:00" \
  --dry-run --debug
```

### Reset state (start fresh)

```bash
# Reset wake state
echo '{"lastSent":null,"lastWakeTime":null,"lastTriggerTime":null,"sendMethod":null}' > ~/.claude/skills/DailyBriefing/State/wake-state.json

# Clear logs
> ~/.claude/skills/DailyBriefing/State/stdout.log
> ~/.claude/skills/DailyBriefing/State/stderr.log
```

### Stop the daemon

```bash
launchctl unload ~/Library/LaunchAgents/com.pai.dailybriefing.plist
```

### Restart the daemon

```bash
launchctl unload ~/Library/LaunchAgents/com.pai.dailybriefing.plist
launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist
```

---

## Exit Codes

The daemon uses these exit codes:

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Briefing sent successfully | Normal operation |
| 1 | Not time yet | Normal - outside window or before trigger time |
| 2 | Already sent today | Normal - duplicate prevention working |
| 3 | Error occurred | Check stderr.log |

---

## Run Test Suite

```bash
# Run all tests
~/.claude/skills/DailyBriefing/Tools/test-wake-briefing.sh

# Run specific test (1-5)
~/.claude/skills/DailyBriefing/Tools/test-wake-briefing.sh 3
```

**Tests:**
1. Outside polling window (5:30 AM)
2. Inside window, no wake data (7:00 AM)
3. Simulated wake time (wake 6:42, current 7:00)
4. Force send flag
5. State file verification
