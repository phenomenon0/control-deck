"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDeckSettings, THEME_META, type ThemeName } from "./settings/DeckSettingsProvider";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
  category: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { setSettingsOpen, setInspectorOpen, updatePrefs, prefs } = useDeckSettings();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    // Navigation - Primary
    { id: "nav-chat", label: "Go to Chat", shortcut: "1", action: () => router.push("/deck/chat"), category: "Navigation" },
    { id: "nav-runs", label: "Go to Runs", shortcut: "2", action: () => router.push("/deck/runs"), category: "Navigation" },
    { id: "nav-tools", label: "Go to Tools", shortcut: "3", action: () => router.push("/deck/tools"), category: "Navigation" },
    // Navigation - Advanced
    { id: "nav-models", label: "Go to Models", action: () => router.push("/deck/models"), category: "Navigation" },
    { id: "nav-comfy", label: "Go to Comfy", action: () => router.push("/deck/comfy"), category: "Navigation" },
    { id: "nav-voice", label: "Go to Voice", action: () => router.push("/deck/voice"), category: "Navigation" },
    // Settings
    { id: "settings-open", label: "Open Settings", shortcut: "⌘,", action: () => setSettingsOpen(true), category: "Settings" },
    { id: "settings-inspector", label: "Toggle Inspector", shortcut: "⌘I", action: () => setInspectorOpen(o => !o), category: "Settings" },
    // Theme shortcuts
    ...Object.entries(THEME_META).map(([key, meta]) => ({
      id: `theme-${key}`,
      label: `Theme: ${meta.label}`,
      action: () => updatePrefs({ theme: key as ThemeName }),
      category: "Theme",
    })),
    { id: "settings-reduce-motion", label: `Reduce Motion: ${prefs.reduceMotion ? "On" : "Off"}`, action: () => updatePrefs({ reduceMotion: !prefs.reduceMotion }), category: "Settings" },
    // Actions
    { id: "action-new-chat", label: "New Chat", action: () => { router.push("/deck/chat?new=1"); }, category: "Actions" },
    { id: "action-clear-runs", label: "Clear Run History", action: async () => { if (confirm("Clear all run history? This cannot be undone.")) { await fetch("/api/agui/runs", { method: "DELETE" }); window.location.reload(); } }, category: "Actions" },
    { id: "action-refresh", label: "Refresh Stats", action: () => window.location.reload(), category: "Actions" },
  ];

  const filteredCommands = query
    ? commands.filter((cmd) =>
        cmd.label.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  // Group by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);

  const flatCommands = Object.values(groupedCommands).flat();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (flatCommands[selectedIndex]) {
            flatCommands[selectedIndex].action();
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [open, flatCommands, selectedIndex, onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center border-b border-[var(--border)] px-4">
          <svg
            className="w-5 h-5 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search commands..."
            className="flex-1 bg-transparent border-0 py-4 px-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="kbd">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-2">
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category} className="mb-2">
              <div className="px-3 py-1 text-xs text-[var(--text-muted)] uppercase tracking-wider">
                {category}
              </div>
              {cmds.map((cmd) => {
                const isSelected = flatCommands[selectedIndex]?.id === cmd.id;
                return (
                  <button
                    key={cmd.id}
                    onClick={() => {
                      cmd.action();
                      onClose();
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                    }`}
                  >
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className={`kbd ${isSelected ? "bg-white/20 border-white/30 text-white" : ""}`}>
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {flatCommands.length === 0 && (
            <div className="px-3 py-8 text-center text-[var(--text-muted)]">
              No commands found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
