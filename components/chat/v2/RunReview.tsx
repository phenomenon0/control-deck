"use client";

/**
 * RunReview (v2) — a reviewable summary of what the agent did this run: the tools
 * it called (with status), artifacts it produced, duration, and token/cost. Built
 * from the same ActivityStep[] / Artifact[] the timeline already has. Collapsible.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleX, FileBox } from "lucide-react";
import type { ActivityStep } from "@/lib/types/agentRun";
import type { Artifact } from "@/lib/types/chat";

export interface RunReviewProps {
  steps: ActivityStep[];
  artifacts?: Artifact[];
  durationMs?: number;
  cost?: { tokens?: number; usd?: number };
  defaultExpanded?: boolean;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function RunReview({ steps, artifacts = [], durationMs, cost, defaultExpanded = true }: RunReviewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const ok = steps.filter((s) => s.status === "complete").length;
  const err = steps.filter((s) => s.status === "error").length;

  return (
    <div className="cd-runreview rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[var(--text-secondary)]" style={MONO}>
        <span style={{ fontWeight: "var(--fw-strong, 600)", letterSpacing: "var(--tracking-label, 0.06em)" }}>RUN REVIEW</span>
        <span className="text-[var(--text-muted)]">
          {steps.length} tool{steps.length === 1 ? "" : "s"}
          {err > 0 ? ` · ${err} failed` : ""}
          {artifacts.length > 0 ? ` · ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}` : ""}
          {typeof durationMs === "number" ? ` · ${(durationMs / 1000).toFixed(1)}s` : ""}
          {cost?.tokens ? ` · ${cost.tokens} tok` : ""}
          {typeof cost?.usd === "number" ? ` · $${cost.usd.toFixed(4)}` : ""}
        </span>
        <span className="ml-auto">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </button>
      {expanded && (
        <div className="border-t px-2.5 py-1.5" style={{ borderColor: "var(--border-subtle)" }}>
          <ul className="flex flex-col gap-0.5">
            {steps.map((s) => (
              <li key={s.toolCallId} className="flex items-center gap-2" style={MONO}>
                <span style={{ color: s.status === "complete" ? "var(--ok, #34d399)" : s.status === "error" ? "var(--err, #f87171)" : "var(--warn, #fbbf24)" }}>
                  {s.status === "complete" ? <CircleCheck size={12} /> : s.status === "error" ? <CircleX size={12} /> : "·"}
                </span>
                <span className="text-[var(--text-primary)]">{s.toolName}</span>
                {s.result?.error && <span className="min-w-0 truncate" style={{ color: "var(--err, #f87171)" }}>{s.result.error}</span>}
                {typeof s.durationMs === "number" && <span className="ml-auto text-[var(--text-muted)]" style={{ opacity: 0.7 }}>{s.durationMs}ms</span>}
              </li>
            ))}
          </ul>
          {artifacts.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5 border-t pt-1.5" style={{ borderColor: "var(--border-subtle)" }}>
              {artifacts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[var(--text-secondary)]" style={MONO}>
                  <FileBox size={12} />
                  <span className="min-w-0 truncate">{a.name}</span>
                  <a href={a.url} download={a.name} className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)]">download</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default RunReview;
