"use client";

/**
 * Settings v2 — control primitives.
 *
 * The themeable, prop-driven inputs every ideology mockup composes from. They
 * are deliberately flat and token-only (DESIGN.md §5): 1px borders, accent only
 * where it signals an *active* choice, mono numerals on numeric fields.
 *
 * Accent rule (the CssCheck anchor): the Toggle "on" track and the selected
 * SegmentedControl segment fill with `rgb(var(--accent-rgb))`. Under the default
 * dark+amber Storybook theme that resolves to rgb(212, 165, 116), proving the
 * token cascade reached the control.
 *
 * Every element carries a `cd-settings-*` hook so regimes.css can restyle per
 * theme. No provider imports, no persistence — pure controlled inputs.
 */

import { useId } from "react";
import type { LucideIcon } from "lucide-react";

import type { Option } from "./types";

// ── Toggle ────────────────────────────────────────────────────────────────
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. Rendered visually only when no external label is wired. */
  label: string;
  id?: string;
}

export function Toggle({ checked, onChange, label, id }: ToggleProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <button
      type="button"
      role="switch"
      id={inputId}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="cd-settings-toggle relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors"
      style={{
        borderColor: checked ? "rgb(var(--accent-rgb))" : "var(--border)",
        background: checked ? "rgb(var(--accent-rgb))" : "var(--bg-tertiary)",
      }}
    >
      <span
        className="pointer-events-none inline-block h-3.5 w-3.5 rounded-full transition-transform"
        style={{
          background: checked ? "var(--text-on-accent)" : "var(--text-muted)",
          transform: checked ? "translateX(18px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────
export interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  id?: string;
  ariaLabel?: string;
}

export function Select<T extends string>({ value, onChange, options, id, ariaLabel }: SelectProps<T>) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="cd-settings-select relative inline-flex items-center">
      <select
        id={inputId}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full cursor-pointer appearance-none rounded-[var(--radius-sm)] border bg-[var(--bg-tertiary)] py-1 pl-2.5 pr-7 text-[var(--text-primary)] transition-colors"
        style={{ borderColor: "var(--border)", fontSize: "var(--font-size-sm)", fontFamily: "var(--font-sans)" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        className="pointer-events-none absolute right-2"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

// ── SegmentedControl ─────────────────────────────────────────────────────────
export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  ariaLabel: string;
  id?: string;
}

export function SegmentedControl<T extends string>({ value, onChange, options, ariaLabel, id }: SegmentedControlProps<T>) {
  const auto = useId();
  const groupId = id ?? auto;
  return (
    <div
      id={groupId}
      role="radiogroup"
      aria-label={ariaLabel}
      className="cd-settings-segment inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border p-0.5"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-inset)" }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        const Icon: LucideIcon | undefined = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            onClick={() => onChange(o.value)}
            className="cd-settings-segment-item inline-flex items-center gap-1 rounded-[calc(var(--radius-sm)-2px)] px-2 py-1 transition-colors"
            style={{
              background: selected ? "rgb(var(--accent-rgb))" : "transparent",
              color: selected ? "var(--text-on-accent)" : "var(--text-secondary)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--font-size-xs)",
              fontWeight: selected ? "var(--fw-strong, 600)" : 400,
            }}
          >
            {Icon && <Icon size={13} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────
export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Suffix shown next to the readout, e.g. "ms", "%". */
  unit?: string;
  ariaLabel: string;
  id?: string;
}

export function Slider({ value, onChange, min, max, step = 1, unit, ariaLabel, id }: SliderProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="cd-settings-slider flex items-center gap-2.5">
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cd-settings-slider-input h-1 flex-1 cursor-pointer appearance-none rounded-full"
        style={{ accentColor: "rgb(var(--accent-rgb))", background: "var(--bg-tertiary)" }}
      />
      <span
        className="min-w-[3ch] shrink-0 text-right text-[var(--text-secondary)]"
        style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
        aria-hidden="true"
      >
        {value}
        {unit ? <span className="text-[var(--text-muted)]">{unit}</span> : null}
      </span>
    </div>
  );
}

// ── TextField ────────────────────────────────────────────────────────────────
export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Render with mono font (paths, urls, ids). */
  mono?: boolean;
  ariaLabel?: string;
  id?: string;
}

export function TextField({ value, onChange, placeholder, mono, ariaLabel, id }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <input
      id={inputId}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="cd-settings-field w-full rounded-[var(--radius-sm)] border bg-[var(--bg-tertiary)] px-2.5 py-1 text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)]"
      style={{
        borderColor: "var(--border)",
        fontSize: "var(--font-size-sm)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      }}
    />
  );
}

// ── NumberField ──────────────────────────────────────────────────────────────
export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  id?: string;
}

export function NumberField({ value, onChange, min, max, step, ariaLabel, id }: NumberFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <input
      id={inputId}
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className="cd-settings-field w-20 rounded-[var(--radius-sm)] border bg-[var(--bg-tertiary)] px-2.5 py-1 text-right text-[var(--text-primary)] transition-colors"
      style={{ borderColor: "var(--border)", fontSize: "var(--font-size-sm)", fontFamily: "var(--font-mono)" }}
    />
  );
}
