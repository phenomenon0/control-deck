"use client";

import { RunsViewToggle } from "./RunsViewToggle";
import type { ViewMode } from "./types";

/**
 * RunsHeader — the page-level title block above each view.
 *
 * Variants:
 *   - "list"      (default) — "Runs" overview header + Clear button
 *   - "metrics"   — "Telemetry" header
 *   - "approvals" — "Approvals" header
 * GLYPH view has its own header in GlyphView because it embeds extra actions.
 */
export function RunsHeader({
  viewMode,
  setViewMode,
  onClear,
}: {
  viewMode: Exclude<ViewMode, "glyph">;
  setViewMode: (v: ViewMode) => void;
  onClear?: () => void;
}) {
  const copy = headerCopyFor(viewMode);
  return (
    <header className="runs-head">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="label">{copy.label}</div>
          <h1>{copy.title}</h1>
          <p>{copy.blurb}</p>
        </div>
        <div className="warp-pane-actions">
          <RunsViewToggle viewMode={viewMode} setViewMode={setViewMode} />
          {viewMode === "list" && onClear && (
            <button onClick={onClear} className="btn btn-secondary text-xs">
              Clear
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function headerCopyFor(viewMode: Exclude<ViewMode, "glyph">) {
  switch (viewMode) {
    case "metrics":
      return {
        label: "Runs",
        title: "Telemetry",
        blurb: "Cost, latency, tool usage, error rate — rolled up from local history.",
      };
    case "approvals":
      return {
        label: "Runs",
        title: "Approvals",
        blurb: "Tool calls waiting for user sign-off before dispatch.",
      };
    case "list":
    default:
      return {
        label: "Control / Overview",
        title: "Runs",
        blurb: "Blended view of every surface in the Control plane — jump in, or scan the run history below.",
      };
  }
}
