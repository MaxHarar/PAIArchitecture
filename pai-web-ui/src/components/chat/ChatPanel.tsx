"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { VoiceInput } from "./VoiceInput";
import { ToolActivity } from "./ToolActivity";
import { voiceQueue } from "@/lib/voice/VoiceQueue";
import { activityState } from "@/lib/activity/ActivityStateManager";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ToolEvent {
  id: string;
  name: string;
  input: string;
  timestamp: Date;
}

interface SkillSuggestion {
  name: string;
  trigger: string;
  description: string;
}

const SKILL_PATTERNS: { pattern: RegExp; skill: SkillSuggestion }[] = [
  {
    pattern: /research|find out|look up|investigate|search/i,
    skill: {
      name: "Research",
      trigger: "/research",
      description: "Deep research and analysis",
    },
  },
  {
    pattern: /screenshot|browser|webpage|website|open url/i,
    skill: {
      name: "Browser",
      trigger: "/browser",
      description: "Web automation and screenshots",
    },
  },
  {
    pattern: /image|picture|visual|diagram|art|illustration/i,
    skill: {
      name: "Art",
      trigger: "/art",
      description: "Create visual content",
    },
  },
  {
    pattern: /osint|background check|due diligence|intel/i,
    skill: {
      name: "OSINT",
      trigger: "/osint",
      description: "Open source intelligence",
    },
  },
  {
    pattern: /red team|attack|vulnerab|critique|stress test/i,
    skill: {
      name: "RedTeam",
      trigger: "/redteam",
      description: "Adversarial analysis",
    },
  },
  {
    pattern: /first principles|fundamental|root cause|why/i,
    skill: {
      name: "FirstPrinciples",
      trigger: "/firstprinciples",
      description: "Fundamental analysis",
    },
  },
  {
    pattern: /workout|fitness|exercise|training|gym/i,
    skill: {
      name: "FitnessCoach",
      trigger: "/fitness",
      description: "Workout planning",
    },
  },
];

