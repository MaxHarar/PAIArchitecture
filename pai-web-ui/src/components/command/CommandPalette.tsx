"use client";

import { useEffect, useState, useCallback } from "react";
import { useTheme } from "next-themes";

interface CommandItem {
  id: string;
  label: string;
  category: string;
  icon: string;
  action: () => void;
  keywords?: string[];
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  skills: { name: string; icon: string; description: string }[];
  onSkillSelect: (skillName: string) => void;
  onNavigate: (tab: string) => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  skills,
  onSkillSelect,
  onNavigate,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { theme, setTheme } = useTheme();

  // Build command list
  const commands: CommandItem[] = [
    // Navigation
    { id: "nav-agents", label: "Go to Agents", category: "Navigation", icon: "🤖", action: () => onNavigate("agents"), keywords: ["agent", "trace"] },
    { id: "nav-skills", label: "Go to Skills", category: "Navigation", icon: "⚡", action: () => onNavigate("skills"), keywords: ["skill", "catalog"] },
    { id: "nav-memory", label: "Go to Memory", category: "Navigation", icon: "🧠", action: () => onNavigate("memory"), keywords: ["memory", "work", "learning"] },
    { id: "nav-sessions", label: "Go to Sessions", category: "Navigation", icon: "📜", action: () => onNavigate("sessions"), keywords: ["session", "history"] },
    { id: "nav-system", label: "Go to System", category: "Navigation", icon: "🖥️", action: () => onNavigate("system"), keywords: ["system", "health"] },

    // Actions
    { id: "toggle-theme", label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode", category: "Actions", icon: theme === "dark" ? "☀️" : "🌙", action: () => setTheme(theme === "dark" ? "light" : "dark"), keywords: ["theme", "dark", "light", "mode"] },

    // Skills (dynamically added)
    ...skills.map((skill) => ({
      id: `skill-${skill.name}`,
      label: `Run ${skill.name}`,
      category: "Skills",
      icon: skill.icon,
      action: () => onSkillSelect(skill.name),
      keywords: [skill.name.toLowerCase(), skill.description.toLowerCase()],
    })),
  ];

  // Filter commands based on query
  const filteredCommands = query
    ? commands.filter((cmd) => {
        const searchStr = `${cmd.label} ${cmd.keywords?.join(" ") || ""}`.toLowerCase();
        return searchStr.includes(query.toLowerCase());
      })
    : commands;

  // Group by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, CommandItem[]>);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [isOpen, filteredCommands, selectedIndex, onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[20vh] z-50">
      <div className="w-full max-w-lg bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="p-4 border-b border-border">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search commands..."
            autoFocus
            className="w-full bg-transparent text-lg outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {Object.entries(groupedCommands).map(([category, items]) => (
            <div key={category} className="mb-2">
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground">
                {category}
              </div>
              {items.map((cmd) => {
                const isSelected = flatIndex === selectedIndex;
                const currentIndex = flatIndex;
                flatIndex++;

                return (
                  <button
                    key={cmd.id}
                    onClick={() => {
                      cmd.action();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(currentIndex)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      isSelected
                        ? "bg-pai-500/20 text-foreground"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="text-lg">{cmd.icon}</span>
                    <span className="flex-1">{cmd.label}</span>
                    {isSelected && (
                      <span className="text-xs text-muted-foreground">↵</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {filteredCommands.length === 0 && (
            <div className="px-3 py-8 text-center text-muted-foreground">
              No commands found
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>esc Close</span>
          </div>
          <span>⌘K to open</span>
        </div>
      </div>
    </div>
  );
}
