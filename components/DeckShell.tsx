"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { CommandPalette } from "./CommandPalette";
import { DeckSettingsProvider, useDeckSettings } from "./settings/DeckSettingsProvider";
import { SettingsDrawer } from "./settings/SettingsDrawer";

// =============================================================================
// Navigation Configuration
// =============================================================================

const PRIMARY_NAV = [
  { href: "/deck/chat", label: "Chat", icon: "💬", shortcut: "1" },
  { href: "/deck/runs", label: "Runs", icon: "📊", shortcut: "2" },
  { href: "/deck/tools", label: "Tools", icon: "🔧", shortcut: "3" },
];

const ADVANCED_NAV = [
  { href: "/deck/models", label: "Models", icon: "🧠" },
  { href: "/deck/comfy", label: "Comfy", icon: "🎨" },
  { href: "/deck/voice", label: "Voice", icon: "🎤" },
];

// =============================================================================
// Types
// =============================================================================

interface SystemStats {
  gpu: {
    name: string;
    memoryUsed: number;
    memoryTotal: number;
    memoryPercent: number;
    utilization: number;
    temperature: number;
  } | null;
  services: Array<{
    name: string;
    status: "online" | "offline" | "unknown";
  }>;
}

// =============================================================================
// Inner Shell (needs context)
// =============================================================================

function DeckShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const { setSettingsOpen } = useDeckSettings();

  // Check if current path is in advanced nav (auto-expand if so)
  useEffect(() => {
    const isAdvanced = ADVANCED_NAV.some((item) => pathname === item.href);
    if (isAdvanced) setAdvancedExpanded(true);
  }, [pathname]);

  // Fetch system stats periodically
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/system/stats");
        if (res.ok) {
          setStats(await res.json());
        }
      } catch {
        // ignore
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Cmd/Ctrl + K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }

      // Number keys for primary navigation (when not in input)
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key >= "1" &&
        e.key <= "3"
      ) {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
        const item = PRIMARY_NAV[parseInt(e.key) - 1];
        if (item) {
          window.location.href = item.href;
        }
      }
    },
    []
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const onlineCount = stats?.services.filter((s) => s.status === "online").length ?? 0;
  const totalServices = stats?.services.length ?? 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">Control Deck</h1>
          
          {/* Primary Nav */}
          <nav className="flex items-center gap-1">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${
                  pathname === item.href
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                <span className="kbd ml-1">{item.shortcut}</span>
              </Link>
            ))}

            {/* Advanced Nav Toggle */}
            <div className="relative ml-2">
              <button
                onClick={() => setAdvancedExpanded(!advancedExpanded)}
                className={`px-2 py-1.5 rounded-md text-sm flex items-center gap-1 transition-colors ${
                  advancedExpanded || ADVANCED_NAV.some((i) => pathname === i.href)
                    ? "text-[var(--text-primary)] bg-[var(--bg-tertiary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <span>Advanced</span>
                <svg
                  className={`w-3 h-3 transition-transform ${advancedExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Advanced Nav Dropdown */}
              {advancedExpanded && (
                <div className="absolute top-full left-0 mt-1 py-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg z-50 min-w-[140px]">
                  {ADVANCED_NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                        pathname === item.href
                          ? "bg-[var(--accent)] text-white"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      }`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {/* GPU stats */}
          {stats?.gpu && (
            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
              <span title={stats.gpu.name}>
                GPU: {stats.gpu.memoryUsed}MB / {stats.gpu.memoryTotal}MB ({stats.gpu.memoryPercent}%)
              </span>
              <span>{stats.gpu.temperature}°C</span>
            </div>
          )}

          {/* Service status */}
          <div className="flex items-center gap-2">
            <span
              className={`status-dot ${
                onlineCount === totalServices
                  ? "status-dot-online"
                  : onlineCount > 0
                  ? "status-dot-pending"
                  : "status-dot-offline"
              }`}
            />
            <span className="text-xs text-[var(--text-muted)]">
              {onlineCount}/{totalServices} services
            </span>
          </div>

          {/* Settings button */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn btn-ghost flex items-center gap-1"
            title="Settings (Cmd+,)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Command palette trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="btn btn-secondary flex items-center gap-2"
          >
            <span>Search</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">{children}</main>

      {/* Command palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Settings drawer */}
      <SettingsDrawer />
    </div>
  );
}

// =============================================================================
// Outer Shell (provides context)
// =============================================================================

export function DeckShell({ children }: { children: React.ReactNode }) {
  return (
    <DeckSettingsProvider>
      <DeckShellInner>{children}</DeckShellInner>
    </DeckSettingsProvider>
  );
}
