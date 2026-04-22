"use client";

/**
 * ProviderCompareTable — the core "effectively compare" surface.
 *
 * One row per registered provider in this modality. Columns shape to the
 * modality: text + vision get ELO / cost-in / cost-out / context; TTS gets
 * MOS / TTFA / $/1Mchar; STT gets WER / TTFA / $/hour; image/audio/3d/video
 * get ELO or MOS / latency / $/image-or-sec; embedding/rerank get cost.
 *
 * Data joins three sources: /api/inference/providers (registry), curated
 * benchmarks via /api/inference/benchmarks, and /api/inference/bindings
 * to highlight the currently-bound row. Clicking Bind writes through
 * PUT /api/inference/bindings.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

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

interface SlotBinding {
  modality: string;
  slotName: string;
  providerId: string;
  config: { providerId: string; model?: string; apiKey?: string; baseURL?: string };
}

interface BindingsResponse {
  effective: Record<string, SlotBinding | null>;
}

interface ColumnDef {
  key: string;
  label: string;
  render: (row: Row) => string;
  /** Higher is better? Used for visual ranking cues. */
  higherIsBetter?: boolean;
  numeric?: boolean;
}

interface Row {
  provider: ProviderEntry;
  bench: BenchmarkEntry | null;
  bound: boolean;
}

