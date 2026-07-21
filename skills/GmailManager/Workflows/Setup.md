# Gmail Manager Setup

One-time setup for Gmail API access.

## Prerequisites

- Google account
- Existing Google Cloud project (from gcalcli)

## Step 1: Enable Gmail API

1. Go to [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
2. Click **Enable**

## Step 2: Get Client Secret

1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Click on your OAuth 2.0 Client ID
3. Copy the **Client Secret**
4. Add to `~/.claude/skills/GmailManager/Config/settings.json`:
   ```json
   "clientSecret": "YOUR_SECRET_HERE"
   ```

## Step 3: Add OAuth Scopes

1. Go to [OAuth Consent Screen](https://console.cloud.google.com/apis/credentials/consent)
2. Click **Edit App**
3. Under **Scopes**, add:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`

## Step 4: Authorize

```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail-auth.ts
```

Browser opens → authorize → tokens saved.

## Verification

```bash
bun run ~/.claude/skills/GmailManager/Tools/gmail.ts analyze
```

Should show inbox statistics.
