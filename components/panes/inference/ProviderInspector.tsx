"use client";

/**
 * ProviderInspector — right-rail slide-in detail panel for a provider.
 *
 * Initial version (task 4 in the plan): metadata + curated benchmark entry
 * + filtered metrics. For the Ollama provider, nests the existing
 * `<ModelsPane>` for pull/delete. Mirrors the InspectorSheet scrim+panel
 * pattern but keeps its own state to avoid chat-context entanglement.
 */

import { useEffect, useState, type ReactNode } from "react";

import { ModelsPane } from "@/components/panes/ModelsPane";

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

interface ProviderEntry {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseURL?: string;
  defaultModels: string[];
}

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

export function ProviderInspector({
  modality,
  providerId,
  onClose,
}: {
  modality: ModalityId;
  providerId: string | null;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<ProviderEntry | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const open = providerId !== null;

  useEffect(() => {
    if (!providerId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [p, b, m] = await Promise.all([
          fetch(`/api/inference/providers?modality=${modality}`, { cache: "no-store" }),
          fetch(`/api/inference/benchmarks?modality=${modality}`, { cache: "no-store" }),
          fetch("/api/inference/metrics", { cache: "no-store" }),
        ]);
        if (!alive) return;
        if (p.ok) {
          const j = (await p.json()) as { providers?: ProviderEntry[] };
          setProvider(j.providers?.find((x) => x.id === providerId) ?? null);
        }
        if (b.ok) {
          const j = (await b.json()) as { entries?: BenchmarkEntry[] };
          setBenchmarks((j.entries ?? []).filter((e) => e.providerId === providerId));
        }
        if (m.ok) {
          const j = (await m.json()) as { summary?: MetricsSummary[] };
          setMetrics(
            (j.summary ?? []).find((s) => s.modality === modality && s.providerId === providerId) ??
              null,
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [providerId, modality]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="inference-inspector-scrim"
        onClick={onClose}
        aria-label="Close inspector"
      />
      <aside className="inference-inspector" role="dialog" aria-label="Provider detail">
        <header className="inference-inspector-head">
          <div>
            <div className="label">Provider</div>
            <h2>{provider?.name ?? providerId}</h2>
            <p>{provider?.description}</p>
          </div>
          <button
            type="button"
            className="inference-action-btn inference-action-btn--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        {loading && <div className="inference-empty">Loading…</div>}

        {provider && (
          <>
            <Section label="Defaults">
              <KV label="Base URL" value={provider.defaultBaseURL ?? "—"} mono />
              <KV
                label="Models"
                value={provider.defaultModels.join(", ") || "—"}
                mono
              />
              <KV
                label="Auth"
                value={provider.requiresApiKey ? "API key required" : "local / no key"}
              />
            </Section>

            {benchmarks.length > 0 && (
              <Section label="Benchmarks">
                {benchmarks.map((b) => (
                  <div key={`${b.model}/${b.source}`} className="inference-inspector-bench">
                    <div className="inference-inspector-bench-head">
                      <span className="inference-mono">{b.model}</span>
                      {b.sourceUrl ? (
                        <a
                          href={b.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inference-inspector-bench-source"
                        >
                          {b.source} ↗
                        </a>
                      ) : (
                        <span className="inference-inspector-bench-source">{b.source}</span>
                      )}
                    </div>
                    <BenchmarkMetricsView metrics={b.metrics} modality={modality} />
                    {b.note && <p className="inference-inspector-bench-note">{b.note}</p>}
                  </div>
                ))}
              </Section>
            )}

            <Section label="Live metrics">
              {metrics ? (
                <div className="inference-inspector-metrics">
                  <KV label="Calls (last 500)" value={String(metrics.count)} mono />
                  <KV label="p50" value={`${Math.round(metrics.p50ms)}ms`} mono />
                  <KV label="p95" value={`${Math.round(metrics.p95ms)}ms`} mono />
                  <KV
                    label="Errors"
                    value={`${metrics.errorCount} (${(metrics.errorRate * 100).toFixed(0)}%)`}
                    mono
                  />
                </div>
              ) : (
                <p className="inference-text-muted">No calls recorded yet.</p>
              )}
            </Section>

            {providerId === "ollama" && (
              <Section label="Installed models (Ollama)">
                <div className="inference-inspector-models-wrap">
                  <ModelsPane />
                </div>
              </Section>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="inference-inspector-section">
      <div className="label">{label}</div>
      {children}
    </section>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="inference-inspector-kv">
      <span className="inference-inspector-kv-label">{label}</span>
      <span className={`inference-inspector-kv-value${mono ? " inference-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function BenchmarkMetricsView({
  metrics,
  modality,
}: {
  metrics: BenchmarkMetrics;
  modality: ModalityId;
}) {
  const kv: Array<[string, string]> = [];
  if (metrics.qualityElo !== undefined) kv.push(["ELO", metrics.qualityElo.toFixed(0)]);
  if (metrics.qualityMos !== undefined) kv.push(["MOS", metrics.qualityMos.toFixed(2)]);
  if (metrics.qualityWer !== undefined)
    kv.push(["WER", `${(metrics.qualityWer * 100).toFixed(1)}%`]);
  if (metrics.qualityMmlu !== undefined)
    kv.push(["MMLU", `${(metrics.qualityMmlu * 100).toFixed(1)}%`]);
  if (metrics.timeToFirstMs !== undefined) kv.push(["TTFA", `${metrics.timeToFirstMs}ms`]);
  if (metrics.latencyP95Ms !== undefined) kv.push(["p95", `${metrics.latencyP95Ms}ms`]);
  if (metrics.tokensPerSecond !== undefined)
    kv.push(["tok/s", metrics.tokensPerSecond.toFixed(0)]);
  if (metrics.costPer1MInput !== undefined)
    kv.push(["$/1M in", `$${metrics.costPer1MInput.toFixed(2)}`]);
  if (metrics.costPer1MOutput !== undefined)
    kv.push(["$/1M out", `$${metrics.costPer1MOutput.toFixed(2)}`]);
  if (metrics.costPer1MChars !== undefined)
    kv.push(["$/1Mchar", `$${metrics.costPer1MChars.toFixed(0)}`]);
  if (metrics.costPerImage !== undefined)
    kv.push([modality === "3d-gen" ? "$/gen" : "$/img", `$${metrics.costPerImage.toFixed(3)}`]);
  if (metrics.costPerAudioHour !== undefined)
    kv.push(["$/hr", `$${metrics.costPerAudioHour.toFixed(2)}`]);
  if (metrics.costPerVideoSecond !== undefined)
    kv.push(["$/sec", `$${metrics.costPerVideoSecond.toFixed(3)}`]);
  if (metrics.contextWindow !== undefined)
    kv.push(["Ctx", `${(metrics.contextWindow / 1000).toFixed(0)}k`]);
  return (
    <div className="inference-inspector-bench-grid">
      {kv.map(([k, v]) => (
        <div key={k} className="inference-inspector-bench-cell">
          <span className="inference-inspector-kv-label">{k}</span>
          <span className="inference-mono">{v}</span>
        </div>
      ))}
    </div>
  );
}
