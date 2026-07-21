# GenerateBriefing Workflow

Send the daily executive briefing to Telegram.

## Steps

### 1. Run the Briefing Script

```bash
bun run ~/.claude/skills/DailyBriefing/Tools/briefing.ts
```

### 2. Check State

After running, check the state file:

```bash
cat ~/.claude/skills/DailyBriefing/State/last-briefing.json
```

### 3. Troubleshooting

**Telegram not configured:**
- Edit `Config/settings.json` with your bot token and chat ID
- Get token from @BotFather
- Get chat ID from @RawDataBot

**Garmin data missing:**
- Run `python3 ~/.claude/skills/FitnessCoach/Tools/GarminSync.py --days 1`
- Check Garmin credentials

**Calendar empty:**
- Verify gcalcli is configured: `gcalcli list`
- Check calendar names in settings.json

## Manual Trigger

You can manually trigger a briefing anytime:

```bash
# Real send
bun run ~/.claude/skills/DailyBriefing/Tools/briefing.ts

# Test (preview only)
bun run ~/.claude/skills/DailyBriefing/Tools/briefing.ts --test
```
