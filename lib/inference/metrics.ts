/**
 * Lightweight in-memory observability for the inference layer.
 *
 * Design: no external dependency, no dashboard — just a ring-buffer of
 * recent invocations plus a few rolling counters that /api/inference/metrics
 * can return. For production-grade observability route through OTLP or a
 * proper histogram library later; this is enough to answer "which provider
 * did my last 100 requests hit" and "what's the p95 for image-gen".
 */

import type { Modality } from "./types";

export interface InvocationRecord {
  modality: Modality;
  providerId: string;
  startedAt: number;
  durationMs: number;
  success: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

const BUFFER_CAP = 500;
const recent: InvocationRecord[] = [];
const counters: Record<string, number> = {};

function incrementCounter(key: string): void {
  counters[key] = (counters[key] ?? 0) + 1;
}

export function recordInvocation(rec: InvocationRecord): void {
  recent.push(rec);
  if (recent.length > BUFFER_CAP) {
    recent.splice(0, recent.length - BUFFER_CAP);
  }
  const keyBase = `${rec.modality}::${rec.providerId}`;
  incrementCounter(`${keyBase}::${rec.success ? "ok" : "error"}`);
  incrementCounter(`${rec.modality}::${rec.success ? "ok" : "error"}`);
}

/**
 * Opt-in instrumentation wrapper — callers surround their invoke() with
 * `await withMetrics(modality, providerId, () => invokeX(...))`.
 * Non-invasive: modality adapters don't need to know about it.
 */
export async function withMetrics<T>(
  modality: Modality,
  providerId: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    recordInvocation({
      modality,
      providerId,
      startedAt: started,
      durationMs: Date.now() - started,
      success: true,
      meta,
    });
    return result;
  } catch (err) {
    recordInvocation({
      modality,
      providerId,
      startedAt: started,
      durationMs: Date.now() - started,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      meta,
    });
    throw err;
  }
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  recent: InvocationRecord[];
  summary: Array<{
    modality: Modality;
    providerId: string;
    count: number;
    errorCount: number;
    errorRate: number;
    p50ms: number;
    p95ms: number;
    lastAt: number;
  }>;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const bucketed = new Map<string, InvocationRecord[]>();
  for (const rec of recent) {
    const key = `${rec.modality}::${rec.providerId}`;
    const bucket = bucketed.get(key) ?? [];
    bucket.push(rec);
    bucketed.set(key, bucket);
  }
  const summary: MetricsSnapshot["summary"] = [];
  for (const [key, bucket] of bucketed) {
    const [modality, providerId] = key.split("::") as [Modality, string];
    const durations = [...bucket].map((r) => r.durationMs).sort((a, b) => a - b);
    const errorCount = bucket.filter((r) => !r.success).length;
    summary.push({
      modality,
      providerId,
      count: bucket.length,
      errorCount,
      errorRate: bucket.length > 0 ? errorCount / bucket.length : 0,
      p50ms: percentile(durations, 0.5),
      p95ms: percentile(durations, 0.95),
      lastAt: bucket[bucket.length - 1]!.startedAt,
    });
  }
  summary.sort((a, b) => b.count - a.count);
  return {
    counters: { ...counters },
    recent: [...recent],
    summary,
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx] ?? 0;
}

/** Test-only. */
export function __resetMetrics(): void {
  recent.length = 0;
  for (const k of Object.keys(counters)) delete counters[k];
}
