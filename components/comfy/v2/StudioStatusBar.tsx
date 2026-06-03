"use client";

/**
 * StudioStatusBar (comfy v2) — the thin status strip above/below the embedded
 * ComfyUI studio.
 *
 * Reports whether the real ComfyUI engine is reachable (`health`) and how much
 * VRAM is in play. It's pure chrome: a container formats the figures from
 * `/api/comfy/status` + `/api/resource/ledger` (LedgerSnapshot) into preformatted
 * label strings — no math, Date, or fetch happens in here, so stories are
 * deterministic.
 *
 * Token-driven so it re-skins across every theme; the VRAM meter fill uses
 * rgb(var(--accent-rgb)). Carries `cd-statusbar` / `cd-statuspill` /
 * `cd-vram-meter` hooks for per-theme regimes.
 */

export type ComfyHealth = "online" | "offline" | "checking";

export interface StudioVram {
  /** 0..1 fraction of VRAM used — drives the meter fill width. */
  usedPct: number;
  /** Preformatted "11.8 GB" used. */
  usedLabel?: string;
  /** Preformatted "24 GB" total. */
  totalLabel?: string;
  /** Preformatted free-after-reserve, e.g. "9.4 GB". */
  availableLabel?: string;
  /** Preformatted reserved-by-arbiter, e.g. "2.0 GB". */
  reserveLabel?: string;
}

export interface StudioStatusBarProps {
  health: ComfyHealth;
  /** VRAM figures; omit for a pill-only bar. */
  vram?: StudioVram;
  /** Extra mono chips, e.g. `{ label: "jobs", value: "3" }`. */
  metrics?: Array<{ label: string; value: string }>;
}

// Universal status semantics (not theme accent — "online" should read green
// regardless of palette). Single source per the dot's color.
const HEALTH: Record<ComfyHealth, { color: string; label: string }> = {
  online: { color: "#3fb950", label: "online" },
  offline: { color: "#ff6b6b", label: "offline" },
  checking: { color: "#d29922", label: "checking" },
};

export function StudioStatusBar({ health, vram, metrics }: StudioStatusBarProps) {
  const h = HEALTH[health];
  const pct = Math.round(Math.min(1, Math.max(0, vram?.usedPct ?? 0)) * 100);

  return (
    <div
      className="cd-statusbar flex items-center gap-4 border-b px-3 py-2"
      style={{ borderColor: "var(--border-subtle)" }}
      role="status"
      aria-label={`ComfyUI ${h.label}`}
    >
      <span
        className="cd-statuspill inline-flex items-center gap-1.5 whitespace-nowrap"
        style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)" }}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full${health === "checking" ? " animate-pulse" : ""}`}
          style={{ background: h.color }}
          aria-hidden="true"
        />
        {h.label}
      </span>

      {vram && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="cd-eyebrow shrink-0 text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
          >
            VRAM
          </span>
          <div
            className="cd-vram-meter h-1.5 min-w-12 max-w-40 flex-1 overflow-hidden rounded-full"
            style={{ background: "var(--bg-tertiary)" }}
            role="meter"
            aria-label="VRAM usage"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${pct}%`, background: "rgb(var(--accent-rgb))" }}
            />
          </div>
          <span
            className="shrink-0 truncate text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
          >
            {[
              vram.usedLabel && vram.totalLabel ? `${vram.usedLabel} / ${vram.totalLabel}` : null,
              vram.availableLabel ? `${vram.availableLabel} free` : null,
              vram.reserveLabel ? `${vram.reserveLabel} reserved` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      )}

      {metrics && metrics.length > 0 && (
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {metrics.map((m) => (
            <span
              key={m.label}
              className="whitespace-nowrap text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
            >
              <span className="text-[var(--text-secondary)]">{m.value}</span> {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default StudioStatusBar;
