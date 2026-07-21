import { NextResponse } from "next/server";

interface ServiceHealth {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  latency?: number;
  message?: string;
}

async function checkVoiceServer(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch("http://localhost:8888/status", {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latency = Date.now() - start;

    if (response.ok) {
      return {
        name: "Voice Server",
        status: "healthy",
        latency,
        message: "Running on port 8888",
      };
    }

    return {
      name: "Voice Server",
      status: "unhealthy",
      latency,
      message: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: "Voice Server",
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

async function checkTelegramBot(): Promise<ServiceHealth> {
  // Check if telegram bot process is running
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("pgrep -f 'telegram.*bot' || pgrep -f 'TelegramBot' || echo ''");

    if (stdout.trim()) {
      return {
        name: "Telegram Bot",
        status: "healthy",
        message: `PID: ${stdout.trim().split("\n")[0]}`,
      };
    }

    return {
      name: "Telegram Bot",
      status: "unknown",
      message: "Process not detected",
    };
  } catch {
    return {
      name: "Telegram Bot",
      status: "unknown",
      message: "Unable to check status",
    };
  }
}

export async function GET() {
  const [voiceServer, telegramBot] = await Promise.all([
    checkVoiceServer(),
    checkTelegramBot(),
  ]);

  const services = [voiceServer, telegramBot];
  const healthyCount = services.filter((s) => s.status === "healthy").length;

  return NextResponse.json({
    overall: healthyCount === services.length ? "healthy" : "degraded",
    services,
    timestamp: new Date().toISOString(),
  });
}
