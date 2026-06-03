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

import { EmptyState } from "@/components/chat/v2/ui";

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
      <EmptyState
        className="cd-gallery min-h-0"
        role="status"
        loading={loading}
        loadingLabel="loading outputs…"
        title={emptyTitle}
        description={emptyLabel}
      />
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
