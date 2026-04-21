"use client";

import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useShortcut, getRegisteredShortcuts } from "@/lib/hooks/useShortcuts";
import { useRouter } from "next/navigation";
import { useDeckSettings, type ChatSurface } from "./settings/DeckSettingsProvider";
import { useWarp, type Theme } from "@/components/warp/WarpProvider";
import { openCanvas, toggleCanvas, closeCanvas } from "@/lib/canvas";

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

const RECENT_KEY = "deck:recent-commands";
const CHAT_SURFACE_ORDER: ChatSurface[] = ["safe", "brave", "radical"];

function getRecentIds(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}

function addRecent(id: string) {
  const recent = getRecentIds().filter(r => r !== id);
  recent.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 5)));
}

function fuzzyMatch(label: string, query: string): boolean {
  const labelLower = label.toLowerCase();
  const queryLower = query.toLowerCase();
  // Direct substring match
  if (labelLower.includes(queryLower)) return true;
  // Match all query words independently
  const words = queryLower.split(/\s+/);
  return words.every(w => labelLower.includes(w));
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { setSettingsOpen, setRailOpen, updatePrefs, prefs } = useDeckSettings();
  const { setTweak } = useWarp();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    // Navigation — top-level surfaces
    { id: "nav-chat", label: "Go to Chat", shortcut: "1", action: () => router.push("/deck/chat"), category: "Navigation" },
    { id: "nav-terminal", label: "Go to Terminal", shortcut: "2", action: () => router.push("/deck/terminal"), category: "Navigation" },
    { id: "nav-visual", label: "Go to Visual", shortcut: "3", action: () => router.push("/deck/visual"), category: "Navigation" },
    { id: "nav-audio", label: "Go to Audio", shortcut: "4", action: () => router.push("/deck/audio"), category: "Navigation" },
    { id: "nav-control", label: "Go to Control", shortcut: "5", action: () => router.push("/deck/control"), category: "Navigation" },
    // Navigation — Control tabs (direct jumps)
    { id: "nav-runs", label: "Go to Runs", action: () => router.push("/deck/control"), category: "Navigation" },
    { id: "nav-tools", label: "Go to Tools", action: () => router.push("/deck/control?tab=tools"), category: "Navigation" },
    { id: "nav-studio", label: "Go to UI Studio", action: () => router.push("/deck/control?tab=studio"), category: "Navigation" },
    { id: "nav-agentgo", label: "Go to Agent-GO", action: () => router.push("/deck/control?tab=agentgo"), category: "Navigation" },
    { id: "nav-models", label: "Go to Models", action: () => router.push("/deck/control?tab=models"), category: "Navigation" },
    // Navigation — Audio tabs
    { id: "nav-voice", label: "Go to Voice", action: () => router.push("/deck/audio"), category: "Navigation" },
    { id: "nav-live", label: "Go to Live", action: () => router.push("/deck/audio?tab=live"), category: "Navigation" },
    // Settings
    { id: "settings-open", label: "Open Settings", shortcut: "⌘,", action: () => setSettingsOpen(true), category: "Settings" },
    { id: "settings-inspector", label: "Toggle Sidebar", shortcut: "⌘I", action: () => setRailOpen(o => !o), category: "Settings" },
    { id: "settings-chat-context-rail", label: `Chat Context Rail: ${prefs.chatContextRail ? "On" : "Off"}`, action: () => updatePrefs({ chatContextRail: !prefs.chatContextRail }), category: "Settings" },
    {
      id: "settings-chat-surface-cycle",
      label: `Chat Surface: ${prefs.chatSurface}`,
      action: () => {
        const index = CHAT_SURFACE_ORDER.indexOf(prefs.chatSurface);
        updatePrefs({ chatSurface: CHAT_SURFACE_ORDER[(index + 1) % CHAT_SURFACE_ORDER.length] });
      },
      category: "Settings",
    },
    // Theme shortcuts
    { id: "theme-light", label: "Theme: Light", action: () => setTweak("theme", "light" as Theme), category: "Theme" },
    { id: "theme-dark", label: "Theme: Dark", action: () => setTweak("theme", "dark" as Theme), category: "Theme" },
    { id: "settings-reduce-motion", label: `Reduce Motion: ${prefs.reduceMotion ? "On" : "Off"}`, action: () => updatePrefs({ reduceMotion: !prefs.reduceMotion }), category: "Settings" },
    // Actions
    { id: "action-new-chat", label: "New Chat", action: () => { router.push("/deck/chat?new=1"); }, category: "Actions" },
    { id: "action-clear-runs", label: "Clear Run History", action: async () => { if (confirm("Clear all run history? This cannot be undone.")) { await fetch("/api/agui/runs", { method: "DELETE" }); window.location.reload(); } }, category: "Actions" },
    { id: "action-refresh", label: "Refresh Stats", action: () => window.location.reload(), category: "Actions" },
    // Canvas
    { id: "canvas-toggle", label: "Canvas: Toggle Panel", action: () => toggleCanvas(), category: "Canvas" },
    { id: "canvas-close", label: "Canvas: Close", action: () => closeCanvas(), category: "Canvas" },
    { id: "canvas-new-python", label: "Canvas: New Python", action: () => openCanvas({ language: "python", title: "python scratch", code: "# python scratch — plt.show() auto-captures figures\nprint('hello from canvas')\n" }), category: "Canvas" },
    { id: "canvas-new-javascript", label: "Canvas: New JavaScript", action: () => openCanvas({ language: "javascript", title: "node scratch", code: "console.log('hello from canvas');\n" }), category: "Canvas" },
    { id: "canvas-new-go", label: "Canvas: New Go", action: () => openCanvas({ language: "go", title: "go scratch", code: "package main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"hello from canvas\")\n}\n" }), category: "Canvas" },
    { id: "canvas-new-bash", label: "Canvas: New Bash", action: () => openCanvas({ language: "bash", title: "bash scratch", code: "#!/usr/bin/env bash\necho \"hello from canvas\"\n" }), category: "Canvas" },
    { id: "canvas-new-react", label: "Canvas: New React Preview", action: () => openCanvas({ language: "react", title: "react preview", code: "function App() {\n  return <div style={{padding:24}}>hello from canvas</div>;\n}\n", autoRun: true }), category: "Canvas" },
    { id: "canvas-new-html", label: "Canvas: New HTML Preview", action: () => openCanvas({ language: "html", title: "html preview", code: "<h1>hello from canvas</h1>\n", autoRun: true }), category: "Canvas" },
    { id: "canvas-new-threejs", label: "Canvas: New Three.js Preview", action: () => openCanvas({ language: "threejs", title: "three.js preview", code: "const { scene, camera, renderer } = createDefaultScene();\nconst geo = new THREE.BoxGeometry();\nconst mat = new THREE.MeshBasicMaterial({ color: 0xe6a756, wireframe: true });\nconst cube = new THREE.Mesh(geo, mat);\nscene.add(cube);\n(function tick() {\n  cube.rotation.x += 0.01; cube.rotation.y += 0.01;\n  renderer.render(scene, camera);\n  requestAnimationFrame(tick);\n})();\n", autoRun: true }), category: "Canvas" },
  ];

  // Merge registered shortcuts as discoverable commands
  const registeredShortcuts = getRegisteredShortcuts();
  const shortcutCommands: Command[] = registeredShortcuts
    .filter(s => s.label && !commands.some(c => c.shortcut === s.combo))
    .map(s => ({
      id: `shortcut-${s.combo}`,
      label: s.label!,
      shortcut: s.combo.replace("mod+", "⌘").replace("shift+", "⇧"),
      action: () => {}, // These are informational
      category: "Shortcuts",
    }));

  const allCommands = [...commands, ...shortcutCommands];

  const filteredCommands = query
    ? allCommands.filter((cmd) => fuzzyMatch(cmd.label, query))
    : allCommands;

  // Group by category, prepending "Recent" section when query is empty
  const groupedCommands: Record<string, Command[]> = {};

  if (!query && recentIds.length > 0) {
    const recentCmds = recentIds
      .map(id => allCommands.find(c => c.id === id))
      .filter((c): c is Command => c !== undefined);
    if (recentCmds.length > 0) {
      groupedCommands["Recent"] = recentCmds;
    }
  }

  filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, groupedCommands);

  const flatCommands = Object.values(groupedCommands).flat();

  // Keyboard shortcuts (centralized via useShortcut)
  // These only fire when the palette is open, and at high priority so they
  // consume Escape before lower-priority handlers (canvas, settings drawer).
  useShortcut("arrowdown", () => {
    setSelectedIndex((i) => Math.min(i + 1, flatCommands.length - 1));
  }, { enabled: open, priority: 100, label: "Palette: next item" });

  useShortcut("arrowup", () => {
    setSelectedIndex((i) => Math.max(i - 1, 0));
  }, { enabled: open, priority: 100, label: "Palette: previous item" });

  useShortcut("enter", () => {
    if (flatCommands[selectedIndex]) {
      addRecent(flatCommands[selectedIndex].id);
      setRecentIds(getRecentIds());
      flatCommands[selectedIndex].action();
      onClose();
    }
  }, { enabled: open, priority: 100, label: "Palette: execute command" });

  useShortcut("escape", () => {
    onClose();
  }, { enabled: open, priority: 100, label: "Close command palette" });

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setRecentIds(getRecentIds());
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
          <Search className="w-5 h-5 text-[var(--text-muted)]" />
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
                      addRecent(cmd.id);
                      setRecentIds(getRecentIds());
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
