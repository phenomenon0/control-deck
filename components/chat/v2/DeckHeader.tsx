"use client";

/**
 * DeckHeader (v2) — the deck's top bar, designed as its own piece.
 *
 * Brand mark · optional threads toggle (chat only) · pane tabs · right cluster
 * (session/NOW inline · ⌘K · settings). Fully prop-driven + token-driven so it
 * themes and can be iterated in isolation (DeckHeader.stories) before the
 * layout consumes it. Active tab = accent underline.
 */

import React from "react";
import { Icon } from "@/components/warp/Icons";

export interface DeckPane {
  id: string;
  label: string;
}

export interface DeckHeaderProps {
  panes: DeckPane[];
  activePane: string;
  onSelectPane: (id: string) => void;
  /** Brand wordmark next to the ◆ mark (optional). */
  brandName?: string;
  /** When provided, shows the ☰ threads toggle (use only where threads exist). */
  threadsOpen?: boolean;
  onToggleThreads?: () => void;
  /** NOW/session info, rendered inline on the right (md+). */
  session?: { model?: string; stats?: { label: string; value: string }[] };
  onCommand?: () => void;
  onSettings?: () => void;
}

const mono = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function DeckHeader({
  panes,
  activePane,
  onSelectPane,
  brandName,
  threadsOpen,
  onToggleThreads,
  session,
  onCommand,
  onSettings,
}: DeckHeaderProps) {
  return (
    <header
      className="cd-header flex items-center gap-1 border-b px-3 py-2"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <span
        className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)]"
        style={{ background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)" }}
        aria-hidden="true"
      >
        ◆
      </span>
      {brandName && (
        <span className="mr-1 hidden text-[var(--text-primary)] sm:inline" style={{ fontFamily: "var(--font-display)", fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-heading, 600)" }}>
          {brandName}
        </span>
      )}

      {onToggleThreads && (
        <button
          type="button"
          aria-label="Toggle threads"
          aria-pressed={threadsOpen}
          onClick={onToggleThreads}
          title="Threads"
          className="mr-1 grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-tertiary)]"
          style={{ color: threadsOpen ? "rgb(var(--accent-rgb))" : "var(--text-secondary)" }}
        >
          ☰
        </button>
      )}

      {panes.map((p) => {
        const on = p.id === activePane;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectPane(p.id)}
            aria-current={on ? "page" : undefined}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
            style={{
              color: on ? "var(--text-primary)" : "var(--text-secondary)",
              background: on ? "var(--bg-tertiary)" : undefined,
              boxShadow: on ? "inset 0 -2px 0 rgb(var(--accent-rgb))" : undefined,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            {p.label}
          </button>
        );
      })}

      <div className="ml-auto flex items-center gap-3">
        {session && (
          <span className="hidden items-center gap-2 text-[var(--text-muted)] md:flex" style={mono}>
            {session.model && <span style={{ color: "rgb(var(--accent-rgb))" }}>● {session.model}</span>}
            {session.stats?.map((s) => (
              <span key={s.label}>· {s.value} {s.label}</span>
            ))}
          </span>
        )}
        {onCommand && (
          <button type="button" aria-label="Command palette" onClick={onCommand} className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]" style={mono} title="Command (⌘K)">
            ⌘K
          </button>
        )}
        {onSettings && (
          <button
            type="button"
            aria-label="Settings"
            onClick={onSettings}
            title="Settings"
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <Icon.Settings size={16} sw={1.25} />
          </button>
        )}
      </div>
    </header>
  );
}

export default DeckHeader;
