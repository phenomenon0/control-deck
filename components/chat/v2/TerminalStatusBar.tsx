"use client";

/**
 * TerminalStatusBar (v2) — a tmux-style status line, token-driven so it reskins
 * per theme. Faithful to tmux's layout:
 *   left   #S    → [session]
 *   center #I:#W → window list, active window flagged * (inverted), Z if zoomed
 *   right  #T #P → connection dot · active-pane title · window.pane · host
 *
 * Pure/presentational: it renders a TerminalStatusModel and owns no state. The
 * active-pane segment is driven by the focused pane, so clicking a pane makes
 * the bar react ("it knows" which pane is current). Carries `cd-term-bar`.
 */

import React from "react";
import type { TerminalStatusModel } from "./terminalTypes";

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

const DOT_COLOR: Record<TerminalStatusModel["connection"], string> = {
  connected: "var(--ok, #34d399)",
  connecting: "var(--warn, #fbbf24)",
  error: "var(--err, #f87171)",
  idle: "var(--text-muted)",
};

export interface TerminalStatusBarProps {
  status: TerminalStatusModel;
}

export function TerminalStatusBar({ status }: TerminalStatusBarProps) {
  const { connection, windows, activePane, host, port, error } = status;
  const session = status.session ?? "deck";

  return (
    <div
      className="cd-term-bar flex items-center gap-2 px-2 py-0.5"
      style={MONO}
      role="status"
      aria-label="Terminal status"
    >
      {/* #S — session */}
      <span style={{ fontWeight: "var(--fw-strong, 600)" }} aria-label="session">
        [{session}]
      </span>

      {/* #I:#W — window list (tmux center) */}
      {windows && windows.length > 0 && (
        <span className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="windows">
          {windows.map((w) => {
            const flag = w.zoomed ? "Z" : w.active ? "*" : "";
            return (
              <span
                key={w.index}
                className="shrink-0 rounded-sm px-1"
                aria-current={w.active ? "true" : undefined}
                style={
                  w.active
                    ? { background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)", fontWeight: "var(--fw-strong, 600)" }
                    : { opacity: 0.7 }
                }
              >
                {w.index}:{w.name}
                {flag}
              </span>
            );
          })}
        </span>
      )}

      {/* right cluster */}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className="flex items-center gap-1.5" aria-label="connection">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full${connection === "connecting" ? " animate-pulse" : ""}`}
            style={{ background: DOT_COLOR[connection] }}
            aria-hidden="true"
          />
        </span>

        {/* #T at #I.#P — the reactive active-pane segment */}
        {activePane && (
          <span aria-label="active pane" title={`pane ${activePane.window}.${activePane.pane} of ${activePane.count}`}>
            <span style={{ color: "var(--text-primary)" }}>{activePane.title}</span>
            <span style={{ opacity: 0.7 }}>
              {" "}
              {activePane.window}.{activePane.pane}
            </span>
          </span>
        )}

        {error && (
          <span style={{ color: "var(--err, #f87171)" }} title={error}>
            {error}
          </span>
        )}

        <span style={{ opacity: 0.65 }} aria-label="host">
          {host ? `${host}${port ? `:${port}` : ""}` : "—"}
        </span>
      </span>
    </div>
  );
}

export default TerminalStatusBar;
