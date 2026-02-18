"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, ChevronDown, ArrowDown, Radio } from "lucide-react";

interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  timestamp: string;
}

interface ToolResult {
  id: string;
  toolUseId: string;
  output?: string;
  error?: string;
  timestamp: string;
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  thinking?: string;
}

interface ActiveSession {
  sessionId: string;
  projectPath: string;
  transcriptPath: string;
  startTime: string;
  lastActivity: string;
  messageCount: number;
  toolCallCount: number;
}

interface AgentTrace {
  sessionId: string;
  messages: AgentMessage[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  lastUpdated: string;
  isActive: boolean;
}

interface SSEEvent {
  type: string;
  session?: ActiveSession;
  data?: unknown;
  message?: string;
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

function ToolCallCard({
  tool,
  result,
  expanded,
  onToggle,
}: {
  tool: ToolCall;
  result?: ToolResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isError = result?.error;

  return (
    <Card
      className={`cursor-pointer transition-colors ${
        isError
          ? "border-red-500/30 hover:border-red-500/50"
          : "hover:border-pai-500/50"
      }`}
      onClick={onToggle}
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔧</span>
            <span className="font-mono text-sm font-medium">{tool.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatTime(tool.timestamp)}
            </span>
            {result ? (
              <Badge variant={isError ? "error" : "success"} className="text-xs">
                {isError ? "Error" : "Done"}
              </Badge>
            ) : (
              <Badge variant="warning" className="text-xs">
                Running
              </Badge>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-2">
            {tool.input !== undefined && tool.input !== null && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Input:</p>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32">
                  {typeof tool.input === "string"
                    ? tool.input
                    : JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>
            )}
            {result && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  {isError ? "Error:" : "Output:"}
                </p>
                <pre
                  className={`text-xs p-2 rounded overflow-x-auto max-h-48 ${
                    isError ? "bg-red-500/10 text-red-400" : "bg-muted"
                  }`}
                >
                  {truncate(result.error || result.output || "", 2000)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MessageCard({ message }: { message: AgentMessage }) {
  const [showThinking, setShowThinking] = useState(false);

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <Card
        className={`max-w-[80%] ${
          isUser ? "bg-pai-500/20 border-pai-500/30" : ""
        }`}
      >
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">{isUser ? "👤" : "🤖"}</span>
            <span className="text-xs font-medium">
              {isUser ? "User" : "Assistant"}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatTime(message.timestamp)}
            </span>
          </div>

          {message.thinking && (
            <button
              className="text-xs text-pai-400 hover:underline mb-2"
              onClick={() => setShowThinking(!showThinking)}
            >
              {showThinking ? "Hide thinking" : "Show thinking"}
            </button>
          )}

          {showThinking && message.thinking && (
            <div className="mb-2 p-2 bg-purple-500/10 border border-purple-500/30 rounded text-xs">
              <p className="text-purple-400 mb-1">💭 Thinking:</p>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {truncate(message.thinking, 500)}
              </p>
            </div>
          )}

          <p className="text-sm whitespace-pre-wrap">
            {truncate(message.content, 500)}
          </p>

          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">
                Tool calls: {message.toolCalls.length}
              </p>
              <div className="flex flex-wrap gap-1">
                {message.toolCalls.map((tc) => (
                  <Badge key={tc.id} variant="secondary" className="text-xs">
                    {tc.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SessionList({
  sessions,
  currentId,
  onSelect,
}: {
  sessions: ActiveSession[];
  currentId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-2">Recent Sessions</p>
      {sessions.map((session) => {
        const isActive = session.sessionId === currentId;
        const timeSince =
          (Date.now() - new Date(session.lastActivity).getTime()) / 1000 / 60;

        return (
          <button
            key={session.sessionId}
            className={`w-full text-left p-2 rounded border transition-colors ${
              isActive
                ? "border-pai-500 bg-pai-500/10"
                : "border-border hover:border-pai-500/50"
            }`}
            onClick={() => onSelect(session.sessionId)}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono truncate max-w-[60%]">
                {session.sessionId.slice(0, 12)}...
              </span>
              {timeSince < 5 && (
                <Badge variant="success" className="text-xs">
                  Active
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>💬 {session.messageCount}</span>
              <span>🔧 {session.toolCallCount}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Tool types for filtering
const TOOL_TYPES = [
  { id: "all", label: "All" },
  { id: "Bash", label: "Bash" },
  { id: "Read", label: "Read" },
  { id: "Write", label: "Write" },
  { id: "Edit", label: "Edit" },
  { id: "Grep", label: "Grep" },
  { id: "Glob", label: "Glob" },
  { id: "Task", label: "Task" },
  { id: "WebFetch", label: "WebFetch" },
  { id: "WebSearch", label: "WebSearch" },
];

export function AgentTraces() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ActiveSession | null>(null);
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const traceEndRef = useRef<HTMLDivElement>(null);

  // Track if user manually selected a session (to prevent auto-switching)
  const [manuallySelected, setManuallySelected] = useState(false);

  // Filtering state
  const [searchQuery, setSearchQuery] = useState("");
  const [toolFilter, setToolFilter] = useState("all");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [collapseAll, setCollapseAll] = useState(false);

  // Fetch initial data
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/agents");
        if (!res.ok) throw new Error("Failed to fetch agents");
        const data = await res.json();
        setSessions(data.sessions || []);

        // Only auto-select if user hasn't manually selected a session
        if (!manuallySelected) {
          setCurrentSession(data.current);

          if (data.current) {
            // Fetch full trace
            const traceRes = await fetch(
              `/api/agents?session=${data.current.sessionId}`
            );
            if (traceRes.ok) {
              const traceData = await traceRes.json();
              setTrace(traceData);
            }
          }
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [manuallySelected]);

  // Connect to SSE stream with exponential backoff reconnection
  useEffect(() => {
    if (typeof window === "undefined") return;

    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isUnmounting = false;

    const MAX_RECONNECT_DELAY = 30000; // 30 seconds max
    const BASE_DELAY = 1000; // 1 second base

    const calculateDelay = (attempts: number): number => {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempts), MAX_RECONNECT_DELAY);
      // Add jitter (0-500ms) to prevent thundering herd
      return delay + Math.random() * 500;
    };

    const connect = () => {
      if (isUnmounting) return;

      eventSource = new EventSource("/api/agents/stream");
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setConnected(true);
        reconnectAttempts = 0; // Reset on successful connection

        // Refresh data after reconnection to catch up on missed events
        // Only if viewing the current session or no manual selection
        if (currentSession && !manuallySelected) {
          fetch(`/api/agents?session=${currentSession.sessionId}`)
            .then((res) => res.json())
            .then((traceData) => setTrace(traceData))
            .catch(console.error);
        }
      };

      eventSource.onmessage = (event) => {
        try {
          const data: SSEEvent = JSON.parse(event.data);

          if (data.type === "connected") {
            setConnected(true);
          } else if (data.type === "session" && data.session) {
            // Only auto-update if user hasn't manually selected a different session
            if (!manuallySelected) {
              setCurrentSession(data.session);
            }
          } else if (data.type === "session_started" && data.session) {
            // Only auto-switch to new session if user hasn't manually selected one
            if (!manuallySelected) {
              setCurrentSession(data.session);
              // Fetch full trace for new session
              fetch(`/api/agents?session=${data.session.sessionId}`)
                .then((res) => res.json())
                .then((traceData) => setTrace(traceData))
                .catch(console.error);
            }
          } else if (data.type === "event") {
            // Handle real-time events
            // Only refresh if viewing current active session or no manual selection
            if (currentSession && !manuallySelected) {
              fetch(`/api/agents?session=${currentSession.sessionId}`)
                .then((res) => res.json())
                .then((traceData) => {
                  setTrace(traceData);
                  // Auto-scroll to bottom
                  traceEndRef.current?.scrollIntoView({ behavior: "smooth" });
                })
                .catch(console.error);
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      eventSource.onerror = () => {
        setConnected(false);
        setReconnecting(true);
        eventSource?.close();

        if (!isUnmounting) {
          // Schedule reconnection with exponential backoff
          const delay = calculateDelay(reconnectAttempts);
          reconnectAttempts++;
          console.log(`SSE disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);

          reconnectTimeout = setTimeout(() => {
            setReconnecting(false);
            connect();
          }, delay);
        }
      };
    };

    connect();

    return () => {
      isUnmounting = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      eventSource?.close();
    };
  }, [currentSession, manuallySelected]);

  // Toggle tool expansion
  const toggleTool = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  // Find result for a tool call
  const getToolResult = (toolId: string): ToolResult | undefined => {
    return trace?.toolResults.find((r) => r.toolUseId === toolId);
  };

  // Filter messages and tool calls
  const filteredMessages = useMemo(() => {
    if (!trace?.messages) return [];

    return trace.messages.filter((message) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesContent = message.content.toLowerCase().includes(query);
        const matchesToolName = message.toolCalls?.some((t) =>
          t.name.toLowerCase().includes(query)
        );
        if (!matchesContent && !matchesToolName) return false;
      }

      // Tool type filter
      if (toolFilter !== "all" && message.toolCalls) {
        const hasMatchingTool = message.toolCalls.some(
          (t) => t.name === toolFilter
        );
        if (!hasMatchingTool && message.role === "assistant") return false;
      }

      return true;
    });
  }, [trace?.messages, searchQuery, toolFilter]);

  // Scroll to latest
  const scrollToLatest = useCallback(() => {
    traceEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Expand/collapse all tools
  const toggleAllTools = useCallback(() => {
    if (collapseAll) {
      // Expand all
      const allToolIds = trace?.toolCalls.map((t) => t.id) || [];
      setExpandedTools(new Set(allToolIds));
    } else {
      // Collapse all
      setExpandedTools(new Set());
    }
    setCollapseAll(!collapseAll);
  }, [collapseAll, trace?.toolCalls]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
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

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Agent Traces</h2>
          <Badge
            variant={connected ? "success" : reconnecting ? "warning" : "error"}
            className="text-xs"
          >
            {connected ? "Connected" : reconnecting ? "Reconnecting..." : "Disconnected"}
            {reconnecting && (
              <span className="ml-1 inline-flex">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>.</span>
                <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>.</span>
              </span>
            )}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search traces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-40 bg-muted rounded-md pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground"
            />
          </div>

          {/* Tool Filter */}
          <div className="relative">
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className="flex items-center gap-1.5 px-2 py-1.5 bg-muted rounded-md text-xs hover:bg-muted/80 transition-colors"
            >
              <Filter className="w-3.5 h-3.5" />
              {toolFilter === "all" ? "All Tools" : toolFilter}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showFilterMenu && (
              <div className="absolute top-full mt-1 right-0 bg-card border border-border rounded-lg shadow-lg z-10 py-1 min-w-[120px]">
                {TOOL_TYPES.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setToolFilter(type.id);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors ${
                      toolFilter === type.id ? "text-pai-400 font-medium" : ""
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Collapse/Expand All */}
          <button
            onClick={toggleAllTools}
            className="px-2 py-1.5 bg-muted rounded-md text-xs hover:bg-muted/80 transition-colors"
            title={collapseAll ? "Expand all" : "Collapse all"}
          >
            {collapseAll ? "Expand" : "Collapse"}
          </button>

          {/* Follow Active Session */}
          {manuallySelected && (
            <button
              onClick={() => {
                setManuallySelected(false);
                // Will auto-select active session on next data fetch
              }}
              className="flex items-center gap-1 px-2 py-1.5 bg-green-500/20 text-green-400 rounded-md text-xs hover:bg-green-500/30 transition-colors"
              title="Follow active session"
            >
              <Radio className="w-3.5 h-3.5" />
              Follow Active
            </button>
          )}

          {/* Scroll to Latest */}
          <button
            onClick={scrollToLatest}
            className="flex items-center gap-1 px-2 py-1.5 bg-pai-500/20 text-pai-400 rounded-md text-xs hover:bg-pai-500/30 transition-colors"
            title="Scroll to latest"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Latest
          </button>

          <Badge variant="secondary">{sessions.length} sessions</Badge>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {/* Session list sidebar */}
        <div className="col-span-1">
          {sessions.length > 0 ? (
            <SessionList
              sessions={sessions}
              currentId={currentSession?.sessionId}
              onSelect={async (id) => {
                const session = sessions.find((s) => s.sessionId === id);
                if (session) {
                  setManuallySelected(true); // Mark as manually selected
                  setCurrentSession(session);
                  const res = await fetch(`/api/agents?session=${id}`);
                  if (res.ok) {
                    setTrace(await res.json());
                  }
                }
              }}
            />
          ) : (
            <div className="text-center text-muted-foreground py-4 text-sm">
              No recent sessions
            </div>
          )}
        </div>

        {/* Main trace view */}
        <div className="col-span-3">
          {!currentSession ? (
            <div className="text-center text-muted-foreground py-12">
              <p className="text-lg mb-2">🤖 No Active Session</p>
              <p className="text-sm">
                Start a Claude session to see real-time agent traces here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Session info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span>Session: {currentSession.sessionId.slice(0, 16)}...</span>
                    {trace?.isActive && (
                      <Badge variant="success" className="text-xs">
                        Active
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>💬 {trace?.messages.length || 0} messages</span>
                    <span>🔧 {trace?.toolCalls.length || 0} tool calls</span>
                    <span>Last: {formatTime(currentSession.lastActivity)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Messages and tool calls */}
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                {filteredMessages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8 text-sm">
                    {searchQuery || toolFilter !== "all"
                      ? "No traces match your filters"
                      : "No messages yet"}
                  </div>
                ) : (
                  filteredMessages.map((message) => (
                    <div key={message.id} className="space-y-2">
                      <MessageCard message={message} />

                      {/* Show tool calls inline (filtered by tool type) */}
                      {message.toolCalls
                        ?.filter(
                          (tool) =>
                            toolFilter === "all" || tool.name === toolFilter
                        )
                        .map((tool) => (
                          <div key={tool.id} className="ml-8">
                            <ToolCallCard
                              tool={tool}
                              result={getToolResult(tool.id)}
                              expanded={!collapseAll && expandedTools.has(tool.id)}
                              onToggle={() => toggleTool(tool.id)}
                            />
                          </div>
                        ))}
                    </div>
                  ))
                )}
                <div ref={traceEndRef} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
