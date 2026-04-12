"use client";

import { useState, useEffect } from "react";
import { X, ChevronRight } from "lucide-react";
import { PayloadViewer } from "@/components/inspector/PayloadViewer";
import type { DeckPayload } from "@/lib/agui/payload";

type ViewMode = "list" | "glyph";

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

interface RunEvent {
  id: string;
  type: string;
  timestamp: string;
  threadId: string;
  runId: string;
  toolCallId?: string;
  toolName?: string;
  args?: DeckPayload;
  result?: DeckPayload;
  success?: boolean;
  durationMs?: number;
  delta?: string;
  error?: { message: string };
  [key: string]: unknown;
}

export function RunsPane() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [todayCost, setTodayCost] = useState<TodayCost | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [allGlyphPayloads, setAllGlyphPayloads] = useState<Array<{ runId: string; toolName: string; payload: DeckPayload; type: "args" | "result"; timestamp: string }>>([]);
  
  // GLYPH eval state
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResults, setEvalResults] = useState<{
    passed: number;
    failed: number;
    total: number;
    glyphSize: number;
    savings: number;
    results: Array<{ question: string; expected: string; answer: string; passed: boolean }>;
  } | null>(null);

  const fetchRuns = async () => {
    try {
      const res = await fetch("/api/agui/runs");
      const data = await res.json();
      setRuns(data.runs ?? []);
      setTodayCost(data.todayCost ?? null);
    } catch (err) {
      console.warn("[RunsPane] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRunEvents = async (runId: string) => {
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/agui/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      setRunEvents(data.events ?? []);
    } catch (err) {
      console.warn("[RunsPane] fetch run events failed:", err);
      setRunEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  };

  // Fetch all tool payloads from recent runs (shows all, highlights GLYPH)
  const fetchAllGlyphPayloads = async () => {
    const payloads: typeof allGlyphPayloads = [];
    
    // Build a map of toolCallId -> toolName from ToolCallStart events
    const toolNameMap: Record<string, string> = {};
    
    // Fetch events for each run and extract payloads
    for (const run of runs.slice(0, 20)) { // Limit to 20 most recent runs
      try {
        const res = await fetch("/api/agui/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.id }),
        });
        const data = await res.json();
        const events: RunEvent[] = data.events ?? [];
        
        // First pass: collect tool names
        for (const evt of events) {
          if (evt.type === "ToolCallStart" && evt.toolCallId && evt.toolName) {
            toolNameMap[evt.toolCallId] = evt.toolName;
          }
        }
        
        // Second pass: collect payloads
        for (const evt of events) {
          const toolName = evt.toolName || (evt.toolCallId ? toolNameMap[evt.toolCallId] : undefined) || "unknown";
          
          if (evt.type === "ToolCallArgs" && evt.args) {
            payloads.push({
              runId: run.id,
              toolName,
              payload: evt.args,
              type: "args",
              timestamp: evt.timestamp,
            });
          }
          if (evt.type === "ToolCallResult" && evt.result) {
            payloads.push({
              runId: run.id,
              toolName,
              payload: evt.result,
              type: "result",
              timestamp: evt.timestamp,
            });
          }
        }
      } catch (err) {
        console.warn("[RunsPane] fetch run events failed:", err);
      }
    }
    
    // Sort by timestamp descending
    payloads.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setAllGlyphPayloads(payloads);
  };

  // Fetch GLYPH payloads when switching to GLYPH view
  useEffect(() => {
    if (viewMode === "glyph" && runs.length > 0) {
      fetchAllGlyphPayloads();
    }
  }, [viewMode, runs]);

  useEffect(() => {
    fetchRuns();
    // SSE for live updates
    const es = new EventSource("/api/agui/stream");
    es.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.type === "RunStarted" || evt.type === "RunFinished" || evt.type === "RunError") {
        fetchRuns();
      }
      // Refresh events if we're viewing the updated run
      if (selectedRun && evt.runId === selectedRun) {
        fetchRunEvents(selectedRun);
      }
    };
    return () => es.close();
  }, [selectedRun]);

  // Fetch events when selecting a run
  useEffect(() => {
    if (selectedRun) {
      fetchRunEvents(selectedRun);
    } else {
      setRunEvents([]);
    }
  }, [selectedRun]);

  const handleClear = async () => {
    if (!confirm("Clear all run history?")) return;
    await fetch("/api/agui/runs", { method: "DELETE" });
    setSelectedRun(null);
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

  const statusDot = (status: Run["status"]) => {
    const base = "inline-block w-[6px] h-[6px] rounded-full flex-shrink-0";
    switch (status) {
      case "running":
        return <span className={`${base} bg-[var(--accent)]`} />;
      case "finished":
        return <span className={`${base} bg-[var(--success)]`} />;
      case "error":
        return <span className={`${base} bg-[var(--error)]`} />;
    }
  };

  // Group events by tool call for display
  const toolCalls = runEvents.reduce((acc, evt) => {
    if (evt.type === "ToolCallStart" && evt.toolCallId) {
      acc[evt.toolCallId] = {
        id: evt.toolCallId,
        name: evt.toolName || "unknown",
        startedAt: evt.timestamp,
        status: "running" as const,
      };
    }
    if (evt.type === "ToolCallArgs" && evt.toolCallId && acc[evt.toolCallId]) {
      acc[evt.toolCallId].args = evt.args;
    }
    if (evt.type === "ToolCallResult" && evt.toolCallId && acc[evt.toolCallId]) {
      acc[evt.toolCallId].result = evt.result;
      acc[evt.toolCallId].success = evt.success;
      acc[evt.toolCallId].status = evt.success !== false ? "complete" : "error";
      acc[evt.toolCallId].endedAt = evt.timestamp;
    }
    return acc;
  }, {} as Record<string, {
    id: string;
    name: string;
    startedAt: string;
    endedAt?: string;
    status: "running" | "complete" | "error";
    args?: DeckPayload;
    result?: DeckPayload;
    success?: boolean;
  }>);

  const toolCallList = Object.values(toolCalls);

  // GLYPH view mode
  if (viewMode === "glyph") {
    return (
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        {/* Frosted Header */}
        <div className="sticky top-0 z-10 bg-[var(--bg-secondary)] flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight">Payload Inspector</span>
            {/* View mode toggle */}
            <div className="flex rounded-[6px] overflow-hidden border border-[var(--border)] bg-[var(--bg-tertiary)]">
              <button
                onClick={() => setViewMode("list")}
                className="px-3 py-1 text-xs font-medium transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                List
              </button>
              <button
                onClick={() => setViewMode("glyph")}
                className="px-3 py-1 text-xs font-medium transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] bg-[var(--accent)] text-white rounded-[6px]"
              >
                GLYPH
              </button>
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {allGlyphPayloads.length} payload{allGlyphPayloads.length !== 1 ? "s" : ""} found
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setEvalRunning(true);
                setEvalResults(null);
                try {
                  const res = await fetch('/api/tools/glyph-eval', { method: 'POST' });
                  const data = await res.json();
                  setEvalResults(data);
                } catch (err) {
                  console.error('Eval failed:', err);
                } finally {
                  setEvalRunning(false);
                }
              }}
              disabled={evalRunning}
              className="btn btn-secondary text-xs"
            >
              {evalRunning ? "Testing..." : "Test GLYPH Parsing"}
            </button>
            <button
              onClick={() => fetchAllGlyphPayloads()}
              className="btn btn-secondary text-xs"
            >
              Refresh
            </button>
          </div>
        </div>
        
        {/* Eval results banner */}
        {evalResults && (
          <div className={`px-4 py-2 border-b border-[var(--border)] ${
            evalResults.passed === evalResults.total 
              ? "bg-green-500/10" 
              : evalResults.passed > 0 
                ? "bg-yellow-500/10" 
                : "bg-red-500/10"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${
                  evalResults.passed === evalResults.total 
                    ? "text-green-400" 
                    : evalResults.passed > 0 
                      ? "text-yellow-400" 
                      : "text-red-400"
                }`}>
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
                {evalResults.results.filter(r => !r.passed).map((r, i) => (
                  <div key={i} className="text-xs text-red-400">
                    <span className="opacity-75">Q: {r.question.slice(0, 50)}...</span>
                    <br />
                    <span>Got: "{r.answer.slice(0, 50)}" (expected: "{r.expected}")</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* GLYPH payloads grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {allGlyphPayloads.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4 opacity-40">@</div>
              <p className="text-base font-medium text-[var(--text-secondary)] mb-2">No tool payloads found</p>
              <p className="text-sm text-[var(--text-muted)] mb-6">
                Run a tool to see payloads here.
              </p>
              <button onClick={() => fetchAllGlyphPayloads()} className="btn btn-primary text-sm">
                Refresh Payloads
              </button>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
              {allGlyphPayloads.map((item, idx) => (
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

  return (
    <div className="h-full flex bg-[var(--bg-primary)]">
      {/* Runs list */}
      <div className={`flex flex-col ${selectedRun ? "w-1/2 border-r border-[var(--border)]" : "w-full"}`}>
        {/* Frosted Header */}
        <div className="sticky top-0 z-10 bg-[var(--bg-secondary)] flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight">Runs</span>
            {/* View mode toggle */}
            <div className="flex rounded-[6px] overflow-hidden border border-[var(--border)] bg-[var(--bg-tertiary)]">
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-1 text-xs font-medium transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] ${
                  viewMode === "list"
                    ? "bg-[var(--accent)] text-white rounded-[6px]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode("glyph")}
                className="px-3 py-1 text-xs font-medium transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                GLYPH
              </button>
            </div>
          </div>
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
                  onClick={() => setSelectedRun(run.id === selectedRun ? null : run.id)}
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

      {/* Run detail panel — slide-in */}
      {selectedRun && (
        <div className="w-1/2 flex flex-col animate-fade-in bg-[var(--bg-primary)]">
          {/* Detail frosted header */}
          <div className="sticky top-0 z-10 bg-[var(--bg-secondary)] flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <span className="text-sm font-semibold tracking-tight">Run Details</span>
            <button
              onClick={() => setSelectedRun(null)}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all duration-[240ms]"
            >
              <X className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          </div>

          {/* Detail content */}
          <div className="flex-1 overflow-y-auto p-4">
            {loadingEvents ? (
              <div className="text-center text-[var(--text-muted)] py-8">Loading events...</div>
            ) : (
              <div className="space-y-5">
                {/* Run ID */}
                <div>
                  <h4 className="section-title mb-1">Run ID</h4>
                  <code className="text-xs text-[var(--text-secondary)]">{selectedRun}</code>
                </div>

                {/* Tool Calls */}
                {toolCallList.length > 0 && (
                  <div>
                    <h4 className="section-title mb-3">
                      Tool Calls ({toolCallList.length})
                    </h4>
                    <div className="space-y-3">
                      {toolCallList.map((tc, idx) => (
                        <div key={tc.id}>
                          <ToolCallDetail toolCall={tc} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw Events — timeline */}
                <details className="group">
                  <summary className="section-title cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                    Raw Events ({runEvents.length})
                  </summary>
                  <div className="mt-3 event-timeline space-y-3">
                    {runEvents.map((evt, i) => (
                      <div key={i} className="relative">
                        <div className={`event-timeline-dot ${
                          evt.type.includes("Error") ? "bg-[var(--error)]"
                          : evt.type.includes("Start") ? "bg-[var(--accent)]"
                          : evt.type.includes("Result") ? "bg-[var(--success)]"
                          : "bg-[var(--text-muted)]"
                        }`} />
                        <div className="text-xs font-mono p-3 rounded-[6px] bg-[rgba(255,255,255,0.02)] border border-[var(--border)]">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="badge badge-neutral text-[10px]">
                              {evt.type}
                            </span>
                            <span className="text-[var(--text-muted)]">
                              {new Date(evt.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          {evt.type === "ToolCallArgs" && evt.args && (
                            <PayloadViewer payload={evt.args} label="Args" maxPreviewLines={3} />
                          )}
                          {evt.type === "ToolCallResult" && evt.result && (
                            <PayloadViewer payload={evt.result} label="Result" maxPreviewLines={5} />
                          )}
                          {evt.type === "RunError" && evt.error && (
                            <div className="text-[var(--error)] mt-1">{evt.error.message}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Tool call detail component
function ToolCallDetail({ toolCall }: { 
  toolCall: {
    id: string;
    name: string;
    startedAt: string;
    endedAt?: string;
    status: "running" | "complete" | "error";
    args?: DeckPayload;
    result?: DeckPayload;
    success?: boolean;
  }
}) {
  const [expanded, setExpanded] = useState(true);

  const duration = toolCall.endedAt
    ? ((new Date(toolCall.endedAt).getTime() - new Date(toolCall.startedAt).getTime()) / 1000).toFixed(2)
    : null;

  return (
    <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 bg-[rgba(255,255,255,0.04)] cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <ChevronRight
            className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-150 ease-[cubic-bezier(0,0,0.2,1)] ${expanded ? "rotate-90" : ""}`}
          />
          <span className="text-sm font-medium text-[var(--text-primary)]">{toolCall.name}</span>

          {/* Status dot */}
          {toolCall.status === "running" && (
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--accent)]" />
          )}
          {toolCall.status === "complete" && (
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--success)]" />
          )}
          {toolCall.status === "error" && (
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--error)]" />
          )}
          
          {/* Payload type badge with savings */}
          {toolCall.result && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              toolCall.result.kind === "glyph" 
                ? "bg-purple-500/20 text-purple-400" 
                : "bg-blue-500/20 text-blue-400"
            }`}>
              {toolCall.result.kind.toUpperCase()}
              {toolCall.result.kind === "glyph" && toolCall.result.approxBytes && (() => {
                const glyph = (toolCall.result as { kind: "glyph"; glyph: string; approxBytes: number });
                return (
                  <span className="ml-1 opacity-75">
                    {Math.round((1 - glyph.glyph.length / glyph.approxBytes) * 100)}%
                  </span>
                );
              })()}
            </span>
          )}
        </div>
        
        {duration && (
          <span className="text-xs text-[var(--text-muted)]">{duration}s</span>
        )}
      </div>

      {/* Content */}
      {expanded && (
        <div className="p-3 space-y-3">
          {toolCall.args && (
            <PayloadViewer payload={toolCall.args} label="Args" defaultExpanded={false} maxPreviewLines={3} />
          )}
          {toolCall.result && (
            <PayloadViewer payload={toolCall.result} label="Result" defaultExpanded={true} maxPreviewLines={8} />
          )}
          {!toolCall.args && !toolCall.result && toolCall.status === "running" && (
            <div className="text-sm text-[var(--text-muted)]">Executing...</div>
          )}
        </div>
      )}
    </div>
  );
}

function getEventBadgeColor(type: string): string {
  switch (type) {
    case "RunStarted":
      return "bg-blue-500/20 text-blue-400";
    case "RunFinished":
      return "bg-green-500/20 text-green-400";
    case "RunError":
      return "bg-red-500/20 text-red-400";
    case "ToolCallStart":
      return "bg-yellow-500/20 text-yellow-400";
    case "ToolCallArgs":
      return "bg-orange-500/20 text-orange-400";
    case "ToolCallResult":
      return "bg-purple-500/20 text-purple-400";
    default:
      return "bg-zinc-500/20 text-zinc-400";
  }
}

// Payload card component for showcase view (handles both JSON and GLYPH)
function GlyphCard({ item }: { 
  item: { 
    runId: string; 
    toolName: string; 
    payload: DeckPayload; 
    type: "args" | "result"; 
    timestamp: string;
  }
}) {
  const [showDecoded, setShowDecoded] = useState(false);

  const isGlyph = item.payload.kind === "glyph";
  const content = isGlyph 
    ? (item.payload as { kind: "glyph"; glyph: string }).glyph 
    : JSON.stringify(
        item.payload.kind === "json" ? (item.payload as { kind: "json"; data: unknown }).data : item.payload,
        null,
        2
      );
  const approxBytes = item.payload.approxBytes ?? content.length;
  const savings = isGlyph && approxBytes > 0 
    ? ((1 - content.length / approxBytes) * 100).toFixed(1)
    : "0";

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-[rgba(255,255,255,0.04)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">{item.toolName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            item.type === "args" 
              ? "bg-orange-500/20 text-orange-400" 
              : "bg-green-500/20 text-green-400"
          }`}>
            {item.type === "args" ? "Input" : "Output"}
          </span>
          {/* Payload type badge */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            isGlyph 
              ? "bg-purple-500/30 text-purple-300" 
              : "bg-blue-500/30 text-blue-300"
          }`}>
            {item.payload.kind.toUpperCase()}
          </span>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{formatTime(item.timestamp)}</span>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-[var(--border)] bg-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--text-muted)]">Size:</span>
          <span className={`text-xs font-mono ${isGlyph ? "text-purple-400" : "text-blue-400"}`}>
            {content.length} {isGlyph ? "chars" : "bytes"}
          </span>
        </div>
        {isGlyph && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs text-[var(--text-muted)]">Original:</span>
              <span className="text-xs font-mono text-[var(--text-secondary)]">~{approxBytes} bytes</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-[var(--text-muted)]">Savings:</span>
              <span className={`text-xs font-mono ${
                parseFloat(savings) > 0 ? "text-green-400" : "text-[var(--text-secondary)]"
              }`}>
                {savings}%
              </span>
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Tab buttons (only for GLYPH) */}
        {isGlyph && (
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setShowDecoded(false)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                !showDecoded
                  ? "bg-purple-500/30 text-purple-300"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              GLYPH
            </button>
            <button
              onClick={() => setShowDecoded(true)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                showDecoded
                  ? "bg-blue-500/30 text-blue-300"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Decoded
            </button>
            <button
              onClick={() => copyToClipboard(content)}
              className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-auto"
            >
              Copy
            </button>
          </div>
        )}
        
        {/* JSON payloads just get a copy button */}
        {!isGlyph && (
          <div className="flex justify-end mb-2">
            <button
              onClick={() => copyToClipboard(content)}
              className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Copy
            </button>
          </div>
        )}

        {/* Code block — Xcode-style */}
        <pre className="xcode-preview whitespace-pre-wrap break-words overflow-x-auto max-h-[200px] overflow-y-auto p-3">
          {content.length > 500
            ? content.slice(0, 500) + "\n..."
            : content
          }
        </pre>
      </div>

      {/* Run ID */}
      <div className="px-3 py-2 border-t border-[var(--border)] bg-[rgba(255,255,255,0.04)]">
        <code className="text-[10px] text-[var(--text-muted)]">Run: {item.runId.slice(0, 8)}...</code>
      </div>
    </div>
  );
}
