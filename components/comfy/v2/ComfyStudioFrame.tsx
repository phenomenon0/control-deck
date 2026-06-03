"use client";

/**
 * ComfyStudioFrame (comfy v2) — the centerpiece wrapper around the REAL
 * embedded ComfyUI.
 *
 * The deck does NOT reimplement ComfyUI; it embeds the real app (Electron
 * <webview> / browser <iframe> at NEXT_PUBLIC_COMFY_URL) and frames it with
 * deck-native, themeable chrome. This leaf owns ONLY that chrome — the top bar
 * (eyebrow/title, status slot, opt-in reload / open-external / capture buttons)
 * and the per-state body. The ComfyUI canvas interior is never themed.
 *
 * Render strategy (so it's verifiable in Storybook AND embeds the real studio
 * when live):
 *   - `embedState` drives the body.
 *   - The leaf NEVER mounts an iframe itself. The live container passes
 *     `renderEmbed({ studioUrl, embedState })` returning the real dual-embed.
 *   - Stories pass `embedState="placeholder"` and omit `renderEmbed` → the
 *     leaf draws an internal <MockStudioGraphic/>; :8188 is never contacted.
 *
 * Opt-in chrome actions gate their buttons (omit `onReload` → no reload button).
 * Hooks: `cd-studio`, `cd-studio-bar` (+ reuse `cd-header`), `cd-statuspill`.
 */

import React from "react";

export type StudioEmbedState = "loading" | "ready" | "failed" | "offline" | "placeholder";

export interface ComfyStudioFrameProps {
  /** Drives the frame body. "placeholder" = stories/never-live mock. */
  embedState: StudioEmbedState;
  /** Studio URL shown in chrome + handed to the live embed. */
  studioUrl?: string;
  /** Eyebrow label in the bar. */
  eyebrow?: string;
  /** Title in the bar. */
  title?: string;
  /**
   * Live embed renderer. Mounted only for non-placeholder states when provided;
   * stories omit it so nothing real is loaded.
   */
  renderEmbed?: (args: { studioUrl: string; embedState: StudioEmbedState }) => React.ReactNode;
  /** Status strip rendered under the bar (usually a <StudioStatusBar/>). */
  statusSlot?: React.ReactNode;
  /** Optional node at the far-left of the bar — e.g. a sidebar-collapse toggle. */
  leadingSlot?: React.ReactNode;
  // ── opt-in chrome actions ──
  onReload?: () => void;
  onOpenExternal?: () => void;
  onCapture?: () => void;
  captureBusy?: boolean;
}

const DEFAULT_URL = "http://127.0.0.1:8188";

