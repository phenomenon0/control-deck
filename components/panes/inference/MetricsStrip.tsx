"use client";

/**
 * MetricsStrip — live "what just happened" indicator for this modality.
 * Pulls /api/inference/metrics and filters the summary buckets + recent
 * ring-buffer entries to the current modality.
 */

import { useEffect, useState } from "react";

interface MetricsSummary {
  modality: string;
  providerId: string;
  count: number;
  errorCount: number;
  errorRate: number;
  p50ms: number;
  p95ms: number;
  lastAt: number;
}

interface InvocationRecord {
  modality: string;
  providerId: string;
  startedAt: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

interface MetricsResponse {
  counters: Record<string, number>;
  recent: InvocationRecord[];
  summary: MetricsSummary[];
}

export function MetricsStrip({
  modality,
  refreshToken,
}: {
  modality: string;
  refreshToken: number;
}) {
  const [snap, setSnap] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/inference/metrics", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as MetricsResponse;
        if (alive) setSnap(data);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    // auto-refresh every 5s — the strip is meant to feel live.
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/inference/metrics", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as MetricsResponse;
        if (alive) setSnap(data);
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [modality, refreshToken]);

  if (loading && !snap) {
    return (
      <section className="inference-metrics">
        <div className="label">Live</div>
        <div className="inference-metrics-empty">Loading metrics…</div>
      </section>
    );
  }
  if (!snap) return null;

  const summaries = snap.summary.filter((s) => s.modality === modality);
  const recent = snap.recent.filter((r) => r.modality === modality).slice(-5).reverse();

  return (
    <section className="inference-metrics">
      <div className="inference-metrics-head">
        <div className="label">Live</div>
        <div className="inference-metrics-summary-count">
          {summaries.length > 0
            ? `${summaries.reduce((n, s) => n + s.count, 0)} calls across ${summaries.length} provider${summaries.length === 1 ? "" : "s"}`
            : "no calls yet — this fills in as the deck runs"}
        </div>
      </div>
      {summaries.length > 0 && (
        <div className="inference-metrics-summary">
          {summaries.map((s) => (
            <div key={s.providerId} className="inference-metrics-bucket">
              <div className="inference-metrics-bucket-name">{s.providerId}</div>
              <div className="inference-metrics-bucket-stats">
                <span className="inference-mono">{s.count} calls</span>
                <span className="inference-mono">p50 {Math.round(s.p50ms)}ms</span>
                <span className="inference-mono">p95 {Math.round(s.p95ms)}ms</span>
                {s.errorCount > 0 && (
                  <span className="inference-mono inference-text-err">
                    {(s.errorRate * 100).toFixed(0)}% err
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <ul className="inference-metrics-recent">
          {recent.map((r, i) => (
            <li key={`${r.startedAt}-${i}`} className="inference-metrics-recent-row">
              <span className={`inference-dot inference-dot--${r.success ? "ok" : "err"}`} />
              <span className="inference-mono">{r.providerId}</span>
              <span className="inference-mono">{Math.round(r.durationMs)}ms</span>
              <span className="inference-metrics-recent-time">
                {new Date(r.startedAt).toLocaleTimeString()}
              </span>
              {r.error && (
                <span className="inference-metrics-recent-err" title={r.error}>
                  {r.error.slice(0, 50)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
