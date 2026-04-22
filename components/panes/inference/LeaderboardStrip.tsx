"use client";

/**
 * LeaderboardStrip — horizontal row of top-3 benchmark cards for a modality.
 * Data from `/api/inference/benchmarks?modality=X` which merges the curated
 * lib/inference/benchmarks.ts seed with live OpenRouter pricing.
 */

import { useEffect, useState } from "react";

import { useSourcePreview } from "./SourcePreviewContext";

type ModalityId =
  | "text"
  | "vision"
  | "image-gen"
  | "audio-gen"
  | "tts"
  | "stt"
  | "embedding"
  | "rerank"
  | "3d-gen"
  | "video-gen";

interface BenchmarkMetrics {
  qualityElo?: number;
  qualityMos?: number;
  qualityWer?: number;
  qualityMmlu?: number;
  timeToFirstMs?: number;
  tokensPerSecond?: number;
  latencyP95Ms?: number;
  costPer1MInput?: number;
  costPer1MOutput?: number;
  costPer1MChars?: number;
  costPerImage?: number;
  costPerAudioHour?: number;
  costPerVideoSecond?: number;
  contextWindow?: number;
}

interface BenchmarkEntry {
  providerId: string;
  model: string;
  modality: ModalityId;
  metrics: BenchmarkMetrics;
  source: string;
  sourceUrl?: string;
  asOf: string;
  note?: string;
}

const HEADLINE_METRIC: Record<
  ModalityId,
  {
    key: keyof BenchmarkMetrics;
    label: string;
    format: (v: number) => string;
    sortDir: "desc" | "asc";
  }
> = {
  text: { key: "qualityElo", label: "ELO", format: (v) => v.toFixed(0), sortDir: "desc" },
  vision: { key: "qualityElo", label: "ELO", format: (v) => v.toFixed(0), sortDir: "desc" },
  tts: { key: "qualityMos", label: "MOS", format: (v) => v.toFixed(2), sortDir: "desc" },
  stt: { key: "qualityWer", label: "WER", format: (v) => `${(v * 100).toFixed(1)}%`, sortDir: "asc" },
  "image-gen": { key: "qualityElo", label: "ELO", format: (v) => v.toFixed(0), sortDir: "desc" },
  "audio-gen": { key: "qualityMos", label: "MOS", format: (v) => v.toFixed(2), sortDir: "desc" },
  embedding: { key: "costPer1MInput", label: "$/1M", format: (v) => `$${v.toFixed(2)}`, sortDir: "asc" },
  rerank: { key: "latencyP95Ms", label: "p95", format: (v) => `${v}ms`, sortDir: "asc" },
  "3d-gen": { key: "latencyP95Ms", label: "p95", format: (v) => `${(v / 1000).toFixed(0)}s`, sortDir: "asc" },
  "video-gen": { key: "latencyP95Ms", label: "p95", format: (v) => `${(v / 1000).toFixed(0)}s`, sortDir: "asc" },
};

export function LeaderboardStrip({ modality }: { modality: ModalityId }) {
  const [entries, setEntries] = useState<BenchmarkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState<string>("—");
  const { open: openPreview } = useSourcePreview();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/inference/benchmarks?modality=${modality}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { entries?: BenchmarkEntry[]; asOf?: string };
        if (!alive) return;
        setEntries(data.entries ?? []);
        setAsOf(data.asOf ?? "—");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [modality]);

  if (loading && entries.length === 0) {
    return <div className="inference-leaderboard-empty">Loading leaderboard…</div>;
  }
  if (entries.length === 0) {
    return null;
  }

  const metricDef = HEADLINE_METRIC[modality];
  const ranked = [...entries]
    .filter((e) => e.metrics[metricDef.key] !== undefined)
    .sort((a, b) => {
      const av = a.metrics[metricDef.key] ?? 0;
      const bv = b.metrics[metricDef.key] ?? 0;
      return metricDef.sortDir === "desc" ? bv - av : av - bv;
    })
    .slice(0, 3);

  return (
    <section className="inference-leaderboard">
      <div className="inference-leaderboard-head">
        <div className="label">Leaderboard · {metricDef.label}</div>
        <div className="inference-leaderboard-meta">
          {ranked.length} top entries · as of {asOf}
        </div>
      </div>
      <div className="inference-leaderboard-row">
        {ranked.map((entry, i) => {
          const val = entry.metrics[metricDef.key];
          return (
            <article key={`${entry.providerId}/${entry.model}`} className="inference-leader-card">
              <div className="inference-leader-rank">#{i + 1}</div>
              <div className="inference-leader-headline">
                <span className="inference-leader-metric">
                  {val !== undefined ? metricDef.format(val) : "—"}
                </span>
                <span className="inference-leader-metric-label">{metricDef.label}</span>
              </div>
              <div className="inference-leader-model">{entry.model}</div>
              <div className="inference-leader-provider">
                via {entry.providerId}
              </div>
              {entry.note && <p className="inference-leader-note">{entry.note}</p>}
              <footer className="inference-leader-source">
                {entry.sourceUrl ? (
                  <button
                    type="button"
                    className="inference-leader-source-link"
                    onClick={() => openPreview({ url: entry.sourceUrl!, label: entry.source })}
                  >
                    {entry.source} ⤵
                  </button>
                ) : (
                  <span className="inference-leader-source-text">{entry.source}</span>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
