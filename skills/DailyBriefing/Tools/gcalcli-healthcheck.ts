#!/usr/bin/env bun
/**
 * Google Calendar Health Check Script
 *
 * Runs weekly (Mondays at 9 AM via launchd) to detect OAuth token expiration.
 * If unhealthy, sends Telegram notification so user can re-authenticate.
 *
 * Re-authentication: Run `gcalcli list` in terminal (opens browser)
 *
 * Usage:
 *   bun run gcalcli-healthcheck.ts          # Check and notify if unhealthy
 *   bun run gcalcli-healthcheck.ts --test   # Check without sending notification
 */

import { execSync, spawnSync } from 'child_process';
import { homedir } from 'os';

const HEALTH_CHECK_TIMEOUT_MS = 10000;

interface CalendarHealthStatus {
  healthy: boolean;
  error?: string;
}

/**
 * Retrieve secret from macOS Keychain
 */
function getKeychainSecret(account: string, service: string = "com.pai.fitness"): string {
  try {
    const result = spawnSync("security", [
      "find-generic-password",
      "-a", account,
      "-s", service,
      "-w",
    ], {
      encoding: "utf-8",
      timeout: 5000,
    });

    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Pre-flight health check for Google Calendar (gcalcli)
 */
function checkCalendarHealth(): CalendarHealthStatus {
  try {
    const result = execSync('gcalcli list 2>&1', {
      encoding: 'utf-8',
      timeout: HEALTH_CHECK_TIMEOUT_MS
    });

    const errorPatterns = [
      'RefreshError',
      'invalid_grant',
      'Token has been expired',
      'Token has been revoked',
      'credentials',
      'Authorization',
      'Traceback'
    ];

    const lowerResult = result.toLowerCase();
    for (const pattern of errorPatterns) {
      if (lowerResult.includes(pattern.toLowerCase())) {
        return {
          healthy: false,
          error: `Calendar auth issue: ${pattern}`
        };
      }
    }

    return { healthy: true };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'killed' in error && (error as { killed?: boolean }).killed) {
      return {
        healthy: false,
        error: 'Health check timed out after 10s'
      };
    }

    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('invalid_grant') ||
        errorMsg.includes('RefreshError') ||
        errorMsg.includes('Token has been expired')) {
      return {
        healthy: false,
        error: 'Calendar OAuth token expired'
      };
    }

    return {
      healthy: false,
      error: `Check failed: ${errorMsg.substring(0, 80)}`
    };
  }
}

/**
 * Send Telegram notification
 */
async function sendTelegramNotification(message: string): Promise<boolean> {
  const botToken = getKeychainSecret("telegram-dailybrief");
  const chatId = process.env.TELEGRAM_CHAT_ID || Bun.env.TELEGRAM_CHAT_ID || "";

  if (!botToken) {
    console.error('Failed to get Telegram bot token from Keychain');
    return false;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const result = await response.json();
    return result.ok === true;
  } catch (error) {
    console.error('Telegram send failed:', error);
    return false;
  }
}

async function main(): Promise<void> {
  const isTest = process.argv.includes('--test');

  console.log(`[${new Date().toISOString()}] Running Google Calendar health check...`);

  const status = checkCalendarHealth();

  if (status.healthy) {
    console.log('Calendar health check: HEALTHY');
    return;
  }

  console.log(`Calendar health check: UNHEALTHY - ${status.error}`);

  const message = `<b>CALENDAR HEALTH ALERT</b>

Google Calendar integration is unavailable.

<b>Error:</b> ${status.error}

<b>To fix:</b>
1. Open Terminal
2. Run: <code>gcalcli list</code>
3. Complete OAuth flow in browser

This will restore calendar events in your daily briefing.`;

  if (isTest) {
    console.log('\n--- TEST OUTPUT (not sent) ---');
    console.log(message.replace(/<[^>]+>/g, ''));
    console.log('--- END TEST OUTPUT ---\n');
    return;
  }

  const sent = await sendTelegramNotification(message);
  if (sent) {
    console.log('Notification sent to Telegram');
  } else {
    console.error('Failed to send notification');
    process.exit(1);
  }
}

main().catch(console.error);
