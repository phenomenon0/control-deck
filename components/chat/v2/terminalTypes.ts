/**
 * Shared presentational contracts for the v2 terminal leaves. Kept separate so
 * the faux/live screens, the chrome, and the container all agree on shape
 * without import cycles. No React, no live deps — pure types.
 */

import type { TerminalProfile, TerminalSessionStatus } from "@/lib/terminal/types";

export type { TerminalProfile, TerminalSessionStatus };

/** Per-pane connection state the screen renders (derived by the container). */
export type TerminalConnState =
  | "empty" // no session in this pane → show the launcher
  | "connecting"
  | "running"
  | "exited"
  | "error"
  | "reset"; // transient: clearing + replaying history

/** The seam: chrome never knows what a "screen" is — faux + live both satisfy this. */
export interface TerminalScreenProps {
  sessionId: string | null;
  state: TerminalConnState;
  exitCode?: number | null;
  errorText?: string | null;
  /** Empty-pane launcher: start a session of this profile in the pane. */
  onLaunch?: (profile: TerminalProfile) => void;
  /** Exited/error overlay action. */
  onRestart?: () => void;
}

/** One tab in the strip (top-level session entry). */
export interface TerminalTab {
  id: string; // session id
  title: string;
  profile: TerminalProfile;
  status: TerminalSessionStatus;
}

/** A window in the tmux status line (our tabs == tmux windows). */
export interface TmuxWindowInfo {
  index: number; // #I
  name: string; // #W
  active: boolean; // gets the * flag
  zoomed?: boolean; // Z flag
}

/** The focused pane, tmux-style (#T title at window.pane index). */
export interface TmuxActivePane {
  window: number; // active window #I
  pane: number; // #P within the active window
  title: string; // #T
  count: number; // panes in the active window
}

/** Presentational facts the status bar renders — no live objects. */
export interface TerminalStatusModel {
  connection: "connected" | "connecting" | "error" | "idle";
  pid?: number | null;
  cwd?: string | null;
  sessionCount?: number;
  liveCount?: number;
  host?: string | null;
  port?: number | null;
  /** Friendly error notice (e.g. remapped "Unauthorized."). */
  error?: string | null;

  // ── tmux status line (computed by TerminalChrome from windows + focus) ──
  /** Session name (#S) — defaults to "deck". */
  session?: string;
  /** Window list (#I:#W with flags) — the tabs as tmux windows. */
  windows?: TmuxWindowInfo[];
  /** The focused pane (#T at #I.#P) — updates as you click panes. */
  activePane?: TmuxActivePane;
}
