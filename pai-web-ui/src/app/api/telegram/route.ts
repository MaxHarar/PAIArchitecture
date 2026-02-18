import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface TelegramStatus {
  running: boolean;
  botName?: string;
  lastActivity?: string;
  error?: string;
}

export async function GET() {
  try {
    // Check if telegram bot process is running
    const status = await checkTelegramBot();
    return NextResponse.json(status);
  } catch (error) {
    console.error("Telegram status check error:", error);
    return NextResponse.json({
      running: false,
      error: "Failed to check Telegram status",
    });
  }
}

async function checkTelegramBot(): Promise<TelegramStatus> {
  try {
    // Check for running telegram bot processes
    const { stdout } = await execAsync("pgrep -f 'telegram.*bot' || pgrep -f 'TelegramBot' || true");
    const pids = stdout.trim().split("\n").filter(Boolean);

    if (pids.length > 0) {
      return {
        running: true,
        botName: "Jarvis Bot",
        lastActivity: new Date().toISOString(),
      };
    }

    // Check if there's a telegram config indicating the bot should be running
    try {
      await execAsync("test -f ~/.claude/telegram/.env || test -f ~/.claude/skills/Telegram/config.json");
      return {
        running: false,
        botName: "Jarvis Bot",
        error: "Bot configured but not running",
      };
    } catch {
      return {
        running: false,
        error: "Telegram bot not configured",
      };
    }
  } catch {
    return {
      running: false,
      error: "Could not check process status",
    };
  }
}
