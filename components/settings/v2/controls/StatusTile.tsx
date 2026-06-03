"use client";

/**
 * StatusTile — a live-readout cell for the "front-and-center" surfaces.
 *
 * A mono eyebrow label, a big value, a status dot (green ok / amber warn / muted
 * idle / accent live), an optional tiny inline sparkline drawn from a number
 * series, and an inline action slot (a button/link a mockup supplies). Used for
 * things like the active model, VRAM headroom, run cost budget — readouts that
 * sit above the controls. `cd-settings-tile`, token-only.
 */

import type { ReactNode } from "react";

export type TileStatus = "ok" | "warn" | "idle" | "live";

export interface StatusTileProps {
  label: string;
  value: ReactNode;
  status?: TileStatus;
  /** Tiny inline bar series, normalized to its own max. */
  spark?: number[];
  /** Inline action slot (e.g. a ghost button). */
  action?: ReactNode;
}

const STATUS_DOT: Record<TileStatus, string> = {
  ok: "#3fb950",
  warn: "#d29922",
  idle: "var(--text-muted)",
  live: "rgb(var(--accent-rgb))",
};

export function StatusTile({ label, value, status, spark, action }: StatusTileProps) {
  return (
    <div
      className="cd-settings-tile flex flex-col gap-1.5 rounded-[var(--radius)] border bg-[var(--bg-secondary)] p-3"
      style={{ borderColor: "var(--border-subtle)" }}
      data-status={status}
    >
      <div className="flex items-center justify-between gap-2">
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
        {status && (
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full${status === "live" ? " animate-pulse" : ""}`}
            style={{ background: STATUS_DOT[status] }}
            title={status}
            aria-label={`status: ${status}`}
            role="status"
          />
        )}
      </div>

      <div
        className="text-[var(--text-primary)]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-base)",
          fontWeight: "var(--fw-strong, 600)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>

      {spark && spark.length > 0 && (
        <div className="cd-settings-tile-spark flex h-5 items-end gap-px" aria-hidden="true">
          {(() => {
            const max = Math.max(...spark, 1);
            return spark.map((v, i) => (
              <span
                key={i}
                className="flex-1 rounded-[1px]"
                style={{
                  height: `${Math.max(8, (v / max) * 100)}%`,
                  background: status === "live" ? "rgb(var(--accent-rgb))" : "var(--text-muted)",
                  opacity: status === "live" ? 0.9 : 0.5,
                }}
              />
            ));
          })()}
        </div>
      )}

      {action && <div className="cd-settings-tile-action mt-0.5 flex items-center">{action}</div>}
    </div>
  );
}

export default StatusTile;
