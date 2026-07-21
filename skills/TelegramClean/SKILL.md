---
name: TelegramClean
description: Automatic clean output formatting for Telegram sessions. USE WHEN telegram bot context detected (automatic).
---

# TelegramClean

Automatically detects Telegram bot sessions and switches to minimal output format.

## How It Works

1. **SessionStart hook** detects telegram-bot context
2. Sets `TELEGRAM_CLEAN_OUTPUT=true` environment flag
3. CORE algorithm respects flag and uses minimal format
4. Minimal format = voice output line only, no phases/tables/emojis

## Configuration

Add to `~/.claude/settings.json`:

```json
{
  "telegram": {
    "cleanOutput": true
  }
}
```

Set to `false` to disable auto-detection and use full format on Telegram.

## Detection Logic

Checks for telegram-bot markers:
- Process CWD contains `telegram-bot`
- Environment variable `TELEGRAM_SESSION=true`
- Settings toggle `telegram.cleanOutput` is enabled

## Output Formats

**Full format (desktop):**
- All 7 algorithm phases
- ISC tracker tables
- Emoji icons
- Progress bars

**Clean format (Telegram):**
- Voice output line only
- Plain text
- No tables/emojis
- Mobile-friendly

## Manual Override

Set environment variable to force mode:
```bash
export TELEGRAM_CLEAN_OUTPUT=true   # Force clean
export TELEGRAM_CLEAN_OUTPUT=false  # Force full
```
