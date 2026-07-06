"use client";

/**
 * LabTimeline — per-turn waterfall of probe marks + server timing frames.
 *
 * Reads `runs` from the store + the live `probe` ref, renders one row per
 * known span with a bar whose width is its duration relative to the longest
 * span on screen. Sub-100 ms spans are still shown but pinned to a minimum
 * pixel width so they don't collapse into invisibility.
 */

import { useMemo } from "react";

import { useLabStore } from "@/lib/voice-lab/store";
import type { ProbeReport } from "@/lib/voice/test-harness/latency-probe";

export function LabTimeline() {
  const { runs } = useLabStore();
  const recent = runs.slice(0, 5);

  if (recent.length === 0) {
    return <p className="text-xs text-muted-foreground">No turns recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {recent.map((run) => (
        <TimelineRow key={run.id} title={`${run.source} · ${new Date(run.startedAt).toLocaleTimeString()}`} report={run.report} />
      ))}
    </div>
  );
}

function TimelineRow({ title, report }: { title: string; report: ProbeReport }) {
  const entries = useMemo(() => Object.entries(report.spans), [report]);
  const max = useMemo(
    () => entries.reduce((m, [, v]) => (Number.isFinite(v) && v > m ? v : m), 1),
    [entries],
  );

  return (
    <div className="rounded border p-2 text-xs">
      <div className="mb-1 font-mono text-[11px] text-muted-foreground">{title}</div>
      <div className="space-y-0.5">
        {entries.map(([key, ms]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-44 truncate text-muted-foreground">{key}</span>
            <div className="relative h-3 flex-1 rounded bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded bg-primary"
                style={{ width: `${Math.max(2, (ms / max) * 100)}%` }}
              />
            </div>
            <span className="w-14 text-right tabular-nums">{ms.toFixed(0)} ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}
