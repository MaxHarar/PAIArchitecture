---
name: GmailManager
description: Gmail inbox cleanup - mass unsubscribe, bulk delete, organize labels
triggers:
  - "clean email"
  - "gmail"
  - "unsubscribe"
  - "inbox cleanup"
  - "email cleanup"
---

# GmailManager

Gmail inbox management skill for mass cleanup operations.

## Commands

```bash
# Analyze inbox
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts analyze

# Find top senders
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts top-senders --limit 20

# Find newsletters
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts newsletters

# Cleanup (dry run)
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts cleanup --older-than 1y --dry-run

# Cleanup (execute)
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts cleanup --older-than 1y --execute

# Unsubscribe from sender
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts unsubscribe --from "sender@example.com"
```

## Setup

First-time setup requires OAuth authorization:

```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail-auth.ts
```

This opens browser for Google OAuth consent. Tokens are saved to `State/oauth-tokens.json`.

## Workflows

- **Setup.md** - One-time OAuth setup
- **Analyze.md** - Analyze inbox patterns
- **Cleanup.md** - Run cleanup operations
- **Unsubscribe.md** - Mass unsubscribe

## Safety

- Default is `--dry-run` mode (preview only)
- Requires `--execute` flag for actual changes
- Emails go to trash, not permanent delete
- Confirmation required for bulk operations (>100 emails)
