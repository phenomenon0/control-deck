"use client";

/**
 * SettingGroup + SettingSection — structural containers for the kit.
 *
 *   - SettingGroup is a flat card (a bordered surface) holding a cluster of
 *     SettingRows, with an optional title. `cd-settings-group`.
 *   - SettingSection is a titled, anchorable region (its `id` is the scroll
 *     target for the SettingsSearch jump / nav rail). `cd-settings-section`.
 *
 * Token-only, no provider imports.
 */

import type { ReactNode } from "react";

// ── SettingGroup (card) ──────────────────────────────────────────────────────
export interface SettingGroupProps {
  title?: string;
  children: ReactNode;
}

export function SettingGroup({ title, children }: SettingGroupProps) {
  return (
    <div
      className="cd-settings-group rounded-[var(--radius)] border bg-[var(--bg-secondary)]"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {title && (
        <div
          className="cd-settings-group-title border-b px-4 py-2.5 uppercase text-[var(--text-secondary)]"
          style={{
            borderColor: "var(--border-subtle)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-xs)",
            letterSpacing: "var(--tracking-label, 0.04em)",
            fontWeight: "var(--fw-label, 500)",
          }}
        >
          {title}
        </div>
      )}
      <div className="cd-settings-group-body divide-y px-4 [&>*]:border-[var(--border-subtle)]">{children}</div>
    </div>
  );
}

// ── SettingSection (titled, anchorable region) ───────────────────────────────
export interface SettingSectionProps {
  /** Scroll-anchor id (used by the nav rail / search jump). */
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingSection({ id, title, description, children }: SettingSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="cd-settings-section flex scroll-mt-4 flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <h2
          id={`${id}-heading`}
          className="cd-settings-section-title text-[var(--text-primary)]"
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
          <p className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-xs)" }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export default SettingGroup;
