"use client";

/**
 * Low-level form primitives shared across every section. Matches the visual
 * language the existing SettingsDrawer uses (PrecisionToggle, SegmentControl,
 * AppleSelect) but re-homed here so the new pane doesn't reach into the
 * drawer's internals.
 */

import type { ReactNode } from "react";

export function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="settings-section-head">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
}

export function Panel({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="settings-panel">
      {title && <div className="settings-panel-title">{title}</div>}
      <div className="settings-panel-body">{children}</div>
      {footer && <div className="settings-panel-footer">{footer}</div>}
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <label>{label}</label>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`settings-toggle${checked ? " on" : ""}`}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  allowNull,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  allowNull?: boolean;
}) {
  return (
    <input
      type="number"
      className="settings-input settings-input-number"
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder ?? (allowNull ? "auto" : undefined)}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(allowNull ? null : 0);
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        onChange(n);
      }}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      className="settings-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      className="settings-select"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="settings-segment">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`settings-segment-btn${value === o.value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StubCard({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="settings-stub">
      <h3>{title}</h3>
      <p>{description}</p>
      {ctaHref && ctaLabel && (
        <a className="settings-stub-cta" href={ctaHref}>
          {ctaLabel} →
        </a>
      )}
    </div>
  );
}
