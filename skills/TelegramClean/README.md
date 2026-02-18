# TelegramClean

Automatic clean output formatting for Telegram bot sessions.

## What It Does

Detects when you're messaging via Telegram and automatically switches to minimal output format:

- **Desktop/CLI:** Full algorithm format with phases, ISC tables, emojis
- **Telegram:** Clean, concise responses - just the information you need

## How It Works

1. **SessionStart hook** (`~/.claude/hooks/TelegramClean.hook.ts`) runs on every session start
2. Detects telegram-bot context by checking:
   - Current working directory contains "telegram-bot"
   - Environment variable `TELEGRAM_SESSION=true`
3. Sets `TELEGRAM_CLEAN_OUTPUT=true` flag
4. Injects system reminder to use minimal format

## Configuration

Settings in `~/.claude/settings.json`:

```json
{
  "telegram": {
    "cleanOutput": true
  }
}
```

Set to `false` to disable auto-detection and use full format everywhere.

## Manual Override

Force clean output mode:
```bash
export TELEGRAM_CLEAN_OUTPUT=true
```

Force full format mode:
```bash
export TELEGRAM_CLEAN_OUTPUT=false
```

## Output Comparison

### Full Format (Desktop)
```
🤖 PAI ALGORITHM ══════════════════════════════════════
   Task: Example task
   [████████████░░░░░░░░] 60% → IDEAL STATE

━━━ 👁️  O B S E R V E ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1/7
[... phases, tables, etc ...]

🗣️ Jarvis: Done!
```

### Clean Format (Telegram)
```
Done!
```

## Installation

Automatically installed when:
1. `TelegramClean/SKILL.md` exists
2. Hook registered in `settings.json` SessionStart
3. `telegram.cleanOutput` setting exists

Already configured! Just restart your Telegram session to see the difference.

## Troubleshooting

**Still seeing full format on Telegram?**
1. Check settings: `telegram.cleanOutput` should be `true`
2. Verify hook is registered in SessionStart hooks array
3. Restart the Telegram bot process

**Want full format on Telegram temporarily?**
```bash
export TELEGRAM_CLEAN_OUTPUT=false
```

**Want clean format on desktop temporarily?**
```bash
export TELEGRAM_CLEAN_OUTPUT=true
```
