"use client";

/**
 * LabReport — aggregate p50/p95 per span across all runs in the store.
 */

import { useMemo } from "react";

import { useLabStore } from "@/lib/voice-lab/store";
import { aggregateReports } from "@/lib/voice/test-harness/latency-probe";

export function LabReport() {
  const { runs } = useLabStore();

  const aggregate = useMemo(
    () => aggregateReports(runs.map((r) => r.report)),
    [runs],
  );

  const entries = Object.entries(aggregate.byKey).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No runs to aggregate.</p>;
  }

  return (
    <div className="overflow-auto text-xs">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-2">span</th>
            <th className="py-1 pr-2 text-right">n</th>
            <th className="py-1 pr-2 text-right">p50</th>
            <th className="py-1 pr-2 text-right">p95</th>
            <th className="py-1 pr-2 text-right">mean</th>
            <th className="py-1 pr-2 text-right">min</th>
            <th className="py-1 pr-2 text-right">max</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, stats]) => (
            <tr key={key} className="border-b last:border-0">
              <td className="py-0.5 pr-2 font-mono">{key}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">{stats.count}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">{stats.p50.toFixed(0)}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">{stats.p95.toFixed(0)}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">{stats.mean.toFixed(0)}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">{stats.min.toFixed(0)}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">{stats.max.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
