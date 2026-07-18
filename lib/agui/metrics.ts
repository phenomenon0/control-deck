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

/* ── Engine latency (Phase 4) ──────────────────────────────────────────────
   Per-run latency gates extracted from the events ledger, aggregated over the
   last N runs — a count window, unlike the time windows above.

     TTFT            first TextMessageContent.timestamp − RunStarted.timestamp
     tool round-trip ToolCallResult.durationMs, else the ToolCallStart →
                     ToolCallResult timestamp delta matched on toolCallId
     resolveMs       LLMResolved.resolveMs (provider/modelId ride along for the
                     per-provider breakdown)

   The SQL stays bounded: the window is `LIMIT n` newest runs, and only the
   low-cardinality rows (tool + resolve events) are pulled in full — the
   high-volume TextMessageContent stream collapses to one MIN(timestamp) per
   run in SQL instead of transferring every delta.
*/

export interface Distribution {
  count: number;
  p50: number;
  p95: number;
  avg: number;
}

/** Percentiles over an unsorted value list. Empty input → zeroed stats. */
export function distributionOf(values: number[]): Distribution {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, avg: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    p50: Math.round(quantile(sorted, 0.5)),
    p95: Math.round(quantile(sorted, 0.95)),
    avg: Math.round((sum / sorted.length) * 10) / 10,
  };
}

/** Timestamp anchors for one run, collapsed in SQL from the hot event types. */
export interface RunAnchors {
  runId: string;
  /** first RunStarted.timestamp */
  startedAt: string | null;
  /** first TextMessageContent.timestamp */
  firstContentAt: string | null;
}

/** One low-volume event row (ToolCallStart / ToolCallResult / LLMResolved). */
export interface TimingEventRow {
  type: string;
  timestamp: string;
  /** Parsed events.data JSON — the full stored event. */
  data?: unknown;
}

