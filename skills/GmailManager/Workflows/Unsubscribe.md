# Mass Unsubscribe

Unsubscribe from newsletters and marketing emails.

## Find Unsubscribe Candidates

```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts newsletters
```

Lists all senders with List-Unsubscribe header.

## Preview Unsubscribe

```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts unsubscribe --from "newsletter@example.com" --dry-run
```

Shows what unsubscribe method is available.

## Execute Unsubscribe

```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts unsubscribe --from "newsletter@example.com" --execute
```

## Unsubscribe Methods

### One-Click (Automatic)
If sender supports RFC 8058 one-click unsubscribe, it's automatic.

### URL (Manual)
Some senders require visiting a URL. The tool will show the URL.

### Mailto (Manual)
Some require sending an email. The tool will show the mailto link.

## After Unsubscribing

Consider also cleaning up existing emails:
```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts cleanup --from "newsletter@example.com" --execute
```