function headlineCols(modality: ModalityId): ColumnDef[] {
  if (modality === "text" || modality === "vision") {
    return [
      {
        key: "elo",
        label: "ELO",
        render: (r) => (r.bench?.metrics.qualityElo?.toFixed(0) ?? "—"),
        higherIsBetter: true,
        numeric: true,
      },
      {
        key: "costIn",
        label: "$/1M in",
        render: (r) =>
          r.bench?.metrics.costPer1MInput !== undefined
            ? `$${r.bench.metrics.costPer1MInput.toFixed(2)}`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
      {
        key: "costOut",
        label: "$/1M out",
        render: (r) =>
          r.bench?.metrics.costPer1MOutput !== undefined
            ? `$${r.bench.metrics.costPer1MOutput.toFixed(2)}`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
      {
        key: "context",
        label: "Ctx",
        render: (r) =>
          r.bench?.metrics.contextWindow
            ? `${(r.bench.metrics.contextWindow / 1000).toFixed(0)}k`
            : "—",
        higherIsBetter: true,
        numeric: true,
      },
    ];
  }
  if (modality === "tts") {
    return [
      {
        key: "mos",
        label: "MOS",
        render: (r) => (r.bench?.metrics.qualityMos?.toFixed(2) ?? "—"),
        higherIsBetter: true,
        numeric: true,
      },
      {
        key: "ttfa",
        label: "TTFA",
        render: (r) =>
          r.bench?.metrics.timeToFirstMs !== undefined
            ? `${r.bench.metrics.timeToFirstMs}ms`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
      {
        key: "cost",
        label: "$/1Mchar",
        render: (r) =>
          r.bench?.metrics.costPer1MChars !== undefined
            ? `$${r.bench.metrics.costPer1MChars.toFixed(0)}`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
    ];
  }
  if (modality === "stt") {
    return [
      {
        key: "wer",
        label: "WER",
        render: (r) =>
          r.bench?.metrics.qualityWer !== undefined
            ? `${(r.bench.metrics.qualityWer * 100).toFixed(1)}%`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
      {
        key: "ttfa",
        label: "TTFA",
        render: (r) =>
          r.bench?.metrics.timeToFirstMs !== undefined
            ? `${r.bench.metrics.timeToFirstMs}ms`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
      {
        key: "cost",
        label: "$/hr",
        render: (r) =>
          r.bench?.metrics.costPerAudioHour !== undefined
            ? `$${r.bench.metrics.costPerAudioHour.toFixed(2)}`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
    ];
  }
  if (modality === "image-gen") {
    return [
      {
        key: "elo",
        label: "ELO",
        render: (r) => (r.bench?.metrics.qualityElo?.toFixed(0) ?? "—"),
        higherIsBetter: true,
        numeric: true,
      },
      {
        key: "latency",
        label: "p95",
        render: (r) =>
          r.bench?.metrics.latencyP95Ms !== undefined
            ? `${(r.bench.metrics.latencyP95Ms / 1000).toFixed(1)}s`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
      {
        key: "cost",
        label: "$/img",
        render: (r) =>
          r.bench?.metrics.costPerImage !== undefined
            ? `$${r.bench.metrics.costPerImage.toFixed(3)}`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
    ];
  }
  if (modality === "audio-gen") {
    return [
      {
        key: "mos",
        label: "MOS",
        render: (r) => (r.bench?.metrics.qualityMos?.toFixed(2) ?? "—"),
        higherIsBetter: true,
        numeric: true,
      },
      {
        key: "latency",
        label: "p95",
        render: (r) =>
          r.bench?.metrics.latencyP95Ms !== undefined
            ? `${(r.bench.metrics.latencyP95Ms / 1000).toFixed(1)}s`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
    ];
  }
  if (modality === "embedding") {
    return [
      {
        key: "costIn",
        label: "$/1M",
        render: (r) =>
          r.bench?.metrics.costPer1MInput !== undefined
            ? `$${r.bench.metrics.costPer1MInput.toFixed(3)}`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
    ];
  }
  if (modality === "rerank") {
    return [
      {
        key: "latency",
        label: "p95",
        render: (r) =>
          r.bench?.metrics.latencyP95Ms !== undefined
            ? `${r.bench.metrics.latencyP95Ms}ms`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
    ];
  }
  if (modality === "3d-gen" || modality === "video-gen") {
    const costKey =
      modality === "video-gen" ? ("costPerVideoSecond" as const) : ("costPerImage" as const);
    return [
      {
        key: "latency",
        label: "p95",
        render: (r) =>
          r.bench?.metrics.latencyP95Ms !== undefined
            ? `${(r.bench.metrics.latencyP95Ms / 1000).toFixed(0)}s`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
      {
        key: "cost",
        label: modality === "video-gen" ? "$/sec" : "$/gen",
        render: (r) =>
          r.bench?.metrics[costKey] !== undefined
            ? `$${(r.bench.metrics[costKey] as number).toFixed(3)}`
            : "—",
        higherIsBetter: false,
        numeric: true,
      },
    ];
  }
  return [];
}

interface Props {
  modality: ModalityId;
  onDetails?: (providerId: string) => void;
  refreshToken: number;
}

export function ProviderCompareTable({ modality, onDetails, refreshToken }: Props) {
  const { open: openPreview } = useSourcePreview();

  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkEntry[]>([]);
  const [bindings, setBindings] = useState<BindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b, bind] = await Promise.all([
        fetch(`/api/inference/providers?modality=${modality}`, { cache: "no-store" }),
        fetch(`/api/inference/benchmarks?modality=${modality}`, { cache: "no-store" }),
        fetch(`/api/inference/bindings`, { cache: "no-store" }),
      ]);
      if (p.ok) {
        const j = (await p.json()) as { providers?: ProviderEntry[] };
        setProviders(j.providers ?? []);
      }
      if (b.ok) {
        const j = (await b.json()) as { entries?: BenchmarkEntry[] };
        setBenchmarks(j.entries ?? []);
      }
      if (bind.ok) setBindings((await bind.json()) as BindingsResponse);
    } finally {
      setLoading(false);
    }
  }, [modality]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const bindProvider = useCallback(
    async (provider: ProviderEntry, model?: string) => {
      setSaving(provider.id);
      setMsg(null);
      try {
        const body: SlotBinding = {
          modality,
          slotName: "primary",
          providerId: provider.id,
          config: { providerId: provider.id, model },
        };
        const res = await fetch("/api/inference/bindings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        setMsg(`Bound ${provider.name}`);
        await load();
      } catch (e) {
        setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSaving(null);
        setTimeout(() => setMsg(null), 2500);
      }
    },
    [modality, load],
  );

  const bound = bindings?.effective[`${modality}::primary`]?.providerId;

  const cols = useMemo(() => headlineCols(modality), [modality]);

  const rows: Row[] = useMemo(
    () =>
      providers.map((p) => {
        const bench =
          benchmarks.find((b) => b.providerId === p.id && p.defaultModels.includes(b.model)) ??
          benchmarks.find((b) => b.providerId === p.id) ??
          null;
        return { provider: p, bench, bound: p.id === bound };
      }),
    [providers, benchmarks, bound],
  );

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = cols.find((c) => c.key === sortKey);
    if (!col) return rows;
    const sortedRows = [...rows].sort((a, b) => {
      const aStr = col.render(a);
      const bStr = col.render(b);
      // Numeric compare — strip non-numeric chars.
      if (col.numeric) {
        const aN = parseNumericMaybe(aStr);
        const bN = parseNumericMaybe(bStr);
        if (aN === null && bN === null) return 0;
        if (aN === null) return 1;
        if (bN === null) return -1;
        return sortDir === "asc" ? aN - bN : bN - aN;
      }
      return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
    return sortedRows;
  }, [rows, sortKey, sortDir, cols]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (loading && providers.length === 0) {
    return <div className="inference-empty">Loading providers…</div>;
  }

  return (
    <section className="inference-compare">
      <div className="inference-compare-head">
        <div className="label">Compare · {providers.length} providers</div>
        {msg && <span className="inference-compare-msg">{msg}</span>}
      </div>
      <div className="inference-compare-table-wrap">
        <table className="inference-compare-table">
          <thead>
            <tr>
              <th className="inference-compare-th">Provider</th>
              <th className="inference-compare-th">Default model</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="inference-compare-th inference-compare-th--sortable"
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label} {sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
              ))}
              <th className="inference-compare-th">Source</th>
              <th className="inference-compare-th inference-compare-th--actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ provider, bench, bound: isBound }) => {
              const model = provider.defaultModels[0];
              return (
                <tr
                  key={provider.id}
                  className={`inference-compare-row${isBound ? " inference-compare-row--bound" : ""}`}
                >
                  <td>
                    <div className="inference-compare-provider">
                      <span className="inference-compare-name">{provider.name}</span>
                      <span
                        className={`inference-badge inference-badge--${
                          provider.requiresApiKey ? "cloud" : "local"
                        }`}
                      >
                        {provider.requiresApiKey ? "cloud" : "local"}
                      </span>
                      {isBound && <span className="inference-badge inference-badge--bound">BOUND</span>}
                    </div>
                    <div className="inference-compare-desc">{provider.description}</div>
                  </td>
                  <td className="inference-mono">{model ?? "—"}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="inference-col-right inference-mono">
                      {c.render({ provider, bench, bound: isBound })}
                    </td>
                  ))}
                  <td className="inference-compare-source">
                    {bench?.sourceUrl ? (
                      <button
                        type="button"
                        onClick={() => openPreview({ url: bench.sourceUrl!, label: bench.source })}
                        title={bench.source}
                        className="inference-compare-source-btn"
                      >
                        {shortSource(bench.source)} ⤵
                      </button>
                    ) : bench?.source ? (
                      <span title={bench.source}>{shortSource(bench.source)}</span>
                    ) : (
                      <span className="inference-text-muted">—</span>
                    )}
                  </td>
                  <td className="inference-compare-actions">
                    <button
                      type="button"
                      className="inference-action-btn"
                      disabled={saving === provider.id || isBound}
                      onClick={() => void bindProvider(provider, model)}
                    >
                      {isBound ? "Bound" : saving === provider.id ? "…" : "Bind"}
                    </button>
                    <button
                      type="button"
                      className="inference-action-btn inference-action-btn--ghost"
                      onClick={() => onDetails?.(provider.id)}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function parseNumericMaybe(s: string): number | null {
  if (s === "—" || s === "") return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function shortSource(s: string): string {
  if (s.length <= 28) return s;
  return s.slice(0, 25) + "…";
}
