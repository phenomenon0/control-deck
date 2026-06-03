"use client";

/**
 * PanelHeader + SectionHeading (v2 coherence primitives).
 *
 * `PanelHeader` is the small eyebrow row atop list panels (ThreadSidebar,
 * comfy WorkflowLibrary/JobQueue, settings detail). The eyebrow was drifting
 * across surfaces (text-secondary vs text-muted, uppercase or not, px-3/4/5);
 * this standardizes on the ThreadSidebar treatment: mono uppercase muted
 * eyebrow + `cd-eyebrow` hook + optional right-aligned count or action slot.
 *
 * `SectionHeading` is the genuinely different display-font `<h2>` used by
 * settings sections (title + optional description).
 */

import React from "react";

import { cx } from "./cx";

export interface PanelHeaderProps {
  eyebrow: React.ReactNode;
  /** Quiet right-aligned count (e.g. item total or "loading…"). */
  count?: React.ReactNode;
  /** Right-aligned action slot (e.g. a new/close Button). Wins over `count`. */
  action?: React.ReactNode;
  border?: boolean;
  sticky?: boolean;
  className?: string;
}

export function PanelHeader({
  eyebrow,
  count,
  action,
  border = false,
  sticky = false,
  className,
}: PanelHeaderProps) {
  return (
    <header
      className={cx(
        "cd-panel-header flex items-center justify-between gap-2 px-3 py-2.5",
        border && "border-b border-[var(--border-subtle)]",
        sticky && "sticky top-0 z-10 bg-[var(--bg-secondary)]",
        className,
      )}
    >
      <span
        className="cd-eyebrow uppercase text-[var(--text-muted)]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-xs)",
          letterSpacing: "var(--tracking-label, 0.04em)",
        }}
      >
        {eyebrow}
      </span>
      {action ?? (count != null && count !== "" ? (
        <span
          className="text-[var(--text-muted)]"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
        >
          {count}
        </span>
      ) : null)}
    </header>
  );
}

export interface SectionHeadingProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}

export function SectionHeading({ title, description, className }: SectionHeadingProps) {
  return (
    <div className={cx("cd-section-heading", className)}>
      <h2
        className="text-[var(--text-primary)]"
        style={{
          fontFamily: "var(--font-display, var(--font-sans))",
          fontSize: "var(--font-size-base)",
          fontWeight: "var(--fw-heading, 600)",
          letterSpacing: "var(--tracking-tight, -0.01em)",
        }}
      >
        {title}
      </h2>
      {description && (
        <p className="mt-0.5 text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>
          {description}
        </p>
      )}
    </div>
  );
}

export default PanelHeader;
