import path from "path";
import { promises as fs } from "fs";
import { PAI_ROOT, listDirectories, listFiles, readFile } from "./filesystem";

const PROJECTS_DIR = path.join(PAI_ROOT, "projects");

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  timestamp: string;
}

export interface ToolResult {
  id: string;
  toolUseId: string;
  output?: string;
  error?: string;
  timestamp: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  thinking?: string;
}

export interface AgentTrace {
  sessionId: string;
  projectPath: string;
  transcriptPath: string;
  messages: AgentMessage[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  lastUpdated: string;
  isActive: boolean;
}

export interface ActiveSession {
  sessionId: string;
  projectPath: string;
  transcriptPath: string;
  startTime: string;
  lastActivity: string;
  messageCount: number;
  toolCallCount: number;
}

// Parse a single line from JSONL transcript
function parseTranscriptLine(line: string): {
  type: "message" | "tool_use" | "tool_result" | "unknown";
  data: unknown;
  timestamp: string;
} | null {
  try {
    const entry = JSON.parse(line);
    const timestamp = entry.timestamp || new Date().toISOString();

    if (entry.type === "human" || entry.message?.role === "user") {
      return {
        type: "message",
        data: {
          role: "user",
          content: extractContent(entry.message?.content || entry.content),
        },
        timestamp,
      };
    }

    if (entry.type === "assistant" || entry.message?.role === "assistant") {
      const content = entry.message?.content || entry.content;
      const toolCalls: ToolCall[] = [];
      let textContent = "";
      let thinking = "";

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            textContent += block.text || "";
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id || `tool-${Date.now()}`,
              name: block.name,
              input: block.input,
              timestamp,
            });
          } else if (block.type === "thinking") {
            thinking = block.thinking || "";
          }
        }
      } else if (typeof content === "string") {
        textContent = content;
      }

      return {
        type: "message",
        data: {
          role: "assistant",
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          thinking: thinking || undefined,
        },
        timestamp,
      };
    }

    if (entry.type === "tool_result" || entry.tool_result) {
      const result = entry.tool_result || entry;
      return {
        type: "tool_result",
        data: {
          toolUseId: result.tool_use_id || result.id,
          output: extractContent(result.content || result.output),
          error: result.is_error ? extractContent(result.content) : undefined,
        },
        timestamp,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function extractContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    return (content as { text: string }).text;
  }
  return JSON.stringify(content);
}

// Get list of project directories
export async function getProjectDirs(): Promise<string[]> {
  try {
    const dirs = await listDirectories(PROJECTS_DIR);
    return dirs.filter((d) => d.startsWith("-Users-"));
  } catch {
    return [];
  }
}

// Get active/recent sessions
export async function getActiveSessions(): Promise<ActiveSession[]> {
  const projectDirs = await getProjectDirs();
  const sessions: ActiveSession[] = [];

  for (const projectDir of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, projectDir);
    const files = await listFiles(projectPath, ".jsonl");

    for (const file of files) {
      if (file === "history.jsonl") continue;

      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);
      const sessionId = file.replace(".jsonl", "");

      // Only include sessions modified in last 24 hours
      const hoursSinceModified =
        (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
      if (hoursSinceModified > 24) continue;

      // Count messages by reading file
      const content = await readFile(filePath);
      const lines = content?.split("\n").filter((l) => l.trim()) || [];
      let messageCount = 0;
      let toolCallCount = 0;

      for (const line of lines.slice(-100)) {
        // Only check last 100 lines for performance
        const parsed = parseTranscriptLine(line);
        if (parsed?.type === "message") messageCount++;
        if (parsed?.type === "tool_use") toolCallCount++;
      }

      sessions.push({
        sessionId,
        projectPath: projectDir,
        transcriptPath: filePath,
        startTime: stats.birthtime.toISOString(),
        lastActivity: stats.mtime.toISOString(),
        messageCount,
        toolCallCount,
      });
    }
  }

  // Sort by last activity (most recent first)
  return sessions.sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

// Get trace for a specific session
export async function getSessionTrace(
  sessionId: string
): Promise<AgentTrace | null> {
  const projectDirs = await getProjectDirs();

  for (const projectDir of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, projectDir);
    const transcriptPath = path.join(projectPath, `${sessionId}.jsonl`);

    try {
      const content = await readFile(transcriptPath);
      if (!content) continue;

      const lines = content.split("\n").filter((l) => l.trim());
      const messages: AgentMessage[] = [];
      const toolCalls: ToolCall[] = [];
      const toolResults: ToolResult[] = [];
      let lastTimestamp = new Date().toISOString();

      for (const line of lines) {
        const parsed = parseTranscriptLine(line);
        if (!parsed) continue;

        lastTimestamp = parsed.timestamp;

        if (parsed.type === "message") {
          const data = parsed.data as {
            role: "user" | "assistant";
            content: string;
            toolCalls?: ToolCall[];
            thinking?: string;
          };

          messages.push({
            id: `msg-${messages.length}`,
            role: data.role,
            content: data.content,
            timestamp: parsed.timestamp,
            toolCalls: data.toolCalls,
            thinking: data.thinking,
          });

          if (data.toolCalls) {
            toolCalls.push(...data.toolCalls);
          }
        } else if (parsed.type === "tool_result") {
          const data = parsed.data as {
            toolUseId: string;
            output?: string;
            error?: string;
          };

          toolResults.push({
            id: `result-${toolResults.length}`,
            toolUseId: data.toolUseId,
            output: data.output,
            error: data.error,
            timestamp: parsed.timestamp,
          });
        }
      }

      const stats = await fs.stat(transcriptPath);
      const isActive =
        Date.now() - stats.mtime.getTime() < 5 * 60 * 1000; // Active if modified in last 5 minutes

      return {
        sessionId,
        projectPath: projectDir,
        transcriptPath,
        messages,
        toolCalls,
        toolResults,
        lastUpdated: lastTimestamp,
        isActive,
      };
    } catch {
      continue;
    }
  }

  return null;
}

// Get the most recent active session
export async function getCurrentSession(): Promise<ActiveSession | null> {
  const sessions = await getActiveSessions();
  if (sessions.length === 0) return null;

  // Return the most recently active session
  const mostRecent = sessions[0];
  const hoursSinceActivity =
    (Date.now() - new Date(mostRecent.lastActivity).getTime()) /
    (1000 * 60 * 60);

  // Only return if active in last hour
  if (hoursSinceActivity > 1) return null;

  return mostRecent;
}

// Watch a transcript file for changes (returns async iterator)
export async function* watchTranscript(
  transcriptPath: string,
  signal?: AbortSignal
): AsyncGenerator<{ type: string; data: unknown }> {
  let lastSize = 0;

  try {
    const stats = await fs.stat(transcriptPath);
    lastSize = stats.size;
  } catch {
    // File doesn't exist yet, start from 0
  }

  while (!signal?.aborted) {
    try {
      const stats = await fs.stat(transcriptPath);

      if (stats.size > lastSize) {
        // Read new content
        const fd = await fs.open(transcriptPath, "r");
        const buffer = Buffer.alloc(stats.size - lastSize);
        await fd.read(buffer, 0, buffer.length, lastSize);
        await fd.close();

        const newContent = buffer.toString("utf-8");
        const lines = newContent.split("\n").filter((l) => l.trim());

        for (const line of lines) {
          const parsed = parseTranscriptLine(line);
          if (parsed) {
            yield { type: parsed.type, data: parsed.data };
          }
        }

        lastSize = stats.size;
      }

      // Poll every 500ms
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      // File might not exist or be inaccessible
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
