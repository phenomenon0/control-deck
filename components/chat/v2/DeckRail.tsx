"use client";

/**
 * DeckRail (v2) — Slack-style left nav rail: slim, vertical, an icon-tile + a
 * small word per item. Thin enough to read as a utility strip (not a second
 * sidebar) — how Slack dodges the "double sidebar" problem (rail + list + content).
 *
 * Active state is deliberately *very distinct*: the icon sits in a filled,
 * accent-ringed tile with the accent color, and the word brightens + bolds —
 * inactive items are muted with a transparent tile. Token-driven (cd-rail /
 * cd-rail-item), so it themes everywhere.
 */

import React from "react";

export interface DeckRailItem {
  id: string;
  label: string;
  /** Any icon component taking `size` (lucide-react icons or warp Icons). Stroke
   *  weight/cap come from the per-theme --icon-sw tokens via icons.css. */
  icon?: React.ComponentType<{ size?: number }>;
}

export interface DeckRailProps {
  items: DeckRailItem[];
  activeId: string;
  onSelect: (id: string) => void;
  footerItems?: DeckRailItem[];
  brand?: boolean;
}

const WORD = { fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 2px)", letterSpacing: "0.01em" } as const;

export function DeckRail({ items, activeId, onSelect, footerItems = [], brand = true }: DeckRailProps) {
  const renderItem = (it: DeckRailItem) => {
    const on = it.id === activeId;
    const Ico = it.icon;
    return (
      <button
        key={it.id}
        type="button"
        onClick={() => onSelect(it.id)}
        aria-current={on ? "page" : undefined}
        title={it.label}
        className="cd-rail-item group/r flex w-full flex-col items-center gap-1 py-1"
      >
        <span
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] transition-colors group-hover/r:bg-[var(--bg-tertiary)]"
          style={
            on
              ? {
                  background: "var(--bg-elevated)",
                  color: "rgb(var(--accent-rgb))",
                  boxShadow: "inset 0 0 0 1px color-mix(in oklab, rgb(var(--accent-rgb)), transparent 60%)",
                }
              : { color: "var(--icon-idle, var(--text-secondary))" }
          }
        >
          {Ico ? <Ico size={16} /> : <span className="inline-block h-4 w-4" />}
        </span>
        <span
          className="leading-none transition-colors"
          style={{ ...WORD, color: on ? "var(--text-primary)" : "var(--text-muted)", fontWeight: on ? 600 : 400 }}
        >
          {it.label}
        </span>
      </button>
    );
  };

  return (
    <nav
      className="cd-rail flex h-full w-[64px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r px-1 py-2.5"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg)" }}
      aria-label="Deck rail"
    >
      {brand && (
        <span
          className="mb-2 grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[13px]"
          style={{ background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)" }}
          aria-hidden="true"
        >
          ◆
        </span>
      )}
      {items.map(renderItem)}
      {footerItems.length > 0 && <div className="mt-auto flex w-full flex-col gap-0.5">{footerItems.map(renderItem)}</div>}
    </nav>
  );
}

export default DeckRail;
