"use client";

/**
 * EmptyState (v2 coherence primitive) — the one empty/placeholder shape the deck
 * shares. Folds three divergent hero empties (ChatTimeline / OutputGallery /
 * ChatSurfaceV2 each used a different title font-size formula) and the inline
 * list empties (ThreadSidebar / WorkflowLibrary / JobQueue) into one component
 * with a built-in `loading` branch.
 *
 *   - `variant="hero"`   centered display-font title + subtitle (welcome / empty
 *                        gallery / empty canvas). Title carries `cd-empty-title`.
 *   - `variant="inline"` a quiet muted line for list panels.
 *
 * One canonical title size token (`--text-2xl`, fallback 1.75rem) replaces the
 * three competing formulas.
 */

import React from "react";

import { cx } from "./cx";

export type EmptyStateVariant = "hero" | "inline";

// Omit the DOM `title` attribute — we repurpose `title` as the heading content
// (ReactNode), which is incompatible with HTMLAttributes' `title?: string`.
export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  variant?: EmptyStateVariant;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** When true, shows a pulsing loading line instead of the empty copy. */
  loading?: boolean;
  loadingLabel?: string;
  /** Render the inline copy in the mono face (e.g. ThreadSidebar). */
  mono?: boolean;
}

export function EmptyState({
  variant = "hero",
  title,
  description,
  icon,
  loading = false,
  loadingLabel = "Loading…",
  mono = false,
  className,
  ...rest
}: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <p
        className={cx("cd-empty cd-empty-inline px-3 py-6 text-[var(--text-muted)]", className)}
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: mono ? "var(--font-size-xs)" : "var(--font-size-sm)",
        }}
        {...rest}
      >
        {loading ? <span className="motion-safe:animate-pulse">{loadingLabel}</span> : description ?? title}
      </p>
    );
  }

  return (
    <div
      className={cx(
        "cd-empty flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
      {...rest}
    >
      {icon && <div className="text-[var(--text-muted)]">{icon}</div>}
      {loading ? (
        <span
          className="motion-safe:animate-pulse text-[var(--text-muted)]"
          style={{ fontSize: "var(--font-size-sm)" }}
        >
          {loadingLabel}
        </span>
      ) : (
        <>
          {title && (
            <h2
              className="cd-empty-title text-[var(--text-primary)]"
              style={{
                fontFamily: "var(--font-display, var(--font-sans))",
                fontSize: "var(--text-2xl, 1.75rem)",
                fontWeight: "var(--fw-heading, 600)",
                letterSpacing: "var(--tracking-tight, -0.01em)",
              }}
            >
              {title}
            </h2>
          )}
          {description && (
            <p className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>
              {description}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default EmptyState;