function getSuggestions(input: string): SkillSuggestion[] {
  if (!input || input.length < 3) return [];

  const suggestions: SkillSuggestion[] = [];
  for (const { pattern, skill } of SKILL_PATTERNS) {
    if (pattern.test(input)) {
      suggestions.push(skill);
    }
  }
  return suggestions.slice(0, 3);
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="text-sm whitespace-pre-wrap">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) {
          return (
            <h4 key={i} className="font-semibold text-sm mt-2 mb-1">
              {line.slice(4)}
            </h4>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3 key={i} className="font-semibold mt-2 mb-1">
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={i} className="font-bold mt-2 mb-1">
              {line.slice(2)}
            </h2>
          );
        }
        if (line.includes("`")) {
          const parts = line.split(/`([^`]+)`/);
          return (
            <p key={i}>
              {parts.map((part, j) =>
                j % 2 === 1 ? (
                  <code
                    key={j}
                    className="bg-muted px-1 py-0.5 rounded text-xs font-mono"
                  >
                    {part}
                  </code>
                ) : (
                  part
                )
              )}
            </p>
          );
        }
        if (line.includes("**")) {
          const parts = line.split(/\*\*([^*]+)\*\*/);
          return (
            <p key={i}>
              {parts.map((part, j) =>
                j % 2 === 1 ? <strong key={j}>{part}</strong> : part
              )}
            </p>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <li key={i} className="ml-4 list-disc">
              {line.slice(2)}
            </li>
          );
        }
        if (!line.trim()) {
          return <br key={i} />;
        }
        return <span key={i}>{line}</span>;
      })}
    </div>
  );
}

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Welcome to the PAI Command Center, Max. This is a full-featured interface for complex tasks - I can research, execute skills, and work on multi-step projects. How can I help you today?",
};

// LocalStorage keys for persistence
const STORAGE_KEYS = {
  MESSAGES: "pai-chat-messages",
  SESSION_ID: "pai-chat-session-id",
  INPUT_DRAFT: "pai-chat-input-draft",
} as const;

// Load persisted chat state from localStorage
function loadPersistedState(): {
  messages: Message[];
  sessionId: string | null;
  inputDraft: string;
} {
  if (typeof window === "undefined") {
    return { messages: [WELCOME_MESSAGE], sessionId: null, inputDraft: "" };
  }

  try {
    const messagesJson = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    const sessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID);
    const inputDraft = localStorage.getItem(STORAGE_KEYS.INPUT_DRAFT) || "";

    const messages = messagesJson
      ? JSON.parse(messagesJson)
      : [WELCOME_MESSAGE];

    return { messages, sessionId, inputDraft };
  } catch (error) {
    console.error("Failed to load persisted chat state:", error);
    return { messages: [WELCOME_MESSAGE], sessionId: null, inputDraft: "" };
  }
}

// Save chat state to localStorage
function savePersistedState(
  messages: Message[],
  sessionId: string | null,
  inputDraft: string
): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
    if (sessionId) {
      localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
    }
    localStorage.setItem(STORAGE_KEYS.INPUT_DRAFT, inputDraft);
  } catch (error) {
    console.error("Failed to save chat state:", error);
  }
}

// Clear persisted chat (for new session)
function clearPersistedState(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
    localStorage.removeItem(STORAGE_KEYS.INPUT_DRAFT);
  } catch (error) {
    console.error("Failed to clear chat state:", error);
  }
}

// Format elapsed time
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export function ChatPanel() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<SkillSuggestion[]>([]);

  // Load persisted state on mount
  const [isInitialized, setIsInitialized] = useState(false);
  const persistedState = !isInitialized ? loadPersistedState() : null;

  const [input, setInput] = useState(persistedState?.inputDraft || "");
  const [messages, setMessages] = useState<Message[]>(
    persistedState?.messages || [WELCOME_MESSAGE]
  );
  const [sessionId, setSessionId] = useState<string | null>(
    persistedState?.sessionId || null
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);

  // Activity tracking
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [currentTool, setCurrentTool] = useState<ToolEvent | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Mark as initialized after first render
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  // Persist state whenever messages, sessionId, or input changes
  useEffect(() => {
    if (isInitialized) {
      savePersistedState(messages, sessionId, input);
    }
  }, [messages, sessionId, input, isInitialized]);

  // Timer for elapsed time
  useEffect(() => {
    if (!startTime) {
      setElapsedTime(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  // Sync voice queue enabled state
  useEffect(() => {
    voiceQueue.setEnabled(voiceOutputEnabled);
  }, [voiceOutputEnabled]);

  // Handle voice transcript
  const handleVoiceTranscript = useCallback((text: string) => {
    if (text.trim()) {
      setInput(text);
      setTimeout(() => {
        inputRef.current?.form?.requestSubmit();
      }, 100);
    }
  }, []);

  // Cancel request
  const handleCancel = async () => {
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel: true, messages: [] }),
      });
    } catch {
      // Ignore errors
    }
    setIsLoading(false);
    setStartTime(null);
    setCurrentTool(null);
    setThinking(null);

    // Ensure activity is cleared
    activityState.clearActivity();
  };

  // Handle form submission with comprehensive event handling
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const messageText = input.trim();
    setInput("");
    setError(null);
    setTools([]);
    setCurrentTool(null);
    setThinking(null);

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: messageText,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStartTime(Date.now());

    // Create placeholder for assistant message
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      // Handle SSE streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);

              try {
                const event = JSON.parse(data);

                switch (event.type) {
                  case "status":
                    // Status updates (starting, etc.)
                    break;

                  case "session":
                    setSessionId(event.sessionId);
                    break;

                  case "thinking":
                    setThinking(event.content);

                    // Update activity state for avatar
                    activityState.setActivity(null, event.content, true);
                    break;

                  case "tool":
                    const toolEvent: ToolEvent = {
                      id: `tool-${Date.now()}-${Math.random()}`,
                      name: event.name,
                      input: event.input || "",
                      timestamp: new Date(),
                    };
                    setCurrentTool(toolEvent);
                    setTools((prev) => [...prev, toolEvent]);
                    setThinking(null); // Clear thinking when tool starts

                    // Update activity state for avatar
                    activityState.setActivity(event.name, event.input);
                    break;

                  case "text":
                    fullContent = event.content;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, content: fullContent }
                          : m
                      )
                    );
                    setCurrentTool(null); // Clear current tool when text comes
                    setThinking(null);

                    // Clear activity state (back to default)
                    activityState.clearActivity();
                    break;

                  case "result":
                    // Response complete with usage info
                    console.log("Token usage:", event.usage);
                    break;

                  case "done":
                    // All done
                    break;

                  case "cancelled":
                    // Request was cancelled
                    break;

                  case "error":
                    throw new Error(event.message);
                }
              } catch (parseErr) {
                // Ignore parse errors for incomplete chunks
                if (parseErr instanceof SyntaxError) continue;
                throw parseErr;
              }
            }
          }
        }
      }

      // Queue for voice output if enabled
      if (voiceOutputEnabled && fullContent) {
        voiceQueue.enqueue(fullContent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      // Remove the empty assistant message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setIsLoading(false);
      setStartTime(null);
      setCurrentTool(null);
      setThinking(null);

      // Ensure activity is cleared
      activityState.clearActivity();
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update suggestions based on input
  useEffect(() => {
    setSuggestions(getSuggestions(input));
  }, [input]);

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: SkillSuggestion) => {
    const newInput = `${suggestion.trigger} ${input}`;
    setInput(newInput);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat header with status */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="font-semibold">Chat with Jarvis</h2>
              <p className="text-xs text-muted-foreground">
                Full-featured command center
                {messages.length > 1 && " • Chat persists on refresh"}
              </p>
            </div>
            {sessionId && (
              <Badge variant="secondary" className="text-xs">
                Session: {sessionId}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 1 && !isLoading && (
              <button
                onClick={() => {
                  setMessages([WELCOME_MESSAGE]);
                  setSessionId(null);
                  setInput("");
                  clearPersistedState();
                }}
                className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 border border-border rounded transition-colors"
                title="Start new conversation"
              >
                New Chat
              </button>
            )}
            {isLoading && (
              <>
                <Badge variant="secondary" className="text-xs">
                  ⏱️ {formatElapsed(elapsedTime)}
                </Badge>
                <button
                  onClick={handleCancel}
                  className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tool activity panel */}
      {isLoading && (tools.length > 0 || currentTool || thinking) && (
        <ToolActivity
          tools={tools}
          currentTool={currentTool}
          thinking={thinking}
          isExpanded={true}
        />
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-lg p-3 ${
                message.role === "user"
                  ? "bg-pai-500/20 border border-pai-500/30"
                  : "bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">
                  {message.role === "user" ? "👤" : "🤖"}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {message.role === "user" ? "You" : "Jarvis"}
                </span>
              </div>
              {message.content ? (
                <MessageContent content={message.content} />
              ) : isLoading && message.role === "assistant" ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">●</span>
                  {currentTool
                    ? `Using ${currentTool.name}...`
                    : thinking
                    ? "Thinking..."
                    : "Working..."}
                </div>
              ) : null}

              {/* Show skill badges if mentioned */}
              {message.role === "assistant" &&
                message.content &&
                SKILL_PATTERNS.some(({ skill }) =>
                  message.content.toLowerCase().includes(skill.trigger)
                ) && (
                  <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-1">
                    {SKILL_PATTERNS.filter(({ skill }) =>
                      message.content.toLowerCase().includes(skill.trigger)
                    ).map(({ skill }) => (
                      <Badge
                        key={skill.name}
                        variant="secondary"
                        className="text-xs"
                      >
                        {skill.trigger}
                      </Badge>
                    ))}
                  </div>
                )}
            </div>
          </div>
        ))}

        {/* Error display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-sm text-red-400">Error: {error}</p>
            <button
              onClick={() => setError(null)}
              className="mt-2 text-xs text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="px-4 pb-2">
          <p className="text-xs text-muted-foreground mb-1">
            Suggested skills:
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.name}
                onClick={() => handleSuggestionClick(suggestion)}
                className="flex items-center gap-1 px-2 py-1 bg-pai-500/10 hover:bg-pai-500/20 border border-pai-500/30 rounded-md text-xs transition-colors"
              >
                <span className="font-mono text-pai-400">
                  {suggestion.trigger}
                </span>
                <span className="text-muted-foreground">
                  {suggestion.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-4 border-t border-border">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <VoiceInput
            onTranscript={handleVoiceTranscript}
            disabled={isLoading}
          />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Type a message or press V to speak..."
            disabled={isLoading}
            className="flex-1 bg-muted rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-pai-500 hover:bg-pai-600 text-white rounded-md text-sm disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </form>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">
            Full agentic capabilities - research, skills, complex tasks
          </p>
          <button
            type="button"
            onClick={() => setVoiceOutputEnabled(!voiceOutputEnabled)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              voiceOutputEnabled
                ? "bg-pai-500/20 text-pai-400 border border-pai-500/30"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
            title={
              voiceOutputEnabled
                ? "Disable voice responses"
                : "Enable voice responses"
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              {voiceOutputEnabled ? (
                <>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </>
              ) : (
                <line x1="22" y1="2" x2="11" y2="13" />
              )}
            </svg>
            {voiceOutputEnabled ? "Voice On" : "Voice Off"}
          </button>
        </div>
      </div>
    </div>
  );
}
