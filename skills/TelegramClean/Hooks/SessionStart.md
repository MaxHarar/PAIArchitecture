---
hook: SessionStart
priority: 1
description: Detect Telegram context and enable clean output
---

# TelegramClean SessionStart Hook

**Executes:** Before CORE context loads
**Purpose:** Detect telegram-bot sessions and set clean output flag

## Detection Logic

```typescript
const isTelegram =
  process.cwd().includes('telegram-bot') ||
  process.env.TELEGRAM_SESSION === 'true';

const settings = JSON.parse(
  fs.readFileSync(os.homedir() + '/.claude/settings.json', 'utf-8')
);

const cleanOutputEnabled = settings?.telegram?.cleanOutput !== false;

if (isTelegram && cleanOutputEnabled) {
  process.env.TELEGRAM_CLEAN_OUTPUT = 'true';
}
```

## Hook Output

When Telegram context detected:

```xml
<system-reminder>
TelegramClean: Telegram session detected. Using minimal output format.

**Output Rules:**
- Skip all algorithm phases (OBSERVE, THINK, PLAN, BUILD, EXECUTE, VERIFY, LEARN)
- Skip ISC tracker tables
- Skip emojis and formatting
- Output ONLY the voice line content: "🗣️ Jarvis: [message]"

This is a Telegram session. Keep responses concise and mobile-friendly.
</system-reminder>
```

## Manual Override

User can disable by setting in settings.json:
```json
{
  "telegram": {
    "cleanOutput": false
  }
}
```

Or force enable:
```bash
export TELEGRAM_CLEAN_OUTPUT=true
```
