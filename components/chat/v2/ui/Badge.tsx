"use client";

/**
 * Badge (v2 coherence primitive) — the tiny uppercase tag used for lanes,
 * runnable/reference, accent/muted/warn states. Replaces the inline `Badge`
 * helpers independently redefined in WorkflowLibrary / SettingRow.
 *
 * Token-driven; carries a `cd-badge` hook for per-theme restyling.
 */

import React from "react";

import { cx } from "./cx";

export type BadgeTone = "muted" | "accent" | "warn";

const TONE: Record<BadgeTone, { border: string; color: string }> = {
  muted: { border: "var(--border-subtle)", color: "var(--text-muted)" },
  accent: { border: "rgb(var(--accent-rgb))", color: "rgb(var(--accent-rgb))" },
  warn: { border: "var(--warn,#d4a04a)", color: "var(--warn,#d4a04a)" },
};

export interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function Badge({ children, tone = "muted", className }: BadgeProps) {
  const t = TONE[tone];
  return (
    <span
      className={cx("cd-badge rounded-[var(--radius-sm)] border px-1 py-px uppercase", className)}
      style={{
        fontSize: "calc(var(--font-size-xs) - 1px)",
        letterSpacing: "var(--tracking-label, 0.02em)",
        borderColor: t.border,
        color: t.color,
      }}
    >
      {children}
    </span>
  );
}

export default Badge;
