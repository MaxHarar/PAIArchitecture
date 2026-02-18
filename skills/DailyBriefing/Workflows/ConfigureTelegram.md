# ConfigureTelegram Workflow

Set up dedicated Telegram bot for daily briefings.

## Three-Bot Architecture Overview

PAI uses three separate Telegram bots:

| Bot | Purpose | Config Location |
|-----|---------|-----------------|
| **Jarvis Bot** | General AI assistant (two-way) | `~/.claude/settings.json` |
| **MaxsDailyBreifBot** | Morning briefings (one-way) | `~/.claude/skills/DailyBriefing/Config/settings.json` |
| **GogginsFitnessCoachBot** | Wellness questionnaires (two-way) | `~/.claude/skills/FitnessCoach/Config/settings.json` |

This workflow configures the **DailyBriefing bot only**.

## Steps

### 1. Create Your Dedicated Briefing Bot

1. Open Telegram
2. Search for `@BotFather`
3. Send `/newbot`
4. Name: "MaxsDailyBreifBot" (or your preference)
5. Username: must end in `_bot` (e.g., `maxs_daily_breif_bot`)
6. **Save the token** - you'll need it
7. **Important:** This should be a SEPARATE bot from your Jarvis assistant bot

### 2. Get Your Chat ID

1. Search for `@RawDataBot` in Telegram
2. Send `/start`
3. It will reply with your user info including chat ID
4. **Save the chat ID** (a number like `123456789`)

### 3. Update Configuration

Edit `~/.claude/skills/DailyBriefing/Config/settings.json`:

```json
{
  "telegram": {
    "botToken": "YOUR_TOKEN_FROM_BOTFATHER",
    "chatId": "YOUR_CHAT_ID",
    "parseMode": "HTML"
  }
}
```

### 4. Start a Chat with Your Bot

1. Search for your bot by username in Telegram
2. Click "Start" or send `/start`
3. This authorizes the bot to message you

### 5. Test

Test briefing delivery (without Telegram):

```bash
bun run ~/.claude/skills/DailyBriefing/Tools/briefing.ts --test
```

Send real briefing to verify bot token works:

```bash
bun run ~/.claude/skills/DailyBriefing/Tools/briefing.ts
```

**Verify:** Message should arrive in your **DailyBriefing bot chat**, NOT your Jarvis chat.

### 6. Install Wake-Triggered System (Recommended)

The wake-triggered system sends briefings 15 minutes after detected wake time instead of a fixed schedule.

**Install:**

```bash
# Copy wake-triggered plist
cp ~/.claude/skills/DailyBriefing/Config/com.pai.dailybriefing.plist \
   ~/Library/LaunchAgents/

# Load daemon
launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Verify running
launchctl list | grep dailybriefing
# Expected: -	1	com.pai.dailybriefing
```

**How it works:**
- Polls every 5 minutes (6-10 AM window only)
- Detects wake time from Garmin sleep data
- Sends briefing 15 minutes after wake
- Falls back to 8 AM if no Garmin data

**Alternative: Fixed 5:45 AM Schedule**

If you prefer fixed-time delivery:

```bash
# Copy fixed-schedule plist
cp ~/.claude/skills/DailyBriefing/Config/com.pai.dailybriefing.plist.fixed-schedule \
   ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Load daemon
launchctl load ~/Library/LaunchAgents/com.pai.dailybriefing.plist

# Verify
launchctl list | grep dailybriefing
```
