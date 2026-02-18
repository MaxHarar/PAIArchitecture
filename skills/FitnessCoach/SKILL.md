---
name: FitnessCoach
description: Personal fitness coaching with Garmin + Google Calendar integration. USE WHEN workout plan, training plan, weekly plan, fitness, garmin data, sync garmin, running plan, lifting plan.
---

# FitnessCoach

Personal AI fitness coach that syncs Garmin data and manages training schedules via Google Calendar.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "weekly plan", "plan my week", "training plan" | `Workflows/WeeklyPlan.md` |
| "sync garmin", "pull garmin", "garmin data" | `Workflows/SyncGarmin.md` |
| "add workout", "update calendar" | `Workflows/UpdateCalendar.md` |
| "fitness stats", "training stats" | `Workflows/Stats.md` |
| "readiness", "training readiness", "recovery", "should I train", "am I recovered" | `Workflows/TrainingReadiness.md` |

## Quick Reference

**Garmin Tokens:** `~/.claude/garmin-tokens/`
**Training Plan:** `~/.claude/training-plan-*.md`
**Calendars:** "75 hard" (all workouts), "Runna" (running only)
**Fitness Database:** `~/.claude/fitness/workouts.db`

**Data Available:**
- Activities (runs, strength, yoga)
- Heart rate (resting, zones, workout HR)
- Sleep data (score, duration, stages)
- HRV data (RMSSD, status, baseline)
- Body battery and recovery metrics
- Training readiness assessment

## Tools

| Tool | Purpose |
|------|---------|
| `Tools/GarminSync.py` | Pull latest Garmin data (activities, sleep, HRV) |
| `Tools/training-readiness.ts` | Assess training readiness from daily metrics |
| `Tools/wellness-check.ts` | CLI wellness questionnaire |
| `Tools/fitness-bot.ts` | Interactive Telegram bot for wellness checks |
| gcalcli | Google Calendar CLI (external) |

## FitnessBot (Telegram)

Interactive Telegram bot (GogginsFitnessCoachBot) for wellness questionnaires and readiness checks.

### Three-Bot Architecture

PAI uses three separate Telegram bots:

| Bot | Purpose | Direction | Config Location |
|-----|---------|-----------|-----------------|
| **Jarvis Bot** | General AI assistant | Two-way | `~/.claude/settings.json` |
| **MaxsDailyBreifBot** | Morning briefings | One-way | `~/.claude/skills/DailyBriefing/Config/settings.json` |
| **GogginsFitnessCoachBot** | Wellness questionnaires | Two-way | `~/.claude/skills/FitnessCoach/Config/settings.json` |

This skill manages the **FitnessCoach bot only**.

### Commands

| Command | Description |
|---------|-------------|
| `/wellness` | Start morning wellness questionnaire (4 questions with inline buttons) |
| `/readiness` | Show current training readiness score |
| `/help` | Show available commands |

### Setup

1. **Create a dedicated Telegram bot** via @BotFather:
   - Send `/newbot` to @BotFather
   - Name: "GogginsFitnessCoachBot" (or your preference)
   - Copy the bot token
   - **Important:** This is SEPARATE from your Jarvis assistant and DailyBriefing bots

2. **Get your chat ID**:
   - Send a message to your new bot
   - Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Find `chat.id` in the response

3. **Configure settings.json** at `~/.claude/skills/FitnessCoach/Config/settings.json`:
   ```json
   {
     "fitnessBot": {
       "botToken": "YOUR_BOT_TOKEN",
       "chatId": "YOUR_CHAT_ID",
       "pollInterval": 1000
     }
   }
   ```

   **Note:** Do NOT use the same token as DailyBriefing or Jarvis.

4. **Test the bot**:
   ```bash
   bun run ~/.claude/skills/FitnessCoach/Tools/fitness-bot.ts --test
   ```

5. **Install the daemon** (auto-start on boot):
   ```bash
   # Copy plist to LaunchAgents
   cp ~/.claude/skills/FitnessCoach/Config/com.pai.fitnessbot.plist ~/Library/LaunchAgents/

   # Load the daemon
   launchctl load ~/Library/LaunchAgents/com.pai.fitnessbot.plist

   # Check status
   launchctl list | grep fitnessbot
   ```

6. **Manage the daemon**:
   ```bash
   # Stop
   launchctl unload ~/Library/LaunchAgents/com.pai.fitnessbot.plist

   # Start
   launchctl load ~/Library/LaunchAgents/com.pai.fitnessbot.plist

   # View logs
   tail -f ~/.claude/skills/FitnessCoach/Logs/fitness-bot.log
   tail -f ~/.claude/skills/FitnessCoach/Logs/fitness-bot.error.log
   ```

### Wellness Questionnaire Flow

1. User sends `/wellness`
2. Bot displays: "Rate your sleep quality (1-10)" with inline buttons [1-10]
3. User taps a button
4. Bot displays: "Rate your muscle soreness (1-10)"
5. Repeat for stress level and mood
6. Bot calculates wellness score (0-100) and stores in database
7. Bot displays summary with training readiness recommendation

### Database

Wellness data stored in `~/.claude/fitness/workouts.db` table `daily_wellness`:
- `date` (PRIMARY KEY)
- `sleep_quality` (1-10)
- `muscle_soreness` (1-10)
- `stress_level` (1-10)
- `mood` (1-10)
- `wellness_score` (0-100, calculated)
- `notes` (optional)

## Configuration

**Garmin:** YOUR_GARMIN_EMAIL (tokens stored in garmin-tokens/)
**Weekly Structure:**
- Monday: REST or Light
- Tuesday: Legs AM, Recovery PM
- Wednesday: Chest AM, Speed Work PM
- Thursday: Easy Run AM, Back PM
- Friday: Full Body AM, Recovery PM
- Saturday: Long Run AM
- Sunday: REST
