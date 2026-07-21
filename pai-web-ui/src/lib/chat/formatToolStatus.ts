/**
 * Tool formatting utilities for displaying Claude's tool usage in the UI.
 * Based on the Telegram bot's formatting patterns.
 */

// Tool icons mapping
const TOOL_ICONS: Record<string, string> = {
  // File operations
  Read: "📖",
  Write: "✏️",
  Edit: "📝",
  Glob: "🔍",
  Grep: "🔎",

  // Execution
  Bash: "💻",
  Task: "🤖",

  // Web
  WebSearch: "🌐",
  WebFetch: "🌍",

  // Skills
  Skill: "⚡",

  // Other
  AskUserQuestion: "❓",
  EnterPlanMode: "📋",
  ExitPlanMode: "✅",

  // Default
  default: "🔧",
};

// Get icon for a tool
export function getToolIcon(toolName: string): string {
  // Check for MCP tools (mcp__server__tool format)
  if (toolName.startsWith("mcp__")) {
    return "🔌";
  }

  return TOOL_ICONS[toolName] || TOOL_ICONS.default;
}

// Format tool input for display
export function formatToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "Read":
      return truncatePath(String(input.file_path || ""));

    case "Write":
    case "Edit":
      return truncatePath(String(input.file_path || ""));

    case "Bash":
      return truncateCommand(String(input.command || ""));

    case "Glob":
      return String(input.pattern || "");

    case "Grep":
      return `"${String(input.pattern || "")}"`;

    case "WebSearch":
      return `"${String(input.query || "")}"`;

    case "WebFetch":
      return truncateUrl(String(input.url || ""));

    case "Task":
      return String(input.description || input.prompt || "").slice(0, 50);

    case "Skill":
      return String(input.skill || "");

    default:
      // For MCP tools, try to extract meaningful info
      if (toolName.startsWith("mcp__")) {
        const parts = toolName.split("__");
        const mcpTool = parts[parts.length - 1];
        return mcpTool || toolName;
      }
      return "";
  }
}

// Format full tool status string
export function formatToolStatus(
  toolName: string,
  input: Record<string, unknown>
): string {
  const icon = getToolIcon(toolName);
  const inputDisplay = formatToolInput(toolName, input);

  if (inputDisplay) {
    return `${icon} ${toolName}: ${inputDisplay}`;
  }
  return `${icon} ${toolName}`;
}

// Get a verb for what the tool is doing
export function getToolVerb(toolName: string): string {
  switch (toolName) {
    case "Read":
      return "Reading";
    case "Write":
      return "Writing";
    case "Edit":
      return "Editing";
    case "Bash":
      return "Running";
    case "Glob":
      return "Searching files";
    case "Grep":
      return "Searching content";
    case "WebSearch":
      return "Searching web";
    case "WebFetch":
      return "Fetching";
    case "Task":
      return "Spawning agent";
    case "Skill":
      return "Executing skill";
    default:
      if (toolName.startsWith("mcp__")) {
        return "Using MCP";
      }
      return "Using";
  }
}

// Helper: truncate file path
function truncatePath(path: string, maxLen = 50): string {
  if (!path) return "";
  if (path.length <= maxLen) return path;

  // Show last part of path
  const parts = path.split("/");
  const filename = parts[parts.length - 1];

  if (filename && filename.length < maxLen - 5) {
    return `.../${filename}`;
  }

  return "..." + path.slice(-maxLen + 3);
}

// Helper: truncate command
function truncateCommand(cmd: string, maxLen = 60): string {
  if (!cmd) return "";

  // Remove newlines
  cmd = cmd.replace(/\n/g, " ").trim();

  if (cmd.length <= maxLen) return cmd;
  return cmd.slice(0, maxLen - 3) + "...";
}

// Helper: truncate URL
function truncateUrl(url: string, maxLen = 50): string {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    if (display.length <= maxLen) return display;
    return display.slice(0, maxLen - 3) + "...";
  } catch {
    if (url.length <= maxLen) return url;
    return url.slice(0, maxLen - 3) + "...";
  }
}
