# Cleanup Inbox

Bulk delete old or unwanted emails.

## Safety First

- **Default is dry-run** - preview changes first
- **Emails go to Trash** - not permanently deleted
- **Starred/Important excluded** - protected by default

## Commands

### Preview Old Email Cleanup
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts cleanup --older-than 365d --dry-run
```

### Execute Old Email Cleanup
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts cleanup --older-than 365d --execute
```

### Preview Sender Cleanup
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts cleanup --from "newsletter@example.com" --dry-run
```

### Execute Sender Cleanup
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts cleanup --from "newsletter@example.com" --execute
```

## Recommended Workflow

1. `analyze` - understand inbox size
2. `top-senders` - identify cleanup targets
3. `cleanup --dry-run` - preview what will be deleted
4. `cleanup --execute` - apply changes

## Recovery

Deleted emails go to Trash. Recover within 30 days from Gmail web interface.
