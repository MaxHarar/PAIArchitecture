# Analyze Inbox

Understand your inbox patterns before cleanup.

## Commands

### Full Statistics
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts analyze
```

Shows:
- Total emails
- Unread count
- Spam/trash counts
- Emails by age (week/month/year/older)

### Top Senders
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts top-senders --limit 30
```

Lists senders by email count, shows which have unsubscribe option.

### Find Newsletters
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts newsletters
```

Lists all senders with List-Unsubscribe header (newsletters, marketing).

### List Labels
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts labels
```

Shows all labels with message counts.

## Analysis Strategy

1. Run `analyze` to see overall inbox health
2. Run `top-senders` to identify high-volume senders
3. Run `newsletters` to find unsubscribe candidates
4. Proceed to Cleanup or Unsubscribe workflow
