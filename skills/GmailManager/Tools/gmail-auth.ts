#!/usr/bin/env bun
/**
 * Gmail OAuth2 Authentication Flow
 *
 * Usage: bun run gmail-auth.ts
 *
 * Opens browser for Google OAuth consent, saves tokens to State/oauth-tokens.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { createServer } from 'http';

const CONFIG_PATH = `${homedir()}/.claude/skills/GmailManager/Config/settings.json`;
const TOKEN_PATH = `${homedir()}/.claude/skills/GmailManager/State/oauth-tokens.json`;

interface Config {
  oauth: {
    clientId: string;
    clientSecret: string;
    scopes: string[];
    redirectUri: string;
  };
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}

function loadConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveTokens(tokens: Tokens): void {
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Tokens saved to ${TOKEN_PATH}`);
}

async function getAuthUrl(config: Config): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.oauth.clientId,
    redirect_uri: config.oauth.redirectUri,
    response_type: 'code',
    scope: config.oauth.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCodeForTokens(code: string, config: Config): Promise<Tokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      redirect_uri: config.oauth.redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`OAuth error: ${data.error_description || data.error}`);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in * 1000),
    token_type: data.token_type
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.oauth.clientSecret) {
    console.error('Error: clientSecret not set in Config/settings.json');
    console.error('');
    console.error('To get your client secret:');
    console.error('1. Go to https://console.cloud.google.com/apis/credentials');
    console.error('2. Click on your OAuth 2.0 Client ID');
    console.error('3. Copy the Client Secret');
    console.error('4. Add it to Config/settings.json');
    process.exit(1);
  }

  // Start local server to receive OAuth callback
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:3000`);

    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authorization Failed</h1><p>${error}</p>`);
        server.close();
        process.exit(1);
      }

      if (code) {
        try {
          const tokens = await exchangeCodeForTokens(code, config);
          saveTokens(tokens);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <h1>Authorization Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
            <script>window.close();</script>
          `);

          console.log('');
          console.log('Authorization successful!');
          server.close();
          process.exit(0);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error</h1><p>${err}</p>`);
          server.close();
          process.exit(1);
        }
      }
    }
  });

  server.listen(3000, async () => {
    const authUrl = await getAuthUrl(config);
    console.log('Opening browser for Google OAuth consent...');
    console.log('');
    console.log('If browser does not open, visit:');
    console.log(authUrl);
    console.log('');

    // Open browser
    const { execSync } = await import('child_process');
    try {
      execSync(`open "${authUrl}"`);
    } catch {
      console.log('Could not open browser automatically.');
    }

    console.log('Waiting for authorization...');
  });
}

main().catch(console.error);
