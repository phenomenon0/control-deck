"use client";

/**
 * OutputGallery (comfy v2) — the result surface of the image-workflow pane.
 *
 * The deck-native, read-only view of ComfyUI's outputs: a container feeds it
 * the job/output array derived from `/api/comfy/history` (images resolved via
 * `/api/comfy/view`). It does NOT generate — the embedded real ComfyUI owns
 * that — it only browses results.
 *
 * Arranges OutputCards in a responsive CSS-columns masonry so mixed aspect
 * ratios pack naturally (portrait next to landscape, no ragged grid rows).
 * Newest-first is the caller's responsibility — the gallery renders the array
 * order it's given.
 *
 * Prop-driven and stateless: it owns layout + empty/loading affordances and
 * forwards every per-card action callback straight through to OutputCard, so
 * the container wires actions once. Carries the `cd-gallery` class hook for
 * per-theme regimes.
 */

import { OutputCard, type GenerationOutput, type OutputCardProps } from "./OutputCard";

export interface OutputGalleryProps
  extends Pick<OutputCardProps, "onOpen" | "onSendToChat" | "onUseAsInput" | "onDownload" | "onDelete" | "onRetry"> {
  outputs: GenerationOutput[];
  /** Show a skeleton/loading hint instead of the empty state. */
  loading?: boolean;
  /** Big display-font headline for the empty state. */
  emptyTitle?: string;
  /** Subtitle under the empty headline. */
  emptyLabel?: string;
  /** Minimum masonry column width in px (drives responsive column count). */
  columnWidth?: number;
}

export function OutputGallery({
  outputs,
  loading = false,
  emptyTitle = "Nothing generated yet",
  emptyLabel = "Run a workflow to fill the canvas.",
  columnWidth = 240,
  ...actions
}: OutputGalleryProps) {
  if (outputs.length === 0) {
    return (
      <div
        className="cd-gallery flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 py-12 text-center"
        role="status"
      >
        {loading ? (
          <span
            className="animate-pulse text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)" }}
          >
            loading outputs…
          </span>
        ) : (
          <>
            <h2
              className="cd-empty-title m-0 text-[var(--text-primary)]"
              style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: "1.75rem", fontWeight: "var(--fw-heading, 600)" }}
            >
              {emptyTitle}
            </h2>
            <p className="m-0 text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>
              {emptyLabel}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="cd-gallery h-full min-h-0 overflow-y-auto p-4"
      aria-label="Generated outputs"
      role="list"
      style={{
        columnWidth: `${columnWidth}px`,
        columnGap: "1rem",
      }}
    >
      {outputs.map((output) => (
        <div key={output.id} role="listitem" className="mb-4 break-inside-avoid">
          <OutputCard output={output} {...actions} />
        </div>
      ))}
    </div>
  );
}

export default OutputGallery;
