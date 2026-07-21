"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { voiceQueue } from "@/lib/voice/VoiceQueue";
import { JarvisAvatar } from "./JarvisAvatar";

interface HealthStatus {
  overall: "healthy" | "degraded" | "unhealthy";
}

interface TelegramStatus {
  running: boolean;
  botName?: string;
  error?: string;
}

interface SearchResult {
  type: "skill" | "work" | "learning" | "session";
  id: string;
  title: string;
  description?: string;
}

const TYPE_STYLES: Record<string, { bg: string; label: string }> = {
  skill: { bg: "bg-purple-500/20 text-purple-400", label: "Skill" },
  work: { bg: "bg-blue-500/20 text-blue-400", label: "Work" },
  learning: { bg: "bg-green-500/20 text-green-400", label: "Learning" },
  session: { bg: "bg-yellow-500/20 text-yellow-400", label: "Session" },
};

function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search debounce
  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=10`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      search(query);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="w-64 bg-muted rounded-md px-3 py-1.5 text-sm placeholder:text-muted-foreground pr-12"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-background text-muted-foreground px-1.5 py-0.5 rounded">
          ⌘K
        </kbd>
      </div>

      {isOpen && (query.length >= 2 || results.length > 0) && (
        <div className="absolute top-full mt-2 w-96 bg-card border border-border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {query.length < 2 ? "Type to search..." : "No results found"}
            </div>
          ) : (
            <div className="py-2">
              {results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  className="w-full px-4 py-2 text-left hover:bg-muted transition-colors"
                  onClick={() => {
                    console.log("Selected:", result);
                    setIsOpen(false);
                    setQuery("");
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${TYPE_STYLES[result.type]?.bg}`}
                    >
                      {TYPE_STYLES[result.type]?.label}
                    </span>
                    <span className="text-sm font-medium truncate">
                      {result.title}
                    </span>
                  </div>
                  {result.description && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {result.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-8 h-8" />;

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="w-8 h-8 rounded-md bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

function TelegramIndicator() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/telegram");
        const data = await res.json();
        setStatus(data);
      } catch {
        setStatus({ running: false, error: "Failed to check" });
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-sm"
      title={status?.running ? "Telegram bot active" : status?.error || "Telegram offline"}
    >
      <span className="text-base">📱</span>
      <span
        className={`w-2 h-2 rounded-full ${
          status?.running ? "bg-green-400" : "bg-red-400"
        }`}
      />
    </div>
  );
}

function VoiceIndicator() {
  const [state, setState] = useState({ isPlaying: false, queueLength: 0 });

  useEffect(() => {
    const unsubscribe = voiceQueue.subscribe((newState) => {
      setState({ isPlaying: newState.isPlaying, queueLength: newState.queueLength });
    });
    return unsubscribe;
  }, []);

  if (!state.isPlaying && state.queueLength === 0) {
    return null;
  }

  return (
    <button
      onClick={() => voiceQueue.skipCurrent()}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-pai-500/20 text-sm border border-pai-500/30 hover:bg-pai-500/30 transition-colors"
      title={state.isPlaying ? "Click to skip (Space)" : `${state.queueLength} in queue`}
    >
      <span className="text-base">🔊</span>
      {state.isPlaying && (
        <span className="flex items-center gap-0.5">
          <span className="w-1 h-3 bg-pai-400 rounded-full animate-pulse" />
          <span className="w-1 h-4 bg-pai-400 rounded-full animate-pulse" style={{ animationDelay: "0.1s" }} />
          <span className="w-1 h-2 bg-pai-400 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
        </span>
      )}
      {state.queueLength > 0 && (
        <span className="text-xs text-pai-400">+{state.queueLength}</span>
      )}
    </button>
  );
}

export function Header() {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        setHealth(data);
      } catch {
        setHealth({ overall: "unhealthy" });
      }
    }

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const healthVariant =
    health?.overall === "healthy"
      ? "success"
      : health?.overall === "degraded"
      ? "warning"
      : "error";

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          {/* PAI Logo with Dynamic Jarvis Avatar */}
          <div className="flex items-center gap-2">
            <JarvisAvatar size={40} showTooltip={true} />
            <span className="font-semibold text-lg">PAI</span>
            <span className="text-muted-foreground text-sm">Command Center</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <SearchBox />

          {/* Voice status indicator */}
          <VoiceIndicator />

          {/* Telegram status */}
          <TelegramIndicator />

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Health indicator */}
          <Badge variant={healthVariant}>
            <span
              className={`w-2 h-2 rounded-full mr-1.5 ${
                health?.overall === "healthy"
                  ? "bg-green-400"
                  : health?.overall === "degraded"
                  ? "bg-yellow-400"
                  : "bg-red-400"
              }`}
            />
            {health?.overall || "checking..."}
          </Badge>
        </div>
      </div>
    </header>
  );
}
