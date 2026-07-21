"use client";

import { useState } from "react";

interface ToolEvent {
  id: string;
  name: string;
  input: string;
  timestamp: Date;
}

interface ToolActivityProps {
  tools: ToolEvent[];
  currentTool: ToolEvent | null;
  thinking: string | null;
  isExpanded?: boolean;
}

// Tool icons mapping
const TOOL_ICONS: Record<string, string> = {
  Read: "📖",
  Write: "✏️",
  Edit: "📝",
  Glob: "🔍",
  Grep: "🔎",
  Bash: "💻",
  Task: "🤖",
  WebSearch: "🌐",
  WebFetch: "🌍",
  Skill: "⚡",
  AskUserQuestion: "❓",
  default: "🔧",
};

function getToolIcon(name: string): string {
  if (name.startsWith("mcp__")) return "🔌";
  return TOOL_ICONS[name] || TOOL_ICONS.default;
}

function getToolVerb(name: string): string {
  switch (name) {
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
      return "Using";
  }
}

export function ToolActivity({
  tools,
  currentTool,
  thinking,
  isExpanded: initialExpanded = false,
}: ToolActivityProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  const hasActivity = tools.length > 0 || currentTool || thinking;

  if (!hasActivity) return null;

  return (
    <div className="border-t border-border bg-muted/30">
      {/* Current activity header */}
      <div
        className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {currentTool ? (
            <>
              <span className="animate-pulse">{getToolIcon(currentTool.name)}</span>
              <span className="text-sm font-medium">
                {getToolVerb(currentTool.name)}
              </span>
              <span className="text-sm text-muted-foreground truncate max-w-[300px]">
                {currentTool.input}
              </span>
            </>
          ) : thinking ? (
            <>
              <span className="animate-pulse">🧠</span>
              <span className="text-sm font-medium">Thinking...</span>
            </>
          ) : (
            <>
              <span>✅</span>
              <span className="text-sm text-muted-foreground">
                {tools.length} tool{tools.length !== 1 ? "s" : ""} used
              </span>
            </>
          )}
        </div>

        <button className="text-xs text-muted-foreground hover:text-foreground">
          {isExpanded ? "▼ Hide" : "▶ Show"} activity
        </button>
      </div>

      {/* Expanded activity log */}
      {isExpanded && (
        <div className="px-4 pb-3 space-y-1 max-h-48 overflow-y-auto">
          {/* Thinking preview */}
          {thinking && (
            <div className="flex items-start gap-2 text-xs p-2 bg-purple-500/10 border border-purple-500/20 rounded">
              <span>🧠</span>
              <div className="flex-1">
                <p className="text-purple-400 font-medium">Thinking</p>
                <p className="text-muted-foreground mt-0.5 line-clamp-3">
                  {thinking}
                </p>
              </div>
            </div>
          )}

          {/* Tool history */}
          {tools.map((tool) => (
            <div
              key={tool.id}
              className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${
                currentTool?.id === tool.id
                  ? "bg-pai-500/20 border border-pai-500/30"
                  : "bg-muted/50"
              }`}
            >
              <span>{getToolIcon(tool.name)}</span>
              <span className="font-medium">{tool.name}</span>
              <span className="text-muted-foreground truncate flex-1">
                {tool.input}
              </span>
              <span className="text-muted-foreground">
                {formatTime(tool.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
