"use client";

/**
 * Overview tab — one row per modality with current binding, provider count,
 * and live metrics. Click a row → navigate to that modality's tab.
 */

import { useCallback, useEffect, useState } from "react";

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

interface ModalityMeta {
  id: ModalityId;
  name: string;
  description: string;
  slots: string[];
}

interface ProviderEntry {
  id: string;
  name: string;
  requiresApiKey: boolean;
}

interface ProvidersResponse {
  modalities: ModalityMeta[];
  providers: Record<ModalityId, ProviderEntry[]>;
}

interface SlotBinding {
  providerId: string;
  config: { model?: string };
}

interface BindingsResponse {
  effective: Record<string, SlotBinding | null>;
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

interface MetricsResponse {
  summary: MetricsSummary[];
}

interface OverviewTabProps {
  refreshToken: number;
  onNavigate: (tabId: ModalityId) => void;
  showOnlineModels: boolean;
}

export function OverviewTab({ refreshToken, onNavigate, showOnlineModels }: OverviewTabProps) {
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [bindings, setBindings] = useState<BindingsResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, b, m] = await Promise.all([
        fetch("/api/inference/providers", { cache: "no-store" }),
        fetch("/api/inference/bindings", { cache: "no-store" }),
        fetch("/api/inference/metrics", { cache: "no-store" }),
      ]);
      if (!p.ok) throw new Error(`providers ${p.status}`);
      if (!b.ok) throw new Error(`bindings ${b.status}`);
      if (!m.ok) throw new Error(`metrics ${m.status}`);
      setProviders((await p.json()) as ProvidersResponse);
      setBindings((await b.json()) as BindingsResponse);
      setMetrics((await m.json()) as MetricsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  if (loading && !providers) {
    return <div className="inference-empty">Loading control plane…</div>;
  }
  if (error) {
    return <div className="inference-empty inference-empty--error">{error}</div>;
  }
  if (!providers || !bindings) return null;

  return (
    <div className="inference-overview">
      <div className="inference-overview-row inference-overview-row--head" role="row">
        <div>Modality</div>
        <div>Bound provider</div>
        <div>Model</div>
        <div className="inference-col-right">Providers</div>
        <div className="inference-col-right">Recent calls</div>
        <div className="inference-col-right">p95</div>
      </div>
      {providers.modalities.map((meta) => {
        const bound = bindings.effective[`${meta.id}::primary`] ?? null;
        const allProviders = providers.providers[meta.id] ?? [];
        const visibleProviders = showOnlineModels
          ? allProviders
          : allProviders.filter((p) => !p.requiresApiKey);
        const boundProvider = allProviders.find(
          (p) => p.id === bound?.providerId,
        );
        const boundHidden = Boolean(boundProvider?.requiresApiKey && !showOnlineModels);
        const modalityMetrics = (metrics?.summary ?? []).filter(
          (s) => s.modality === meta.id,
        );
        const totalCalls = modalityMetrics.reduce((sum, s) => sum + s.count, 0);
        const p95 = modalityMetrics.length > 0
          ? Math.max(...modalityMetrics.map((s) => s.p95ms))
          : null;

        return (
          <button
            key={meta.id}
            type="button"
            onClick={() => onNavigate(meta.id)}
            className="inference-overview-row"
            aria-label={`Open ${meta.name} tab`}
          >
            <div className="inference-modality-name">
              <span>{meta.name}</span>
              <span className="inference-modality-desc">{meta.description}</span>
            </div>
            <div>
              {boundHidden ? (
                <span className="inference-binding inference-binding--unbound">online hidden</span>
              ) : bound ? (
                <span className="inference-binding">
                  <span className="inference-dot inference-dot--ok" />
                  <span>{boundProvider?.name ?? bound.providerId}</span>
                </span>
              ) : (
                <span className="inference-binding inference-binding--unbound">unbound</span>
              )}
            </div>
            <div className="inference-mono">{boundHidden ? "—" : bound?.config.model ?? "—"}</div>
            <div className="inference-col-right">{visibleProviders.length}</div>
            <div className="inference-col-right inference-mono">{totalCalls || "—"}</div>
            <div className="inference-col-right inference-mono">
              {p95 !== null ? `${Math.round(p95)}ms` : "—"}
            </div>
          </button>
        );
      })}
    </div>
  );
}
