"use client";

/**
 * CloudSuggestionsStrip — peer of LocalSuggestionsStrip for the System-tab
 * "Cloud SOTA" pill. Sources from /api/inference/benchmarks (curated +
 * live OpenRouter merge) filtered to providers that aren't local backends.
 */

import { useEffect, useState } from "react";

import { openInThemedBrowser } from "@/lib/open-in-browser";

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

// Providers that are distinctly LOCAL — everything else we treat as cloud-
// served. Matches the ids used in lib/inference/*/register.ts.
const LOCAL_PROVIDERS = new Set([
  "ollama",
  "voice-api",
  "comfyui",
  "lite-onnx",
  "llama_server",
  "vllm",
  "lmstudio",
  "custom",
  "bge",
  "vectordb-internal",
]);

/** Headline metric selection per modality — same logic as LeaderboardStrip. */
const HEADLINE: Record<
  ModalityId,
  { key: keyof BenchmarkMetrics; label: string; format: (v: number) => string; sortDir: "asc" | "desc" }
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

export function CloudSuggestionsStrip({
  modality,
  limit = 3,
  title = "Cloud SOTA",
}: {
  modality: ModalityId;
  limit?: number;
  title?: string;
}) {
  const [entries, setEntries] = useState<BenchmarkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState("—");

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

  const def = HEADLINE[modality];
  const cloud = entries.filter((e) => !LOCAL_PROVIDERS.has(e.providerId));
  const ranked = [...cloud]
    .filter((e) => e.metrics[def.key] !== undefined)
    .sort((a, b) => {
      const av = a.metrics[def.key] ?? 0;
      const bv = b.metrics[def.key] ?? 0;
      return def.sortDir === "desc" ? bv - av : av - bv;
    })
    .slice(0, limit);

  if (loading && ranked.length === 0) {
    return <div className="local-strip-loading">Loading cloud SOTA…</div>;
  }
  if (ranked.length === 0) return null;

  return (
    <section className="local-strip">
      <div className="local-strip-head">
        <div className="label">{title}</div>
        <span className="inference-leaderboard-meta">{def.label} leader · as of {asOf}</span>
      </div>
      <div className="local-strip-cards">
        {ranked.map((e, i) => {
          const v = e.metrics[def.key];
          return (
            <article key={`${e.providerId}/${e.model}`} className="local-card cloud-card">
              <div className="local-card-head">
                <span className="local-card-name">{e.model}</span>
                <span className="local-fit local-fit--installed" title={`Ranked #${i + 1} by ${def.label}`}>
                  #{i + 1}
                </span>
              </div>
              <div className="local-card-meta">
                <span className="local-source-badge local-source-badge--live">CLOUD</span>
                <span className="inference-mono">{e.providerId}</span>
                {v !== undefined && (
                  <>
                    <span className="local-card-dot">·</span>
                    <span className="cloud-card-metric">
                      {def.format(v)} <span className="cloud-card-metric-label">{def.label}</span>
                    </span>
                  </>
                )}
              </div>
              <CloudMetricsRow metrics={e.metrics} modality={modality} />
              {e.note && <p className="local-card-reason">{e.note}</p>}
              <footer className="inference-leader-source">
                {e.sourceUrl ? (
                  <button
                    type="button"
                    className="inference-leader-source-link"
                    onClick={() => openInThemedBrowser(e.sourceUrl!)}
                  >
                    {e.source} ⤵
                  </button>
                ) : (
                  <span className="inference-leader-source-text">{e.source}</span>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CloudMetricsRow({
  metrics,
  modality,
}: {
  metrics: BenchmarkMetrics;
  modality: ModalityId;
}) {
  const items: Array<[string, string]> = [];
  if (metrics.costPer1MInput !== undefined)
    items.push(["in", `$${metrics.costPer1MInput.toFixed(2)}/1M`]);
  if (metrics.costPer1MOutput !== undefined)
    items.push(["out", `$${metrics.costPer1MOutput.toFixed(2)}/1M`]);
  if (metrics.costPer1MChars !== undefined)
    items.push(["char", `$${metrics.costPer1MChars.toFixed(0)}/1M`]);
  if (metrics.costPerImage !== undefined)
    items.push([modality === "3d-gen" ? "mesh" : "img", `$${metrics.costPerImage.toFixed(3)}`]);
  if (metrics.costPerAudioHour !== undefined)
    items.push(["hr", `$${metrics.costPerAudioHour.toFixed(2)}`]);
  if (metrics.costPerVideoSecond !== undefined)
    items.push(["sec", `$${metrics.costPerVideoSecond.toFixed(3)}`]);
  if (metrics.timeToFirstMs !== undefined)
    items.push(["ttft", `${metrics.timeToFirstMs}ms`]);
  if (metrics.contextWindow !== undefined)
    items.push(["ctx", `${(metrics.contextWindow / 1000).toFixed(0)}k`]);
  if (items.length === 0) return null;
  return (
    <div className="cloud-card-kv">
      {items.map(([k, v]) => (
        <div key={k} className="cloud-card-kv-cell">
          <span className="cloud-card-kv-label">{k}</span>
          <span className="cloud-card-kv-value inference-mono">{v}</span>
        </div>
      ))}
    </div>
  );
}
