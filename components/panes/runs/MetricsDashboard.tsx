"use client";

/**
 * Runs telemetry dashboard. Fetches four aggregations from
 * /api/agui/runs?aggregate=... and renders hand-rolled SVG charts.
 * Window chip controls scope (24h / 7d / 30d / all).
 */

import { useEffect, useState } from "react";
import {
  CostOverTimeChart,
  ErrorRateHeatmap,
  LatencyDistributionChart,
  ToolUsageChart,
  type CostPoint,
  type ErrorBucket,
  type LatencyStats,
  type ToolUsage,
} from "./charts";

type Window = "24h" | "7d" | "30d" | "all";

export function MetricsDashboard() {
  const [window, setWindow] = useState<Window>("7d");
  const [cost, setCost] = useState<CostPoint[]>([]);
  const [latency, setLatency] = useState<LatencyStats[]>([]);
  const [usage, setUsage] = useState<ToolUsage[]>([]);
  const [errors, setErrors] = useState<ErrorBucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const fetchAgg = async <T,>(kind: string): Promise<T[]> => {
        try {
          const r = await fetch(`/api/agui/runs?aggregate=${kind}&window=${window}`, {
            cache: "no-store",
          });
          if (!r.ok) return [];
          const d = (await r.json()) as { series?: T[] };
          return d.series ?? [];
        } catch {
          return [];
        }
      };
      const [c, l, u, e] = await Promise.all([
        fetchAgg<CostPoint>("cost"),
        fetchAgg<LatencyStats>("latency"),
        fetchAgg<ToolUsage>("tools"),
        fetchAgg<ErrorBucket>("errors"),
      ]);
      if (!alive) return;
      setCost(c);
      setLatency(l);
      setUsage(u);
      setErrors(e);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [window]);

  return (
    <div className="runs-metrics">
      <div className="runs-metrics-head">
        <div>
          <div className="label">Telemetry</div>
          <h2>Run metrics</h2>
          <p>Cost, latency, tool usage and error rate, aggregated from local history.</p>
        </div>
        <div className="runs-metrics-window">
          {(["24h", "7d", "30d", "all"] as const).map((w) => (
            <button
              key={w}
              type="button"
              className={`runs-metrics-window-btn${window === w ? " on" : ""}`}
              onClick={() => setWindow(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="runs-metrics-empty">Loading…</div>
      ) : (
        <div className="runs-metrics-grid">
          <CostOverTimeChart data={cost} />
          <ErrorRateHeatmap data={errors} />
          <LatencyDistributionChart data={latency} />
          <ToolUsageChart data={usage} />
        </div>
      )}
    </div>
  );
}
