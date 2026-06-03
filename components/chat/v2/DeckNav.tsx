"use client";

/**
 * DeckNav (v2) — the deck's global navigation rail, rebuilt token-driven so it
 * themes alongside the chat leaves. Mirrors the real shell/Sidebar ideology:
 * a brand mark, a "Surfaces" section of icon+label+shortcut items with an active
 * highlight, a "Session" section, and a "NOW" status panel (active thread +
 * msgs/tools/open/spend). Prop-driven; the showcase feeds it mock state.
 */

import React from "react";

export interface DeckNavItem {
  id: string;
  label: string;
  kbd?: string;
  icon?: React.ComponentType<{ size?: number; sw?: number }>;
}

export interface DeckNavProps {
  items: DeckNavItem[];
  sessionItems?: DeckNavItem[];
  activeId: string;
  onSelect?: (id: string) => void;
  brand?: { name: string; sub?: string };
  now?: { title: string; stats: { label: string; value: string | number }[] };
}

const EYEBROW = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;
const KBD = { fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)" } as const;

export function DeckNav({ items, sessionItems = [], activeId, onSelect, brand, now }: DeckNavProps) {
  const renderItem = (it: DeckNavItem) => {
    const active = it.id === activeId;
    const Ico = it.icon;
    return (
      <button
        key={it.id}
        type="button"
        onClick={() => onSelect?.(it.id)}
        aria-current={active ? "page" : undefined}
        className="cd-nav-item group flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
        style={{
          color: active ? "rgb(var(--accent-rgb))" : "var(--text-secondary)",
          background: active ? "var(--bg-tertiary)" : undefined,
        }}
      >
        {Ico ? <Ico size={13} sw={1.25} /> : <span className="inline-block h-[13px] w-[13px]" />}
        <span className="flex-1 truncate" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>
          {it.label}
        </span>
        {it.kbd && (
          <span className="text-[var(--text-muted)]" style={KBD}>
            {it.kbd}
          </span>
        )}
      </button>
    );
  };

  return (
    <nav
      className="cd-nav flex h-full w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-[var(--bg)] px-2 py-3"
      style={{ borderColor: "var(--border-subtle)" }}
      aria-label="Deck navigation"
    >
      {brand && (
        <div className="mb-2 flex items-center gap-2.5 px-2 py-1">
          <span
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)]"
            style={{ background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)" }}
            aria-hidden="true"
          >
            ◆
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[var(--text-primary)]" style={{ fontFamily: "var(--font-display)", fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-heading, 600)" }}>
              {brand.name}
            </span>
            {brand.sub && (
              <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={EYEBROW}>
                {brand.sub}
              </span>
            )}
          </span>
        </div>
      )}

      <div className="cd-eyebrow mt-1 px-2 py-1 uppercase text-[var(--text-muted)]" style={EYEBROW}>
        Surfaces
      </div>
      {items.map(renderItem)}

      {sessionItems.length > 0 && (
        <>
          <div className="cd-eyebrow mt-3 px-2 py-1 uppercase text-[var(--text-muted)]" style={EYEBROW}>
            Session
          </div>
          {sessionItems.map(renderItem)}
        </>
      )}

      {now && (
        <div className="mt-auto border-t px-2 pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="cd-eyebrow uppercase text-[var(--text-muted)]" style={EYEBROW}>
            Now
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "rgb(var(--accent-rgb))" }} aria-hidden="true" />
            <span className="truncate text-[var(--text-secondary)]" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>
              {now.title}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {now.stats.map((s) => (
              <div key={s.label} className="flex flex-col">
                <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={KBD}>
                  {s.label}
                </span>
                <span className="text-[var(--text-primary)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

export default DeckNav;