export function ComfyStudioFrame({
  embedState,
  studioUrl = DEFAULT_URL,
  eyebrow = "ComfyUI Studio",
  title = "Live workflow surface",
  renderEmbed,
  statusSlot,
  leadingSlot,
  onReload,
  onOpenExternal,
  onCapture,
  captureBusy = false,
}: ComfyStudioFrameProps) {
  const unreachable = embedState === "failed" || embedState === "offline";

  return (
    <section
      className="cd-studio flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden"
      aria-label="ComfyUI studio"
    >
      <header
        className="cd-studio-bar cd-header flex items-center justify-between gap-3 border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {leadingSlot}
          <div className="flex min-w-0 flex-col">
            <span
              className="cd-eyebrow truncate text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
            >
              {eyebrow}
            </span>
            <strong
              className="truncate text-[var(--text-primary)]"
              style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-strong, 600)" }}
            >
              {title}
            </strong>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onReload && (
            <BarButton label="Reload Studio" onClick={onReload}>
              <ReloadIcon />
            </BarButton>
          )}
          {onCapture && (
            <BarButton label="Capture graph" onClick={onCapture} disabled={captureBusy}>
              <CaptureIcon />
            </BarButton>
          )}
          {onOpenExternal && (
            <BarButton label="Open ComfyUI externally" onClick={onOpenExternal}>
              <ExternalIcon />
            </BarButton>
          )}
        </div>
      </header>

      {statusSlot}

      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: "var(--bg-inset)" }}>
        {embedState === "ready" && renderEmbed ? (
          // Live: mount the real ComfyUI embed full-bleed — it owns this space.
          <div className="absolute inset-0">{renderEmbed({ studioUrl, embedState })}</div>
        ) : (
          <>
            {/* The node canvas fills the whole surface — ComfyUI IS the surface. */}
            <MockStudioCanvas dimmed={embedState === "loading" || unreachable} />
            {embedState === "loading" && (
              <span
                className="absolute bottom-3 left-3 z-10 animate-pulse rounded-[var(--radius-sm)] border px-2 py-1 text-[var(--text-muted)]"
                style={{ borderColor: "var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
              >
                Loading ComfyUI Studio…
              </span>
            )}
            {unreachable && (
              <div className="absolute inset-0 z-10 flex items-center justify-center p-6" role="alert">
                <div
                  className="flex max-w-sm flex-col items-center gap-1 rounded-[var(--radius)] border p-5 text-center"
                  style={{ borderColor: "var(--border-subtle)", background: "color-mix(in srgb, var(--bg-inset) 88%, transparent)" }}
                >
                  <span style={{ color: "#ff8b8b", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                    {embedState === "offline" ? "studio offline" : "studio unreachable"}
                  </span>
                  <span className="text-[var(--text-secondary)]" style={{ fontSize: "var(--font-size-sm)" }}>
                    ComfyUI is not reachable at{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>{studioUrl}</span>
                  </span>
                  {(onReload || onOpenExternal) && (
                    <div className="mt-2 flex items-center gap-2">
                      {onReload && (
                        <PanelButton label="Retry" onClick={onReload}>
                          retry
                        </PanelButton>
                      )}
                      {onOpenExternal && (
                        <PanelButton label="Open externally" onClick={onOpenExternal}>
                          open in browser
                        </PanelButton>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * A neutral, themeable, FULL-BLEED stand-in for the ComfyUI node canvas — a
 * dot-grid field with node cards spread across it and wiring between them. This
 * fills the entire studio area because, live, the real ComfyUI canvas does the
 * same: the embed IS the surface. Purely decorative (aria-hidden, label-free so
 * it never raises text-contrast); the accent node's title bar is the frame's
 * CssCheck anchor.
 */
const MOCK_NODES = [
  { left: "7%", top: "20%" },
  { left: "33%", top: "44%", accent: true },
  { left: "58%", top: "24%" },
  { left: "70%", top: "62%" },
  { left: "20%", top: "70%" },
] as const;

function MockStudioCanvas({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 select-none"
      style={{
        opacity: dimmed ? 0.4 : 1,
        backgroundImage: "radial-gradient(var(--border-subtle) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      {/* wiring — a 0..100 viewBox (stretched) + non-scaling strokes keeps the
          links tracking the node field at any frame size with crisp 1px lines */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      >
        <path d="M11 24 C 20 24, 28 49, 37 49" vectorEffect="non-scaling-stroke" />
        <path d="M37 49 C 50 49, 52 29, 62 29" vectorEffect="non-scaling-stroke" />
        <path d="M37 49 C 56 49, 60 67, 74 67" vectorEffect="non-scaling-stroke" />
        <path d="M24 75 C 30 75, 32 50, 37 49" vectorEffect="non-scaling-stroke" />
      </svg>
      {MOCK_NODES.map((n, i) => (
        <MockNode key={i} style={{ left: n.left, top: n.top }} accent={"accent" in n && n.accent} />
      ))}
    </div>
  );
}

function MockNode({ style, accent = false }: { style: React.CSSProperties; accent?: boolean }) {
  return (
    <div
      className="absolute h-12 w-24 overflow-hidden rounded-[var(--radius-sm)] border"
      style={{ ...style, background: "var(--bg-secondary)", borderColor: accent ? "rgb(var(--accent-rgb))" : "var(--border-subtle)" }}
    >
      {/* title bar — accent on the active node (CssCheck anchor) */}
      <div className="h-3 w-full" style={{ background: accent ? "rgb(var(--accent-rgb))" : "var(--bg-tertiary)" }} />
      {/* param "ports" */}
      <div className="flex flex-col gap-1.5 p-2">
        <div className="h-0.5 w-3/4 rounded-full" style={{ background: "var(--border-subtle)" }} />
        <div className="h-0.5 w-1/2 rounded-full" style={{ background: "var(--border-subtle)" }} />
      </div>
    </div>
  );
}

function BarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function PanelButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-[var(--radius-sm)] border px-2 py-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      style={{ borderColor: "var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
    >
      {children}
    </button>
  );
}

function ReloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function CaptureIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h3l2-2h8l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export default ComfyStudioFrame;
