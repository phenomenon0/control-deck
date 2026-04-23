"use client";

import { useState } from "react";
import { GlyphCard } from "./GlyphCard";
import { RunsViewToggle } from "./RunsViewToggle";
import type { GlyphEvalResults, GlyphItem, ViewMode } from "./types";

export function GlyphView({
  viewMode,
  setViewMode,
  payloads,
  onRefresh,
}: {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  payloads: GlyphItem[];
  onRefresh: () => void;
}) {
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResults, setEvalResults] = useState<GlyphEvalResults | null>(null);

  const runEval = async () => {
    setEvalRunning(true);
    setEvalResults(null);
    try {
      const res = await fetch("/api/tools/glyph-eval", { method: "POST" });
      const data = await res.json();
      setEvalResults(data);
    } catch (err) {
      console.error("Eval failed:", err);
    } finally {
      setEvalRunning(false);
    }
  };

  return (
    <div className="runs-stage runs-stage--real">
      <header className="runs-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Payloads</div>
            <h1>Payload Inspector</h1>
            <p>Tool arguments and results collected from recent real runs.</p>
          </div>
          <div className="warp-pane-actions">
            <RunsViewToggle viewMode={viewMode} setViewMode={setViewMode} />
            <span className="pill--mono">
              {payloads.length} payload{payloads.length !== 1 ? "s" : ""} found
            </span>
            <button onClick={runEval} disabled={evalRunning} className="btn btn-secondary text-xs">
              {evalRunning ? "Testing..." : "Test GLYPH Parsing"}
            </button>
            <button onClick={onRefresh} className="btn btn-secondary text-xs">
              Refresh
            </button>
          </div>
        </div>
      </header>

      {evalResults && (
        <div
          className={`px-4 py-2 border-b border-[var(--border)] ${
            evalResults.passed === evalResults.total
              ? "bg-green-500/10"
              : evalResults.passed > 0
                ? "bg-yellow-500/10"
                : "bg-red-500/10"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`text-sm font-medium ${
                  evalResults.passed === evalResults.total
                    ? "text-green-400"
                    : evalResults.passed > 0
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                {evalResults.passed}/{evalResults.total} questions passed
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                GLYPH: {evalResults.glyphSize} chars ({evalResults.savings.toFixed(1)}% savings)
              </span>
            </div>
            <button
              onClick={() => setEvalResults(null)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Dismiss
            </button>
          </div>
          {evalResults.failed > 0 && (
            <div className="mt-2 space-y-1">
              {evalResults.results
                .filter((r) => !r.passed)
                .map((r, i) => (
                  <div key={i} className="text-xs text-red-400">
                    <span className="opacity-75">Q: {r.question.slice(0, 50)}...</span>
                    <br />
                    <span>
                      Got: &quot;{r.answer.slice(0, 50)}&quot; (expected: &quot;{r.expected}&quot;)
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <div>
        {payloads.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4 opacity-40">@</div>
            <p className="text-base font-medium text-[var(--text-secondary)] mb-2">No tool payloads found</p>
            <p className="text-sm text-[var(--text-muted)] mb-6">Run a tool to see payloads here.</p>
            <button onClick={onRefresh} className="btn btn-primary text-sm">
              Refresh Payloads
            </button>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {payloads.map((item, idx) => (
              <div key={`${item.runId}-${idx}`}>
                <GlyphCard item={item} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