export interface RunLatency {
  runId: string;
  ttftMs: number | null;
  toolRoundTripsMs: number[];
  resolveMs: number | null;
  provider: string | null;
  modelId: string | null;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pure per-run extraction. `events` must be in ledger order (event id ASC).
 * Clock-skew guard: negative deltas are dropped, never clamped.
 */
export function extractRunLatency(
  anchors: RunAnchors,
  events: TimingEventRow[],
): RunLatency {
  const out: RunLatency = {
    runId: anchors.runId,
    ttftMs: null,
    toolRoundTripsMs: [],
    resolveMs: null,
    provider: null,
    modelId: null,
  };
  const t0 = parseMs(anchors.startedAt);
  const t1 = parseMs(anchors.firstContentAt);
  if (t0 !== null && t1 !== null && t1 >= t0) out.ttftMs = Math.round(t1 - t0);

  const toolStarts = new Map<string, number>();
  for (const e of events) {
    const ts = parseMs(e.timestamp);
    if (e.type === "ToolCallStart") {
      const d = e.data as { toolCallId?: unknown } | undefined;
      if (ts !== null && typeof d?.toolCallId === "string") {
        toolStarts.set(d.toolCallId, ts);
      }
    } else if (e.type === "ToolCallResult") {
      const d = e.data as
        | { toolCallId?: unknown; durationMs?: unknown }
        | undefined;
      let dur: number | null = null;
      if (typeof d?.durationMs === "number" && d.durationMs >= 0) {
        dur = d.durationMs;
      } else if (ts !== null && typeof d?.toolCallId === "string") {
        const start = toolStarts.get(d.toolCallId);
        if (start !== undefined && ts >= start) dur = ts - start;
      }
      if (dur !== null) out.toolRoundTripsMs.push(Math.round(dur));
      if (typeof d?.toolCallId === "string") toolStarts.delete(d.toolCallId);
    } else if (e.type === "LLMResolved") {
      const d = e.data as
        | { resolveMs?: unknown; provider?: unknown; modelId?: unknown }
        | undefined;
      if (
        out.resolveMs === null &&
        typeof d?.resolveMs === "number" &&
        d.resolveMs >= 0
      ) {
        out.resolveMs = Math.round(d.resolveMs);
      }
      if (out.provider === null && typeof d?.provider === "string") {
        out.provider = d.provider;
      }
      if (out.modelId === null && typeof d?.modelId === "string") {
        out.modelId = d.modelId;
      }
    }
  }
  return out;
}

export interface ProviderLatency {
  provider: string;
  runs: number;
  ttft: Distribution;
  toolRoundTrip: Distribution;
  resolve: Distribution;
}

export interface EngineLatency {
  limit: number;
  /** Runs in the window (timed or not). */
  runsSampled: number;
  /** Runs with at least one latency signal. */
  runsTimed: number;
  ttft: Distribution;
  toolRoundTrip: Distribution;
  resolve: Distribution;
  providers: ProviderLatency[];
}

/** Windowed p50/p95 aggregates over per-run samples. Pure. */
export function aggregateEngineLatency(
  runs: RunLatency[],
  limit: number,
  runsSampled: number,
): EngineLatency {
  const ttfts: number[] = [];
  const roundTrips: number[] = [];
  const resolves: number[] = [];
  let runsTimed = 0;
  const byProvider = new Map<
    string,
    { runs: number; ttft: number[]; roundTrip: number[]; resolve: number[] }
  >();

  for (const r of runs) {
    if (r.ttftMs !== null) ttfts.push(r.ttftMs);
    roundTrips.push(...r.toolRoundTripsMs);
    if (r.resolveMs !== null) resolves.push(r.resolveMs);
    if (
      r.ttftMs !== null ||
      r.resolveMs !== null ||
      r.toolRoundTripsMs.length > 0
    ) {
      runsTimed++;
    }
    if (r.provider !== null) {
      const g = byProvider.get(r.provider) ?? {
        runs: 0,
        ttft: [],
        roundTrip: [],
        resolve: [],
      };
      g.runs++;
      if (r.ttftMs !== null) g.ttft.push(r.ttftMs);
      g.roundTrip.push(...r.toolRoundTripsMs);
      if (r.resolveMs !== null) g.resolve.push(r.resolveMs);
      byProvider.set(r.provider, g);
    }
  }

  const providers: ProviderLatency[] = [...byProvider.entries()]
    .map(([provider, g]) => ({
      provider,
      runs: g.runs,
      ttft: distributionOf(g.ttft),
      toolRoundTrip: distributionOf(g.roundTrip),
      resolve: distributionOf(g.resolve),
    }))
    .sort((a, b) => b.runs - a.runs);

  return {
    limit,
    runsSampled,
    runsTimed,
    ttft: distributionOf(ttfts),
    toolRoundTrip: distributionOf(roundTrips),
    resolve: distributionOf(resolves),
    providers,
  };
}

/**
 * Minimal prepare-only db handle. better-sqlite3 satisfies this at runtime;
 * tests pass a bun:sqlite handle (better-sqlite3 cannot load under bun, and
 * DECK_DB_PATH is unreliable in tests because lib/agui/db/connection resolves
 * its path at first module evaluation — whichever test file loads first wins).
 */
export interface MetricsDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

export const ENGINE_LATENCY_DEFAULT_LIMIT = 200;
const ENGINE_LATENCY_MAX_LIMIT = 1000;

const RUN_WINDOW_SQL = `SELECT id FROM runs ORDER BY started_at DESC LIMIT ?`;

/**
 * Engine latency over the last `limit` runs. Three bounded queries: the run
 * window, one MIN()-collapsed anchor row per run for the hot event types, and
 * the full low-volume tool/resolve rows. Extraction + aggregation are the pure
 * functions above.
 */
export function engineLatencyWithDb(
  db: MetricsDb,
  limit: number = ENGINE_LATENCY_DEFAULT_LIMIT,
): EngineLatency {
  const n = Math.min(
    Math.max(Math.floor(limit) || ENGINE_LATENCY_DEFAULT_LIMIT, 1),
    ENGINE_LATENCY_MAX_LIMIT,
  );

  const runIds = (db.prepare(RUN_WINDOW_SQL).all(n) as Array<{ id: string }>).map(
    (r) => r.id,
  );
  if (runIds.length === 0) return aggregateEngineLatency([], n, 0);

  const anchors = db
    .prepare(
      `SELECT run_id AS runId,
              MIN(CASE WHEN type = 'RunStarted' THEN timestamp END) AS startedAt,
              MIN(CASE WHEN type = 'TextMessageContent' THEN timestamp END) AS firstContentAt
         FROM events
        WHERE run_id IN (${RUN_WINDOW_SQL})
          AND type IN ('RunStarted', 'TextMessageContent')
        GROUP BY run_id`,
    )
    .all(n) as RunAnchors[];

  const rows = db
    .prepare(
      `SELECT run_id AS runId, type, timestamp, data
         FROM events
        WHERE run_id IN (${RUN_WINDOW_SQL})
          AND type IN ('ToolCallStart', 'ToolCallResult', 'LLMResolved')
        ORDER BY run_id ASC, id ASC`,
    )
    .all(n) as Array<{ runId: string; type: string; timestamp: string; data: string }>;

  const eventsByRun = new Map<string, TimingEventRow[]>();
  for (const r of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.data);
    } catch {
      parsed = undefined; // unparseable row — treated as a bare timestamp
    }
    const list = eventsByRun.get(r.runId) ?? [];
    list.push({ type: r.type, timestamp: r.timestamp, data: parsed });
    eventsByRun.set(r.runId, list);
  }

  const anchorByRun = new Map(anchors.map((a) => [a.runId, a]));
  const runs: RunLatency[] = [];
  for (const runId of runIds) {
    const a = anchorByRun.get(runId);
    runs.push(
      extractRunLatency(
        {
          runId,
          startedAt: a?.startedAt ?? null,
          firstContentAt: a?.firstContentAt ?? null,
        },
        eventsByRun.get(runId) ?? [],
      ),
    );
  }
  return aggregateEngineLatency(runs, n, runIds.length);
}

/** Deck-DB entry point — the route handler calls this one. */
export function engineLatency(limit?: number): EngineLatency {
  return engineLatencyWithDb(getDb(), limit);
}
