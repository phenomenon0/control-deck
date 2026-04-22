"use client";

import { ChevronRight } from "lucide-react";
import type { Run } from "./types";
import { formatDuration, formatTime } from "./types";

function statusDot(status: Run["status"]) {
  const base = "inline-block w-[6px] h-[6px] rounded-full flex-shrink-0";
  switch (status) {
    case "running":
      return <span className={`${base} bg-[var(--accent)]`} />;
    case "finished":
      return <span className={`${base} bg-[var(--success)]`} />;
    case "error":
      return <span className={`${base} bg-[var(--error)]`} />;
  }
}

export function RunsList({
  runs,
  loading,
  selectedRun,
  onSelect,
}: {
  runs: Run[];
  loading: boolean;
  selectedRun: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="runs-real-list">
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-12 text-center text-[var(--text-muted)]">Loading...</div>
        ) : runs.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-5xl mb-4 opacity-30">&#9654;</div>
            <p className="text-base font-medium text-[var(--text-secondary)] mb-2">No runs yet</p>
            <p className="text-sm text-[var(--text-muted)] mb-6">Chat with the AI to see runs appear here</p>
          </div>
        ) : (
          <div>
            {runs.map((run) => (
              <div
                key={run.id}
                onClick={() => onSelect(run.id === selectedRun ? null : run.id)}
                className={`px-4 py-3 cursor-pointer border-b border-[var(--border)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] ${
                  selectedRun === run.id
                    ? "bg-[rgba(255,255,255,0.06)]"
                    : "hover:bg-[rgba(255,255,255,0.04)]"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-3">
                    {statusDot(run.status)}
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {run.model ?? "unknown"}
                    </span>
                    <span className="font-mono text-xs text-[var(--text-muted)]">
                      {formatTime(run.started_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {(run.input_tokens > 0 || run.output_tokens > 0) && (
                      <span className="text-xs text-[var(--text-muted)] font-mono">
                        {run.input_tokens + run.output_tokens} tok
                      </span>
                    )}
                    <span className="text-xs text-[var(--text-muted)]">
                      {formatDuration(run.started_at, run.ended_at)}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  </div>
                </div>
                {run.preview && (
                  <p className="text-sm text-[var(--text-muted)] truncate ml-[23px]">
                    {run.preview}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
