"use client";

import type { ViewMode } from "./types";

/**
 * Shared view toggle used by every render path of RunsPane. List and GLYPH
 * are the legacy views; Metrics and Approvals are new.
 */
export function RunsViewToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}) {
  const options: Array<{ id: ViewMode; label: string }> = [
    { id: "list", label: "List" },
    { id: "metrics", label: "Metrics" },
    { id: "approvals", label: "Approvals" },
    { id: "glyph", label: "GLYPH" },
  ];
  return (
    <div className="flex rounded-[6px] overflow-hidden border border-[var(--border)] bg-[var(--bg-tertiary)]">
      {options.map((opt) => {
        const active = viewMode === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => setViewMode(opt.id)}
            className={`px-3 py-1 text-xs font-medium transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] ${
              active
                ? "bg-[var(--accent)] text-white rounded-[6px]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
