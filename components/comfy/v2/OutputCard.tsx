"use client";

/**
 * OutputCard (comfy v2) — a single result tile for the image-workflow pane.
 *
 * The deck wraps the REAL ComfyUI (the embedded studio owns prompting + node
 * editing); this tile is the deck-native, read-only VIEW of what ComfyUI
 * produced. It's fed by `/api/comfy/history` (status → queued · generating ·
 * done · error) and `/api/comfy/view` (the result image URL), and renders one
 * of those four states from `output.status`.
 *
 * Fully controlled and prop-driven; every action is an OPT-IN callback (same
 * headless principle as the chat-v2 composer — pass `onSendToChat` to get the
 * button, omit it and the affordance disappears; no dead controls).
 *
 * No provider/hook dependencies. The container wires the callbacks to the
 * comfy pipeline. All display values are preformatted strings/numbers — no
 * Date or fetch in here — so stories are deterministic.
 *
 * Aesthetic follows the deck's flat token system (1px borders, no shadows,
 * mono meta, accent progress) via app/globals.css tokens, and carries the
 * `cd-output` class hook so per-theme regimes can restyle it.
 */

import React from "react";

export type OutputStatus = "queued" | "generating" | "done" | "error";

export interface GenerationOutput {
  id: string;
  status: OutputStatus;
  /** Result image URL — present when status is "done". */
  imageUrl?: string;
  /** 0..1 generation progress, drives the bar while "generating". */
  progress?: number;
  /** Pixel dimensions, shown in the meta footer + used for aspect ratio. */
  width?: number;
  height?: number;
  /** Seed used, shown as a mono meta chip. */
  seed?: number;
  /** Prompt text — used as the image alt and hover title. */
  prompt?: string;
  /** Workflow slug/name that produced this, shown as an eyebrow. */
  workflow?: string;
  /** Preformatted elapsed/queued label, e.g. "4.2s" (no Date in component). */
  elapsed?: string;
  /** Error message shown in the error state. */
  error?: string;
}

export interface OutputCardProps {
  output: GenerationOutput;
  /** Open/zoom the full image. */
  onOpen?: (id: string) => void;
  /** Send the image into chat as an attachment/reference. */
  onSendToChat?: (id: string) => void;
  /** Feed the image back as an input (img2img / inpaint). */
  onUseAsInput?: (id: string) => void;
  /** Download the image. */
  onDownload?: (id: string) => void;
  /** Remove this output. */
  onDelete?: (id: string) => void;
  /** Retry a failed generation. */
  onRetry?: (id: string) => void;
}

export function OutputCard({
  output,
  onOpen,
  onSendToChat,
  onUseAsInput,
  onDownload,
  onDelete,
  onRetry,
}: OutputCardProps) {
  const { status, imageUrl, progress = 0, width, height, seed, prompt, workflow, elapsed, error } = output;
  const ratio = width && height ? `${width} / ${height}` : "1 / 1";
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const isDone = status === "done" && Boolean(imageUrl);

  return (
    <figure
      className="cd-output group relative m-0 overflow-hidden rounded-[var(--radius)] border bg-[var(--bg-secondary)]"
      style={{ borderColor: "var(--border-subtle)", aspectRatio: ratio }}
    >
      {/* ── Visual layer ─────────────────────────────────────────── */}
      {isDone ? (
        <button
          type="button"
          onClick={onOpen ? () => onOpen(output.id) : undefined}
          aria-label={prompt ? `Open image: ${prompt}` : "Open image"}
          className="block h-full w-full cursor-zoom-in border-0 bg-transparent p-0"
          disabled={!onOpen}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={prompt ?? ""} className="h-full w-full object-cover" />
        </button>
      ) : status === "error" ? (
        <div
          role="alert"
          className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center"
          style={{ background: "color-mix(in srgb, #ff6b6b 8%, var(--bg-secondary))" }}
        >
          <span style={{ color: "#ff8b8b", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
            failed
          </span>
          <span className="line-clamp-3 text-[var(--text-secondary)]" style={{ fontSize: "var(--font-size-xs)" }}>
            {error ?? "Generation failed."}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(output.id)}
              className="mt-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              style={{ borderColor: "var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
            >
              retry
            </button>
          )}
        </div>
      ) : (
        <div
          role="status"
          aria-label={status === "queued" ? "Queued" : `Generating ${pct}%`}
          className="flex h-full w-full flex-col items-center justify-center gap-3 p-4"
        >
          {status === "generating" ? (
            <>
              <span
                className="text-[var(--text-secondary)]"
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
              >
                {pct}%
              </span>
              <div
                className="h-1 w-3/4 overflow-hidden rounded-full"
                style={{ background: "var(--bg-tertiary)" }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%`, background: "rgb(var(--accent-rgb))" }}
                />
              </div>
            </>
          ) : (
            <span
              className="animate-pulse text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
            >
              queued
            </span>
          )}
        </div>
      )}

      {/* ── Hover overlay: actions (top) + meta (bottom). Only on done. ── */}
      {isDone && (
        <figcaption className="pointer-events-none absolute inset-0 flex flex-col justify-between opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <div
            className="pointer-events-auto flex justify-end gap-1 p-2"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)" }}
          >
            {onSendToChat && (
              <OverlayAction label="Send to chat" onClick={() => onSendToChat(output.id)}>
                <ChatIcon />
              </OverlayAction>
            )}
            {onUseAsInput && (
              <OverlayAction label="Use as input" onClick={() => onUseAsInput(output.id)}>
                <RecycleIcon />
              </OverlayAction>
            )}
            {onDownload && (
              <OverlayAction label="Download" onClick={() => onDownload(output.id)}>
                <DownloadIcon />
              </OverlayAction>
            )}
            {onDelete && (
              <OverlayAction label="Delete" onClick={() => onDelete(output.id)}>
                <TrashIcon />
              </OverlayAction>
            )}
          </div>
          <div
            className="flex items-end justify-between gap-2 p-2"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              {workflow && (
                <span
                  className="cd-eyebrow truncate text-white/70"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
                >
                  {workflow}
                </span>
              )}
              {width && height && (
                <span
                  className="text-white/85"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
                >
                  {width}×{height}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
              {typeof seed === "number" && (
                <span className="text-white/70" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                  #{seed}
                </span>
              )}
              {elapsed && (
                <span className="text-white/70" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                  {elapsed}
                </span>
              )}
            </div>
          </div>
        </figcaption>
      )}
    </figure>
  );
}

function OverlayAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-white/90 transition-colors hover:bg-white/15 hover:text-white"
    >
      {children}
    </button>
  );
}

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function RecycleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export default OutputCard;
