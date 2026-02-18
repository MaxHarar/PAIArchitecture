"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Session {
  id: string;
  timestamp: string;
  summary?: string;
  messageCount: number;
  toolCalls: number;
  model?: string;
}

interface SessionsResponse {
  total: number;
  sessions: Session[];
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return date.toLocaleDateString("en-US", { weekday: "long" });
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }
  } catch {
    return timestamp;
  }
}

function SessionCard({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className="hover:border-pai-500/50 transition-colors cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-sm">
              {session.summary || `Session ${session.id.slice(0, 8)}...`}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {formatTimestamp(session.timestamp)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-xs">
          <Badge variant="secondary">
            💬 {session.messageCount} messages
          </Badge>
          <Badge variant="secondary">
            🔧 {session.toolCalls} tools
          </Badge>
          {session.model && (
            <Badge variant="outline" className="text-muted-foreground">
              {session.model}
            </Badge>
          )}
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground font-mono">
              ID: {session.id}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Full transcript viewer coming in Phase 3
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SessionsList() {
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) throw new Error("Failed to fetch sessions");
        const data = await res.json();
        setData(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchSessions();
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-24 bg-muted rounded"></div>
          <div className="h-24 bg-muted rounded"></div>
          <div className="h-24 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="pt-4">
            <p className="text-red-400">Error: {error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sessions = data?.sessions || [];
  const filteredSessions = filter
    ? sessions.filter(
        (s) =>
          s.id.toLowerCase().includes(filter.toLowerCase()) ||
          s.summary?.toLowerCase().includes(filter.toLowerCase())
      )
    : sessions;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Session History</h2>
        <Badge variant="secondary">{data?.total || 0} sessions</Badge>
      </div>

      {/* Search filter */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter sessions..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground"
        />
      </div>

      {/* Sessions list */}
      <div className="space-y-3">
        {filteredSessions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {filter ? "No matching sessions" : "No sessions found"}
          </div>
        ) : (
          filteredSessions.slice(0, 50).map((session) => (
            <SessionCard key={session.id} session={session} />
          ))
        )}

        {filteredSessions.length > 50 && (
          <div className="text-center text-xs text-muted-foreground py-4">
            Showing 50 of {filteredSessions.length} sessions
          </div>
        )}
      </div>
    </div>
  );
}
