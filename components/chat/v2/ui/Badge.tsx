"use client";

/**
 * Badge (v2 coherence primitive) — the tiny uppercase mono tag used for lanes,
 * runnable/reference, default/loaded/beta states. Replaces the inline `Badge`
 * helpers independently redefined in WorkflowLibrary (outline) and SettingRow
 * (solid). Carries a `cd-badge` hook for per-theme restyling.
 *
 *   - variant="outline" (default): 1px tinted border, transparent fill — the
 *     quiet meta-row badge (comfy lanes, reference/runnable).
 *   - variant="solid": filled pill — the louder settings badge (accent DEFAULT,
 *     muted neutral). `warn` stays outline in both since a filled warn reads as
 *     an error, not a hint.
 */

import React from "react";

import { cx } from "./cx";

export type BadgeTone = "muted" | "accent" | "warn";
export type BadgeVariant = "outline" | "solid";

interface Swatch {
  background: string;
  color: string;
  borderColor: string;
}

const STYLE: Record<BadgeVariant, Record<BadgeTone, Swatch>> = {
  outline: {
    muted: { background: "transparent", color: "var(--text-muted)", borderColor: "var(--border-subtle)" },
    accent: { background: "transparent", color: "rgb(var(--accent-rgb))", borderColor: "rgb(var(--accent-rgb))" },
    warn: { background: "transparent", color: "var(--warn,#d4a04a)", borderColor: "var(--warn,#d4a04a)" },
  },
  solid: {
    muted: { background: "var(--bg-tertiary)", color: "var(--text-muted)", borderColor: "var(--border-subtle)" },
    accent: { background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)", borderColor: "transparent" },
    warn: { background: "transparent", color: "var(--warn,#d4a04a)", borderColor: "var(--warn,#d4a04a)" },
  },
};

export interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, tone = "muted", variant = "outline", className }: BadgeProps) {
  const s = STYLE[variant][tone];
  return (
    <span
      className={cx("cd-badge inline-block rounded-[var(--radius-sm)] border px-1 py-px uppercase", className)}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "calc(var(--font-size-xs) - 1px)",
        letterSpacing: "var(--tracking-label, 0.02em)",
        background: s.background,
        color: s.color,
        borderColor: s.borderColor,
      }}
    >
      {children}
    </span>
  );
}

export default Badge;
