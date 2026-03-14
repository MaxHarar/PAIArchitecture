#!/usr/bin/env bun
/**
 * notify-max — Send a proactive message to Max via Telegram.
 *
 * Usage:
 *   bun notify-max.ts "Your message here"
 *   bun notify-max.ts --voice "Message with voice note"
 *   bun notify-max.ts --schedule 300 "Message in 5 minutes"
 *   bun notify-max.ts --schedule "2026-03-01T09:00:00Z" "Scheduled message"
 *
 * This tool calls the gateway's /outbound or /schedule endpoint.
 * Authentication is handled automatically via macOS Keychain.
 */

import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Get gateway token from Keychain
// ---------------------------------------------------------------------------

function getToken(): string {
  try {
    return execSync(
      'security find-generic-password -a "pai-gateway" -s "gateway-token" -w 2>/dev/null',
      { encoding: "utf-8" },
    ).trim();
  } catch {
    console.error("Failed to read gateway token from Keychain");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let voice = false;
let scheduleValue: string | null = null;
const textParts: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--voice" || args[i] === "-v") {
    voice = true;
  } else if (args[i] === "--schedule" || args[i] === "-s") {
    scheduleValue = args[++i];
  } else {
    textParts.push(args[i]);
  }
}

const text = textParts.join(" ").trim();

if (!text) {
  console.error("Usage: bun notify-max.ts [--voice] [--schedule <seconds|ISO>] <message>");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

const token = getToken();
const baseUrl = "http://127.0.0.1:18800";
const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${token}`,
  "Host": "127.0.0.1:18800",
};

async function main() {
  if (scheduleValue) {
    // Schedule for later
    const isNumeric = /^\d+$/.test(scheduleValue);
    const body: Record<string, unknown> = { text, voice };

    if (isNumeric) {
      body.delaySeconds = parseInt(scheduleValue);
    } else {
      body.sendAt = scheduleValue;
    }

    const res = await fetch(`${baseUrl}/schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (res.ok) {
      console.log(`Scheduled: ${(data as { sendAt: string }).sendAt} (id: ${(data as { id: string }).id})`);
    } else {
      console.error("Failed:", JSON.stringify(data));
      process.exit(1);
    }
  } else {
    // Send immediately
    const res = await fetch(`${baseUrl}/outbound`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, voice }),
    });

    const data = await res.json();
    if (res.ok && (data as { success: boolean }).success) {
      console.log(`Sent (id: ${(data as { messageId: string }).messageId})`);
    } else {
      console.error("Failed:", JSON.stringify(data));
      process.exit(1);
    }
  }
}

main();
