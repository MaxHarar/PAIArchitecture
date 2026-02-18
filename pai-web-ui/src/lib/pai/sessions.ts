import path from "path";
import { PAI_ROOT, readFile, fileExists } from "./filesystem";

export interface Session {
  id: string;
  timestamp: string;
  summary?: string;
  messageCount: number;
  toolCalls: number;
  duration?: number;
  model?: string;
}

export interface SessionDetails extends Session {
  messages: SessionMessage[];
}

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  toolUse?: {
    name: string;
    input?: unknown;
  }[];
}

const HISTORY_FILE = path.join(PAI_ROOT, "history.jsonl");

interface HistoryEntry {
  session_id?: string;
  timestamp?: string;
  type?: string;
  message?: {
    role?: string;
    content?: string | { type: string; text?: string }[];
  };
  tool_use?: {
    name: string;
    input?: unknown;
  };
  model?: string;
  summary?: string;
}

export async function getSessions(): Promise<Session[]> {
  const content = await readFile(HISTORY_FILE);
  if (!content) return [];

  const lines = content.trim().split("\n");
  const sessionsMap = new Map<string, Session>();

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as HistoryEntry;
      const sessionId = entry.session_id || "unknown";

      if (!sessionsMap.has(sessionId)) {
        sessionsMap.set(sessionId, {
          id: sessionId,
          timestamp: entry.timestamp || new Date().toISOString(),
          messageCount: 0,
          toolCalls: 0,
          model: entry.model,
        });
      }

      const session = sessionsMap.get(sessionId)!;

      if (entry.message) {
        session.messageCount++;
      }

      if (entry.tool_use) {
        session.toolCalls++;
      }

      if (entry.summary) {
        session.summary = entry.summary;
      }

      // Update timestamp to latest
      if (entry.timestamp && entry.timestamp > session.timestamp) {
        session.timestamp = entry.timestamp;
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Convert to array and sort by timestamp (newest first)
  return Array.from(sessionsMap.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getSessionDetails(sessionId: string): Promise<SessionDetails | null> {
  const content = await readFile(HISTORY_FILE);
  if (!content) return null;

  const lines = content.trim().split("\n");
  const messages: SessionMessage[] = [];
  let session: Session | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as HistoryEntry;

      if (entry.session_id !== sessionId) continue;

      if (!session) {
        session = {
          id: sessionId,
          timestamp: entry.timestamp || new Date().toISOString(),
          messageCount: 0,
          toolCalls: 0,
          model: entry.model,
        };
      }

      if (entry.message) {
        const role = entry.message.role as "user" | "assistant" | "system";
        let content = "";

        if (typeof entry.message.content === "string") {
          content = entry.message.content;
        } else if (Array.isArray(entry.message.content)) {
          content = entry.message.content
            .filter((c) => c.type === "text" && c.text)
            .map((c) => c.text)
            .join("\n");
        }

        messages.push({
          role,
          content,
          timestamp: entry.timestamp,
        });

        session.messageCount++;
      }

      if (entry.tool_use) {
        // Attach tool use to the last assistant message
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          if (!lastAssistant.toolUse) {
            lastAssistant.toolUse = [];
          }
          lastAssistant.toolUse.push(entry.tool_use);
        }
        session.toolCalls++;
      }

      if (entry.summary) {
        session.summary = entry.summary;
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (!session) return null;

  return {
    ...session,
    messages,
  };
}

export async function searchSessions(query: string): Promise<Session[]> {
  const sessions = await getSessions();
  const lowerQuery = query.toLowerCase();

  return sessions.filter((session) => {
    if (session.id.toLowerCase().includes(lowerQuery)) return true;
    if (session.summary?.toLowerCase().includes(lowerQuery)) return true;
    return false;
  });
}
