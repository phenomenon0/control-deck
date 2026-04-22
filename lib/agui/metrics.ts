/**
 * SQL-backed aggregation helpers for the Runs telemetry dashboard.
 *
 * Each function returns shaped series data the UI can render directly — no
 * client-side reshaping. Windows are measured back from "now".
 */

import { getDb } from "./db";

export type Window = "24h" | "7d" | "30d" | "all";

function windowCutoff(window: Window): string {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (window) {
    case "24h":
      return new Date(now - day).toISOString();
    case "7d":
      return new Date(now - 7 * day).toISOString();
    case "30d":
      return new Date(now - 30 * day).toISOString();
    case "all":
      return "1970-01-01";
  }
}

export interface CostPoint {
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  runs: number;
}

/**
 * Cost + tokens over time. Bucket size: 1h for 24h window, 1d otherwise.
 */
export function costOverTime(window: Window): CostPoint[] {
  const db = getDb();
  const cutoff = windowCutoff(window);
  const fmt = window === "24h" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";
  return db
    .prepare(
      `SELECT strftime('${fmt}', started_at) as bucket,
              COALESCE(SUM(input_tokens), 0) as inputTokens,
              COALESCE(SUM(output_tokens), 0) as outputTokens,
              COALESCE(SUM(cost_usd), 0) as costUsd,
              COUNT(*) as runs
         FROM runs
         WHERE started_at >= ?
         GROUP BY bucket
         ORDER BY bucket ASC`,
    )
    .all(cutoff) as CostPoint[];
}

export interface LatencyStats {
  targetId: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

/**
 * Latency distribution per tool. SQLite lacks percentile_cont, so we pull
 * durations per tool and compute percentiles in JS — acceptable at our
 * cardinality (tens of tools × thousands of invocations).
 */
export function latencyByTool(window: Window): LatencyStats[] {
  const db = getDb();
  const cutoff = windowCutoff(window);
  const rows = db
    .prepare(
      `SELECT target_id as targetId, duration_ms as durationMs
         FROM invocations
         WHERE target_type = 'tool' AND duration_ms IS NOT NULL AND started_at >= ?
         ORDER BY target_id ASC, duration_ms ASC`,
    )
    .all(cutoff) as Array<{ targetId: string; durationMs: number }>;

  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const list = groups.get(r.targetId) ?? [];
    list.push(r.durationMs);
    groups.set(r.targetId, list);
  }
  const out: LatencyStats[] = [];
  for (const [targetId, arr] of groups) {
    out.push({
      targetId,
      count: arr.length,
      p50: quantile(arr, 0.5),
      p95: quantile(arr, 0.95),
      p99: quantile(arr, 0.99),
      avg: arr.reduce((s, v) => s + v, 0) / arr.length,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export interface ToolUsage {
  targetId: string;
  count: number;
  errors: number;
  errorRate: number;
}

export function toolUsage(window: Window): ToolUsage[] {
  const db = getDb();
  const cutoff = windowCutoff(window);
  const rows = db
    .prepare(
      `SELECT target_id as targetId,
              COUNT(*) as count,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
         FROM invocations
         WHERE target_type = 'tool' AND started_at >= ?
         GROUP BY target_id
         ORDER BY count DESC`,
    )
    .all(cutoff) as Array<{ targetId: string; count: number; errors: number }>;
  return rows.map((r) => ({
    ...r,
    errorRate: r.count > 0 ? r.errors / r.count : 0,
  }));
}

export interface ErrorBucket {
  bucket: string;
  total: number;
  errors: number;
  errorRate: number;
}

export function errorRateOverTime(window: Window): ErrorBucket[] {
  const db = getDb();
  const cutoff = windowCutoff(window);
  const fmt = window === "24h" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";
  return (
    db
      .prepare(
        `SELECT strftime('${fmt}', started_at) as bucket,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
           FROM runs
           WHERE started_at >= ?
           GROUP BY bucket
           ORDER BY bucket ASC`,
      )
      .all(cutoff) as Array<{ bucket: string; total: number; errors: number }>
  ).map((r) => ({
    ...r,
    errorRate: r.total > 0 ? r.errors / r.total : 0,
  }));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[idx];
}
