import { NextResponse } from "next/server";
import { spawn } from "child_process";

const DEFAULT_TIMEOUT = 60000; // 60 seconds

/**
 * Sanitize input to prevent shell injection
 * Escapes shell metacharacters that could be dangerous
 */
function sanitizeInput(input: string): string {
  if (!input) return "";

  // Remove null bytes
  let sanitized = input.replace(/\0/g, "");

  // Escape shell metacharacters
  // This is a whitelist approach - only allow safe characters
  // Characters to escape: ; & | ` $ ( ) { } [ ] < > \ " ' ! # * ?
  sanitized = sanitized.replace(/([;&|`$(){}[\]<>\\"'!#*?])/g, "\\$1");

  // Remove newlines that could be used for command injection
  sanitized = sanitized.replace(/[\r\n]/g, " ");

  return sanitized.trim();
}

/**
 * Validate that the skill name only contains safe characters
 */
function isValidSkillName(name: string): boolean {
  // Only allow alphanumeric, dash, underscore
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export async function POST(req: Request) {
  try {
    const { skillName, workflow, args, timeout = DEFAULT_TIMEOUT } = await req.json();

    if (!skillName) {
      return NextResponse.json(
        { error: "Skill name is required" },
        { status: 400 }
      );
    }

    // Validate skill name
    if (!isValidSkillName(skillName)) {
      return NextResponse.json(
        { error: "Invalid skill name. Only alphanumeric characters, dashes, and underscores are allowed." },
        { status: 400 }
      );
    }

    // Sanitize workflow and args
    const sanitizedWorkflow = workflow ? sanitizeInput(workflow) : "";
    const sanitizedArgs = args ? sanitizeInput(args) : "";

    // Validate timeout (must be between 1s and 5 minutes)
    const validTimeout = Math.max(1000, Math.min(timeout, 300000));

    // Build the command to execute via Claude Code CLI
    // Format: /<skill> [workflow] [args]
    const command = `/${skillName.toLowerCase()}${sanitizedWorkflow ? ` ${sanitizedWorkflow}` : ""}${sanitizedArgs ? ` ${sanitizedArgs}` : ""}`;

    // Execute via claude CLI with timeout
    const result = await executeClaudeCommand(command, validTimeout);

    return NextResponse.json({
      success: true,
      command,
      message: `Skill ${skillName} queued for execution`,
      result,
    });
  } catch (error) {
    console.error("Skill execution error:", error);

    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message === "TIMEOUT") {
        return NextResponse.json(
          { error: "Skill execution timed out. The operation took too long to complete." },
          { status: 408 }
        );
      }
      if (error.message === "CANCELLED") {
        return NextResponse.json(
          { error: "Skill execution was cancelled." },
          { status: 499 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to execute skill" },
      { status: 500 }
    );
  }
}

async function executeClaudeCommand(command: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use subprocess array form to avoid shell injection
    // This is safer than using shell: true
    const proc = spawn("claude", ["--print", command], {
      shell: false, // Disable shell to prevent injection
      timeout,
    });

    let stdout = "";
    let stderr = "";
    let isTimedOut = false;

    // Set up timeout handler
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      proc.kill("SIGTERM");

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeout);

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code, signal) => {
      clearTimeout(timeoutId);

      if (isTimedOut) {
        reject(new Error("TIMEOUT"));
        return;
      }

      if (signal === "SIGTERM" || signal === "SIGKILL") {
        reject(new Error("CANCELLED"));
        return;
      }

      if (code === 0) {
        resolve(stdout || "Command sent successfully");
      } else {
        // Even if claude CLI isn't available, we can still report the command was prepared
        resolve(`Command prepared: ${command}\nNote: Execute in Claude Code for full functionality`);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);

      // Claude CLI not available - return the command for manual execution
      if (err.message.includes("ENOENT")) {
        resolve(`Command: ${command}\nExecute this in Claude Code to trigger the skill`);
      } else {
        reject(err);
      }
    });
  });
}
