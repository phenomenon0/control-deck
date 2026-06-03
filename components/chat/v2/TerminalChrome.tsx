"use client";

/**
 * TerminalChrome (v2) — the themeable terminal shell: tab strip on top, the split
 * frame in the middle, the status bar on the bottom. Pure/presentational — it
 * owns no sessions or sockets and delegates each pane to `renderPane` (the seam),
 * so Storybook injects FauxTerminalScreen and the deck injects LiveTerminalScreen.
 *
 * Tabs are tmux-style "windows" (each owns a split tree); the pane actions
 * (split →, split ↓, close) act on the focused pane. Token-driven via cd-term-*
 * hooks so it reskins per family exactly like the chat surface.
 */

import React, { useEffect, useRef } from "react";
import { Columns2, Rows2, X } from "lucide-react";

import { allLeaves, nearestInDirection, type FocusDir, type Rect, type SplitLeaf, type SplitNode } from "./splitTree";
import { KeepAliveStack } from "./KeepAliveStack";
import { TerminalSplit } from "./TerminalSplit";
import { TerminalStatusBar } from "./TerminalStatusBar";
import type { TerminalProfile, TerminalStatusModel, TerminalTab, TmuxWindowInfo } from "./terminalTypes";
import "./terminal.css";

const PROFILE_GLYPH: Record<TerminalProfile, string> = { claude: "✦", opencode: "◆", shell: "❯" };
const PROFILE_LABEL: Record<TerminalProfile, string> = { claude: "Claude", opencode: "OpenCode", shell: "Shell" };
const GLYPH_TONE: Record<TerminalTab["status"], string> = {
  running: "var(--ok, #34d399)",
  starting: "var(--warn, #fbbf24)",
  exited: "var(--text-muted)",
  error: "var(--err, #f87171)",
};
const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;
const LAUNCH: ReadonlyArray<TerminalProfile> = ["shell", "claude", "opencode"];
const KEY_TO_DIR: Record<string, FocusDir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const NOOP = () => {};

export interface TerminalChromeProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (profile: TerminalProfile) => void;
  canLaunch?: boolean;
  busy?: boolean;

  layout: SplitNode | null;
  focusedPaneId: string;
  onFocusPane: (paneId: string) => void;
  onSplit: (paneId: string, dir: "row" | "col") => void;
  onClosePane: (paneId: string) => void;
  onResize: (groupId: string, sizes: number[]) => void;

  /** Keep-alive: when provided, ALL windows' split trees are mounted (inactive
   *  ones hidden) so switching tabs never unmounts a pane / churns its socket.
   *  The active window stays interactive via the handlers above; hidden windows
   *  just keep their panes alive. Omit → single-window (`layout`) rendering. */
  windows?: Array<{ id: string; layout: SplitNode; focusedPaneId: string }>;
  activeWindowId?: string | null;

  renderPane: (leaf: SplitLeaf) => React.ReactNode;
  status: TerminalStatusModel;
  /** Optional per-session titles so the status bar shows a pane's #T (else the
   *  window name is used). Keyed by sessionId. */
  sessionMeta?: Record<string, { title?: string }>;
  className?: string;
}

