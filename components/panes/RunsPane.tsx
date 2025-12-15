"use client";

import { useState, useEffect } from "react";

interface Run {
  id: string;
  thread_id: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "finished" | "error";
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  preview: string | null;
}

interface TodayCost {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function RunsPane() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [todayCost, setTodayCost] = useState<TodayCost | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRuns = async () => {
    try {
      const res = await fetch("/api/agui/runs");
      const data = await res.json();
      setRuns(data.runs ?? []);
      setTodayCost(data.todayCost ?? null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
    // SSE for live updates
    const es = new EventSource("/api/agui/stream");
    es.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.type === "RunStarted" || evt.type === "RunFinished" || evt.type === "RunError") {
        fetchRuns();
      }
    };
    return () => es.close();
  }, []);

  const handleClear = async () => {
    if (!confirm("Clear all run history?")) return;
    await fetch("/api/agui/runs", { method: "DELETE" });
    fetchRuns();
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return "...";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const statusBadge = (status: Run["status"]) => {
    switch (status) {
      case "running":
        return <span className="badge badge-warning">Running</span>;
      case "finished":
        return <span className="badge badge-success">Done</span>;
      case "error":
        return <span className="badge badge-error">Error</span>;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="pane-header">
        <span className="pane-title">Runs</span>
        <div className="flex items-center gap-4">
          {todayCost && (
            <div className="text-xs text-[var(--text-muted)]">
              Today: {todayCost.inputTokens.toLocaleString()} in / {todayCost.outputTokens.toLocaleString()} out
              {todayCost.costUsd > 0 && ` ($${todayCost.costUsd.toFixed(4)})`}
            </div>
          )}
          <button onClick={handleClear} className="btn btn-secondary text-xs">
            Clear
          </button>
        </div>
      </div>

      {/* Runs list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-[var(--text-muted)]">Loading...</div>
        ) : runs.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)]">
            <div className="text-4xl mb-4">📊</div>
            <p>No runs yet</p>
            <p className="text-sm mt-2">Chat with the AI to see runs appear here</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-tertiary)] sticky top-0">
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Tokens</th>
                <th className="px-4 py-2 font-medium">Preview</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => setSelectedRun(run.id === selectedRun ? null : run.id)}
                  className={`border-b border-[var(--border)] cursor-pointer transition-colors ${
                    selectedRun === run.id
                      ? "bg-[var(--accent)]/10"
                      : "hover:bg-[var(--bg-tertiary)]"
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatTime(run.started_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge badge-neutral">{run.model ?? "unknown"}</span>
                  </td>
                  <td className="px-4 py-3">{statusBadge(run.status)}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {formatDuration(run.started_at, run.ended_at)}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {run.input_tokens + run.output_tokens > 0
                      ? `${run.input_tokens} / ${run.output_tokens}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] max-w-xs truncate">
                    {run.preview ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
