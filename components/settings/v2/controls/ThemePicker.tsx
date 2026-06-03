"use client";

/**
 * ThemePicker — the high-traffic Appearance cluster: theme · warmth · accent,
 * each as a swatch SegmentedControl.
 *
 * These are MOCKUP controls — they emit a partial `{theme?, warmth?, accent?}`
 * patch via `onChange` and hold no global state. The selected accent swatch
 * fills with `rgb(var(--accent-rgb))` (the CssCheck anchor), so under the
 * dark+amber Storybook theme it reads rgb(212, 165, 116).
 *
 * The per-option preview swatches use literal hexes ONLY as static *content*
 * previews of what each named theme/accent would look like (a palette legend) —
 * not as the component's own chrome, which stays token-only. The currently
 * selected option's chrome is driven by the live accent token.
 */

import { Moon, Sun, Terminal, type LucideIcon } from "lucide-react";

export type ThemeName = "dark" | "light" | "hacker";
export type WarmthName = "cool" | "neutral" | "warm" | "ember";
export type AccentName = "mono" | "amber" | "ember" | "sage" | "graphite" | "rose" | "ultra";

export interface ThemeState {
  theme: ThemeName;
  warmth: WarmthName;
  accent: AccentName;
}

export interface ThemePickerProps {
  theme: ThemeName;
  warmth: WarmthName;
  accent: AccentName;
  onChange: (patch: Partial<ThemeState>) => void;
}

const THEME_ICON: Record<ThemeName, LucideIcon> = { dark: Moon, light: Sun, hacker: Terminal };

// Static preview swatches (legend only — not the component's own chrome).
const WARMTH_SWATCH: Record<WarmthName, string> = {
  cool: "#7c98b3",
  neutral: "#9aa0a6",
  warm: "#c49a6c",
  ember: "#c4633f",
};
const ACCENT_SWATCH: Record<AccentName, string> = {
  mono: "#9aa0a6",
  amber: "#d4a574",
  ember: "#c4633f",
  sage: "#88a07a",
  graphite: "#5c6066",
  rose: "#c47a8f",
  ultra: "#8a7ad4",
};

const THEMES: ThemeName[] = ["dark", "light", "hacker"];
const WARMTHS: WarmthName[] = ["cool", "neutral", "warm", "ember"];
const ACCENTS: AccentName[] = ["mono", "amber", "ember", "sage", "graphite", "rose", "ultra"];

export function ThemePicker({ theme, warmth, accent, onChange }: ThemePickerProps) {
  return (
    <div className="cd-settings-themepicker flex flex-col gap-4">
      {/* Theme */}
      <Field label="Theme">
        <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-1.5">
          {THEMES.map((t) => {
            const Icon = THEME_ICON[t];
            const selected = t === theme;
            return (
              <Swatch
                key={t}
                selected={selected}
                label={t}
                ariaLabel={`Theme: ${t}`}
                onClick={() => onChange({ theme: t })}
              >
                <Icon size={13} aria-hidden="true" />
                <span className="capitalize">{t}</span>
              </Swatch>
            );
          })}
        </div>
      </Field>

      {/* Warmth */}
      <Field label="Warmth">
        <div role="radiogroup" aria-label="Warmth" className="flex flex-wrap gap-1.5">
          {WARMTHS.map((w) => (
            <Swatch
              key={w}
              selected={w === warmth}
              label={w}
              ariaLabel={`Warmth: ${w}`}
              onClick={() => onChange({ warmth: w })}
            >
              <Dot color={WARMTH_SWATCH[w]} />
              <span className="capitalize">{w}</span>
            </Swatch>
          ))}
        </div>
      </Field>

      {/* Accent — selected swatch chrome uses the live accent token. */}
      <Field label="Accent">
        <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-1.5">
          {ACCENTS.map((a) => {
            const selected = a === accent;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`Accent: ${a}`}
                onClick={() => onChange({ accent: a })}
                className="cd-settings-accent-swatch inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 transition-colors"
                style={{
                  // Selected swatch fills with the live accent token (CssCheck anchor).
                  background: selected ? "rgb(var(--accent-rgb))" : "var(--bg-tertiary)",
                  color: selected ? "var(--text-on-accent)" : "var(--text-secondary)",
                  borderColor: selected ? "rgb(var(--accent-rgb))" : "var(--border-subtle)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-sans)",
                  fontWeight: selected ? "var(--fw-strong, 600)" : 400,
                }}
              >
                <Dot color={ACCENT_SWATCH[a]} ring={selected} />
                <span className="capitalize">{a}</span>
              </button>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="uppercase text-[var(--text-muted)]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "calc(var(--font-size-xs) - 1px)",
          letterSpacing: "var(--tracking-label, 0.04em)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Swatch({
  selected,
  label,
  ariaLabel,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      title={label}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 transition-colors"
      style={{
        background: selected ? "var(--bg-elevated)" : "var(--bg-tertiary)",
        color: selected ? "var(--text-primary)" : "var(--text-secondary)",
        borderColor: selected ? "rgb(var(--accent-rgb))" : "var(--border-subtle)",
        fontSize: "var(--font-size-xs)",
        fontFamily: "var(--font-sans)",
        fontWeight: selected ? "var(--fw-strong, 600)" : 400,
      }}
    >
      {children}
    </button>
  );
}

function Dot({ color, ring }: { color: string; ring?: boolean }) {
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full"
      style={{ background: color, boxShadow: ring ? "0 0 0 1.5px var(--text-on-accent)" : "0 0 0 1px var(--border-subtle)" }}
      aria-hidden="true"
    />
  );
}

export default ThemePicker;
