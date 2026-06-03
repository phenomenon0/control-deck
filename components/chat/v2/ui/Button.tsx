"use client";

/**
 * Button (v2 coherence primitive) — the single token-driven button the whole
 * deck shares, replacing the ~60 hand-rolled buttons across chat/comfy/settings.
 *
 * Design rules it bakes in (so every surface gets them for free):
 *   - One **focus-visible ring** in the accent colour. Previously only one v2
 *     button had a focus state; now all do.
 *   - All colour states (idle/hover/accent) are driven by arbitrary-value
 *     Tailwind classes, NOT inline `style`. Mixing inline-style colours with
 *     `hover:`/`focus-visible:` variants silently kills the variant (a known v2
 *     gotcha), so colour lives entirely in classes here.
 *   - `--radius-sm` corners + `transition-colors` + disabled dimming, uniform.
 *
 * Variants: accent (CTA) · outline (secondary) · ghost (quiet) · destructive.
 * Sizes:    sm · md · icon (square, for icon-only actions — the old
 *           RowAction/OverlayAction helpers collapse into `size="icon"`).
 */

import React, { forwardRef } from "react";

import { cx } from "./cx";

export type ButtonVariant = "accent" | "outline" | "ghost" | "destructive" | "onMedia";
export type ButtonSize = "sm" | "md" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] " +
  "transition-colors disabled:opacity-50 disabled:pointer-events-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset " +
  "focus-visible:ring-[rgb(var(--accent-rgb))]";

const VARIANT: Record<ButtonVariant, string> = {
  accent:
    "bg-[rgb(var(--accent-rgb))] text-[var(--text-on-accent)] font-medium hover:opacity-90",
  outline:
    "border border-[var(--border-subtle)] text-[var(--text-secondary)] " +
    "hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]",
  ghost:
    "text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]",
  destructive:
    "border border-[var(--border-subtle)] text-[var(--text-secondary)] " +
    "hover:border-[var(--err,#d05a5a)] hover:text-[var(--err,#d05a5a)]",
  // Sits over media (e.g. an image result tile) — white, theme-independent.
  onMedia: "text-white/90 hover:bg-white/15 hover:text-white",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2 py-0.5 text-[length:var(--font-size-xs)]",
  md: "px-2.5 py-1 text-[length:var(--font-size-sm)]",
  icon: "grid h-7 w-7 place-items-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Replaces content with a spinner and disables the button. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("cd-btn", BASE, VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="motion-safe:animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default Button;