export function TerminalChrome({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  canLaunch = true,
  busy = false,
  layout,
  focusedPaneId,
  onFocusPane,
  onSplit,
  onClosePane,
  onResize,
  windows: keepAliveWindows,
  activeWindowId,
  renderPane,
  status,
  sessionMeta,
  className,
}: TerminalChromeProps) {
  // ── compute the tmux status-line view from windows(tabs) + the active split ──
  const windows: TmuxWindowInfo[] = tabs.map((t, i) => ({ index: i, name: t.title, active: t.id === activeTabId }));
  const activeWinIdx = Math.max(0, tabs.findIndex((t) => t.id === activeTabId));
  const leaves = layout ? allLeaves(layout) : [];
  const paneIdx = Math.max(0, leaves.findIndex((l) => l.id === focusedPaneId));
  const focusedLeaf = leaves[paneIdx];
  const paneTitle =
    (focusedLeaf?.sessionId ? sessionMeta?.[focusedLeaf.sessionId]?.title : undefined) ??
    tabs[activeWinIdx]?.title ??
    "shell";
  const tmuxStatus: TerminalStatusModel = {
    ...status,
    session: status.session ?? "deck",
    windows,
    activePane: layout
      ? { window: activeWinIdx, pane: paneIdx, title: paneTitle, count: leaves.length }
      : undefined,
  };

  // Keyboard pane nav (works wherever the chrome lives — Storybook + live):
  //   ⌘+Arrow → spatial focus to the adjacent pane
  //   ⌘+digit → jump to pane #P  (Cmd never reaches the PTY, so it's safe)
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layout) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (/^[0-9]$/.test(e.key)) {
        const n = Number(e.key);
        if (n < leaves.length) {
          e.preventDefault();
          onFocusPane(leaves[n].id);
        }
        return;
      }
      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      const root = frameRef.current;
      if (!root) return;
      e.preventDefault();
      // With keep-alive, every window's panes are mounted; only the active
      // window's panes have real rects — scope to it so spatial nav ignores
      // the hidden (0×0) panes. Fall back to the whole frame (single-window).
      const scope = root.querySelector<HTMLElement>("[data-term-window='active']") ?? root;
      const rects: Record<string, Rect> = {};
      scope.querySelectorAll<HTMLElement>("[data-pane-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        rects[el.dataset.paneId!] = { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const next = nearestInDirection(rects, focusedPaneId, dir);
      if (next) onFocusPane(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout, leaves, focusedPaneId, onFocusPane]);

  return (
    <div
      className={`cd-term flex min-h-0 min-w-0 flex-1 flex-col${className ? ` ${className}` : ""}`}
      style={{ background: "var(--term-bg, var(--bg-inset, var(--bg)))" }}
    >
      {/* ── tab strip ── */}
      <div
        className="cd-term-tabs flex items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Terminal windows">
          {tabs.map((tab) => {
            const on = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={on}
                tabIndex={0}
                onClick={() => onSelectTab(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTab(tab.id);
                  }
                }}
                className="cd-term-tab group/t flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 transition-colors"
                style={{
                  ...MONO,
                  background: on ? "var(--bg-tertiary)" : "transparent",
                  color: on ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: on ? "inset 0 -2px 0 rgb(var(--accent-rgb))" : undefined,
                }}
              >
                <span aria-hidden="true" style={{ color: GLYPH_TONE[tab.status] }}>
                  {PROFILE_GLYPH[tab.profile]}
                </span>
                <span className="max-w-[160px] truncate">{tab.title}</span>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  disabled={busy}
                  className="rounded-sm px-0.5 opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover/t:opacity-100 focus:opacity-100 disabled:opacity-30"
                  style={{ color: "var(--text-muted)" }}
                >
                  ✕
                </button>
              </div>
            );
          })}

          {/* new-window launchers */}
          <div className="ml-0.5 flex shrink-0 items-center gap-0.5">
            {LAUNCH.map((profile) => (
              <button
                key={profile}
                type="button"
                onClick={() => onNewTab(profile)}
                disabled={!canLaunch || busy}
                title={profile === "shell" ? "New shell (⌥N)" : `New ${PROFILE_LABEL[profile]}`}
                aria-label={`New ${PROFILE_LABEL[profile]}`}
                className="rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
                style={{ ...MONO, color: "var(--text-muted)" }}
              >
                {profile === "shell" ? "+" : PROFILE_GLYPH[profile]}
              </button>
            ))}
          </div>
        </div>

        {/* pane actions — act on the focused pane */}
        <div className="flex shrink-0 items-center gap-0.5">
          <PaneAction label="Split right" onClick={() => onSplit(focusedPaneId, "row")} disabled={!focusedPaneId}>
            <Columns2 size={14} />
          </PaneAction>
          <PaneAction label="Split down" onClick={() => onSplit(focusedPaneId, "col")} disabled={!focusedPaneId}>
            <Rows2 size={14} />
          </PaneAction>
          <PaneAction label="Close pane" onClick={() => onClosePane(focusedPaneId)} disabled={!focusedPaneId}>
            <X size={14} />
          </PaneAction>
        </div>
      </div>

      {/* ── split frame ── */}
      {/* Keep-alive: mount EVERY window's split tree at a stable key and stack
          them via KeepAliveStack (visibility, NOT display:none) so an inactive
          window's panes keep their real size — wterm never collapses to 1×1 and
          text survives tab switches. Only the active window is interactive.
          Falls back to the single `layout` when no `windows` provided. */}
      <div ref={frameRef} className="relative flex min-h-0 min-w-0 flex-1">
        {keepAliveWindows && keepAliveWindows.length > 0 ? (
          <KeepAliveStack
            activeId={activeWindowId ?? null}
            activeAttr="data-term-window"
            lazy={false}
            items={keepAliveWindows.map((w) => {
              const isActive = w.id === activeWindowId;
              return {
                id: w.id,
                node: (
                  <TerminalSplit
                    node={w.layout}
                    focusedPaneId={isActive ? focusedPaneId : w.focusedPaneId}
                    onFocusPane={isActive ? onFocusPane : NOOP}
                    onResize={isActive ? onResize : NOOP}
                    onClosePane={isActive ? onClosePane : undefined}
                    renderPane={renderPane}
                  />
                ),
              };
            })}
          />
        ) : layout ? (
          <TerminalSplit node={layout} focusedPaneId={focusedPaneId} onFocusPane={onFocusPane} onResize={onResize} onClosePane={onClosePane} renderPane={renderPane} />
        ) : (
          <div className="m-auto text-[var(--text-muted)]" style={MONO}>
            No terminal windows — press + to open one.
          </div>
        )}
      </div>

      {/* ── status bar ── */}
      <TerminalStatusBar status={tmuxStatus} />
    </div>
  );
}

function PaneAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
      style={{ color: "var(--text-secondary)" }}
    >
      {children}
    </button>
  );
}

export default TerminalChrome;
