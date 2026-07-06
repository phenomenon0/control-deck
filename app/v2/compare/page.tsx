"use client";

/**
 * /v2/compare — Atlas Visual 2 COMPARE surface. Side-by-side model comparison.
 *
 * Pick 2–3 models from a pill picker; each becomes a Floating-Paper column.
 * A shared spec/benchmark matrix runs down the columns — params, quant, VRAM,
 * context, ELO / MMLU / MOS / WER, tokens-per-sec, latency, and cost — and the
 * BETTER VALUE per row is highlighted with a semantic (positive) accent. Rows
 * with no data across the selected models hide themselves, so a text-vs-text
 * compare and a local-vs-local compare each render only their relevant rows.
 *
 * Real data (client fetch, graceful fallback to a realistic pool on error):
 *   · /api/inference/benchmarks       — curated cloud/frontier benchmark matrix
 *                                       (ELO, MMLU, MOS, WER, cost, context…).
 *   · /api/ollama/tags                — installed local models (params, quant,
 *                                       disk size ≈ VRAM footprint).
 * Installed local models are merged onto any matching benchmark entry so a
 * local row carries both its real specs and any curated throughput number.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./compare-v2.css";

/* ── icons ──────────────────────────────────────────────────────────────── */
const IcCheck = <svg viewBox="0 0 24 24" className="gl"><path d="M20 6L9 17l-5-5" /></svg>;
const IcX = <svg viewBox="0 0 24 24" className="gl"><path d="M18 6L6 18M6 6l12 12" /></svg>;
const IcUp = <svg viewBox="0 0 24 24" className="gl"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
const IcRefresh = <svg viewBox="0 0 24 24" className="gl"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>;

/* ── types ──────────────────────────────────────────────────────────────── */
type ModalityId =
  | "text" | "vision" | "image-gen" | "audio-gen" | "tts"
  | "stt" | "embedding" | "rerank" | "3d-gen" | "video-gen";

interface Metrics {
  qualityElo?: number; qualityMos?: number; qualityWer?: number; qualityMmlu?: number;
  timeToFirstMs?: number; tokensPerSecond?: number; latencyP95Ms?: number;
  costPer1MInput?: number; costPer1MOutput?: number; costPer1MChars?: number;
  costPerImage?: number; costPerAudioHour?: number; costPerVideoSecond?: number;
  contextWindow?: number;
}
interface BenchEntry {
  providerId: string; model: string; modality: ModalityId;
  metrics: Metrics; source: string; sourceUrl?: string; asOf: string; note?: string;
}
interface TagModel {
  name: string; model: string; size: number;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}
type Origin = "local" | "cloud";
interface Cand {
  key: string;
  name: string;
  provider: string;
  modality: ModalityId;
  origin: Origin;
  installed?: boolean;
  metrics: Metrics;
  params?: string;
  quant?: string;
  sizeBytes?: number;
  source: string;
  sourceUrl?: string;
  asOf: string;
}

const MAX_COLS = 3;

/* ── metric matrix definition ───────────────────────────────────────────────
   dir: "hi" = higher wins, "lo" = lower wins, null = spec (no winner). */
type Dir = "hi" | "lo" | null;
interface MetricDef {
  key: string;
  label: string;
  group: "SPEC" | "QUALITY" | "SPEED" | "COST";
  dir: Dir;
  value: (c: Cand) => number | undefined;
  fmt: (c: Cand) => string;
}

const ctxFmt = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M` : `${Math.round(v / 1000)}k`;
const gb = (b: number) => `${(b / 1_000_000_000).toFixed(1)} GB`;
const usd = (v: number, d: number) => (v === 0 ? "free" : `$${v.toFixed(d)}`);

const METRICS: MetricDef[] = [
  // SPEC
  { key: "params", label: "Params", group: "SPEC", dir: null, value: () => undefined, fmt: (c) => c.params ?? "—" },
  { key: "quant", label: "Quant", group: "SPEC", dir: null, value: () => undefined, fmt: (c) => c.quant ?? "—" },
  { key: "vram", label: "Size · VRAM", group: "SPEC", dir: "lo", value: (c) => c.sizeBytes, fmt: (c) => (c.sizeBytes ? gb(c.sizeBytes) : "—") },
  { key: "ctx", label: "Context", group: "SPEC", dir: "hi", value: (c) => c.metrics.contextWindow, fmt: (c) => (c.metrics.contextWindow ? ctxFmt(c.metrics.contextWindow) : "—") },
  // QUALITY
  { key: "elo", label: "ELO", group: "QUALITY", dir: "hi", value: (c) => c.metrics.qualityElo, fmt: (c) => (c.metrics.qualityElo != null ? c.metrics.qualityElo.toFixed(0) : "—") },
  { key: "mmlu", label: "MMLU", group: "QUALITY", dir: "hi", value: (c) => c.metrics.qualityMmlu, fmt: (c) => (c.metrics.qualityMmlu != null ? `${(c.metrics.qualityMmlu * 100).toFixed(1)}%` : "—") },
  { key: "mos", label: "MOS", group: "QUALITY", dir: "hi", value: (c) => c.metrics.qualityMos, fmt: (c) => (c.metrics.qualityMos != null ? c.metrics.qualityMos.toFixed(2) : "—") },
  { key: "wer", label: "WER", group: "QUALITY", dir: "lo", value: (c) => c.metrics.qualityWer, fmt: (c) => (c.metrics.qualityWer != null ? `${(c.metrics.qualityWer * 100).toFixed(1)}%` : "—") },
  // SPEED
  { key: "tps", label: "Tokens/s", group: "SPEED", dir: "hi", value: (c) => c.metrics.tokensPerSecond, fmt: (c) => (c.metrics.tokensPerSecond != null ? c.metrics.tokensPerSecond.toFixed(0) : "—") },
  { key: "ttfa", label: "First token", group: "SPEED", dir: "lo", value: (c) => c.metrics.timeToFirstMs, fmt: (c) => (c.metrics.timeToFirstMs != null ? `${c.metrics.timeToFirstMs} ms` : "—") },
  { key: "p95", label: "Latency p95", group: "SPEED", dir: "lo", value: (c) => c.metrics.latencyP95Ms, fmt: (c) => (c.metrics.latencyP95Ms != null ? (c.metrics.latencyP95Ms >= 1000 ? `${(c.metrics.latencyP95Ms / 1000).toFixed(1)} s` : `${c.metrics.latencyP95Ms} ms`) : "—") },
  // COST
  { key: "costIn", label: "$/1M in", group: "COST", dir: "lo", value: (c) => c.metrics.costPer1MInput, fmt: (c) => (c.metrics.costPer1MInput != null ? usd(c.metrics.costPer1MInput, 2) : "—") },
  { key: "costOut", label: "$/1M out", group: "COST", dir: "lo", value: (c) => c.metrics.costPer1MOutput, fmt: (c) => (c.metrics.costPer1MOutput != null ? usd(c.metrics.costPer1MOutput, 2) : "—") },
  { key: "costChar", label: "$/1M char", group: "COST", dir: "lo", value: (c) => c.metrics.costPer1MChars, fmt: (c) => (c.metrics.costPer1MChars != null ? usd(c.metrics.costPer1MChars, 0) : "—") },
  { key: "costImg", label: "$/image", group: "COST", dir: "lo", value: (c) => c.metrics.costPerImage, fmt: (c) => (c.metrics.costPerImage != null ? usd(c.metrics.costPerImage, 3) : "—") },
  { key: "costAud", label: "$/audio hr", group: "COST", dir: "lo", value: (c) => c.metrics.costPerAudioHour, fmt: (c) => (c.metrics.costPerAudioHour != null ? usd(c.metrics.costPerAudioHour, 2) : "—") },
  { key: "costVid", label: "$/video s", group: "COST", dir: "lo", value: (c) => c.metrics.costPerVideoSecond, fmt: (c) => (c.metrics.costPerVideoSecond != null ? usd(c.metrics.costPerVideoSecond, 3) : "—") },
];

const GROUPS: MetricDef["group"][] = ["SPEC", "QUALITY", "SPEED", "COST"];
const MOD_ORDER: ModalityId[] = ["text", "vision", "image-gen", "audio-gen", "tts", "stt", "embedding", "rerank", "3d-gen", "video-gen"];
const MOD_LABEL: Record<ModalityId, string> = {
  text: "text", vision: "vision", "image-gen": "image", "audio-gen": "audio", tts: "tts",
  stt: "stt", embedding: "embed", rerank: "rerank", "3d-gen": "3d", "video-gen": "video",
};

/* ── realistic fallback pool (used only if both fetches fail) ─────────────── */
const FALLBACK: Cand[] = [
  { key: "openai:gpt-5.4", name: "gpt-5.4", provider: "openai", modality: "text", origin: "cloud", source: "OpenRouter Rankings", asOf: "2026-04", metrics: { qualityElo: 1319, qualityMmlu: 0.923, costPer1MInput: 5, costPer1MOutput: 20, contextWindow: 1_000_000 } },
  { key: "anthropic:claude-opus-4-7", name: "claude-opus-4-7", provider: "anthropic", modality: "text", origin: "cloud", source: "Anthropic + Artificial Analysis", asOf: "2026-04", metrics: { qualityElo: 1305, qualityMmlu: 0.914, costPer1MInput: 15, costPer1MOutput: 75, contextWindow: 1_000_000 } },
  { key: "deepseek:deepseek-chat", name: "deepseek-chat", provider: "deepseek", modality: "text", origin: "cloud", source: "OpenRouter Rankings", asOf: "2026-04", metrics: { qualityElo: 1288, qualityMmlu: 0.893, costPer1MInput: 0.27, costPer1MOutput: 1.1, contextWindow: 128_000 } },
  { key: "ollama:qwen3.5:latest", name: "qwen3.5:latest", provider: "ollama", modality: "text", origin: "local", installed: true, params: "9.7B", quant: "Q4_K_M", sizeBytes: 6_594_474_711, source: "Ollama · local", asOf: "", metrics: {} },
];

/* ── data building ──────────────────────────────────────────────────────── */
function modalityOfTag(t: TagModel): ModalityId {
  const f = `${t.details?.family ?? ""} ${t.name}`.toLowerCase();
  if (f.includes("embed") || f.includes("bert")) return "embedding";
  return "text";
}

function buildPool(bench: BenchEntry[], tags: TagModel[]): Cand[] {
  const map = new Map<string, Cand>();
  for (const b of bench) {
    const local = b.providerId === "ollama";
    const key = `${local ? "ollama" : b.providerId}:${b.model}`;
    map.set(key, {
      key, name: b.model, provider: b.providerId, modality: b.modality,
      origin: local ? "local" : "cloud", metrics: b.metrics,
      source: b.source, sourceUrl: b.sourceUrl, asOf: b.asOf,
    });
  }
  for (const t of tags) {
    const key = `ollama:${t.name}`;
    const existing = map.get(key);
    if (existing) {
      existing.params = t.details?.parameter_size;
      existing.quant = t.details?.quantization_level;
      existing.sizeBytes = t.size;
      existing.installed = true;
    } else {
      map.set(key, {
        key, name: t.name, provider: "ollama", modality: modalityOfTag(t),
        origin: "local", installed: true, metrics: {},
        params: t.details?.parameter_size, quant: t.details?.quantization_level,
        sizeBytes: t.size, source: "Ollama · local", asOf: "",
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === "local" ? -1 : 1;
    if (!!a.installed !== !!b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/* winners for a metric across the selected columns (ties → all marked). */
function winnersFor(def: MetricDef, cols: Cand[]): Set<string> {
  const out = new Set<string>();
  if (def.dir === null) return out;
  const vals = cols
    .map((c) => ({ key: c.key, v: def.value(c) }))
    .filter((x): x is { key: string; v: number } => x.v != null);
  if (vals.length < 2) return out;
  const best = def.dir === "hi"
    ? Math.max(...vals.map((x) => x.v))
    : Math.min(...vals.map((x) => x.v));
  for (const x of vals) if (x.v === best) out.add(x.key);
  return out;
}

/* ── component ──────────────────────────────────────────────────────────── */
export default function ComparePage() {
  const [pool, setPool] = useState<Cand[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [modality, setModality] = useState<ModalityId>("text");
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, tRes] = await Promise.all([
        fetch("/api/inference/benchmarks", { cache: "no-store" }).catch(() => null),
        fetch("/api/ollama/tags", { cache: "no-store" }).catch(() => null),
      ]);
      let bench: BenchEntry[] = [];
      let tags: TagModel[] = [];
      if (bRes?.ok) bench = ((await bRes.json()) as { entries?: BenchEntry[] }).entries ?? [];
      if (tRes?.ok) tags = ((await tRes.json()) as { models?: TagModel[] }).models ?? [];
      if (bench.length === 0 && tags.length === 0) {
        setPool(FALLBACK);
        setLive(false);
      } else {
        setPool(buildPool(bench, tags));
        setLive(true);
      }
    } catch {
      setPool(FALLBACK);
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // seed a sensible default comparison ONCE, when the pool first arrives —
  // guarded so a later "clear" can actually reach the empty state.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || pool.length === 0) return;
    seeded.current = true;
    const prefer = ["openai:gpt-5.4", "anthropic:claude-opus-4-7", "deepseek:deepseek-chat"];
    const seed = prefer.filter((k) => pool.some((c) => c.key === k));
    setSelected(seed.length >= 2 ? seed : pool.filter((c) => c.modality === "text").slice(0, 3).map((c) => c.key));
  }, [pool]);

  const modalities = useMemo(
    () => MOD_ORDER.filter((m) => pool.some((c) => c.modality === m)),
    [pool],
  );

  const picker = useMemo(
    () => pool.filter((c) => c.modality === modality),
    [pool, modality],
  );

  const cols = useMemo(
    () => selected.map((k) => pool.find((c) => c.key === k)).filter((c): c is Cand => !!c),
    [selected, pool],
  );

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_COLS) return prev;
      return [...prev, key];
    });
  }, []);

  // visible metric rows + per-row winners, grouped
  const view = useMemo(() => {
    const winByKey = new Map<string, Set<string>>();
    const winTally = new Map<string, number>();
    cols.forEach((c) => winTally.set(c.key, 0));
    const groups = GROUPS.map((g) => {
      const rows = METRICS.filter((m) => m.group === g).filter((m) => cols.some((c) => m.fmt(c) !== "—"));
      rows.forEach((m) => {
        const w = winnersFor(m, cols);
        winByKey.set(m.key, w);
        w.forEach((k) => winTally.set(k, (winTally.get(k) ?? 0) + 1));
      });
      return { group: g, rows };
    }).filter((s) => s.rows.length > 0);
    return { groups, winByKey, winTally };
  }, [cols]);

  return (
    <div className="av2-compare">
      <div className="wrap">
        {/* hero */}
        <header className="hero">
          <div className="hero-lede">
            <span className="kicker">Model comparison</span>
            <h1>Compare</h1>
            <p>
              Line models up side by side across specs and benchmarks. The stronger value
              in each row is marked in green — throughput, quality, and cost, weighed at a glance.
            </p>
          </div>
          <div className="hero-side">
            <span className={`src-chip src-chip--${live ? "ok" : "warn"}`}>
              <span className="dot" />
              {live ? "live data" : "offline · sample"}
            </span>
            <button className="btn btn--icon" onClick={() => void load()} title="reload">
              <span className="ic">{IcRefresh}</span>reload
            </button>
          </div>
        </header>

        {/* controls */}
        <div className="controls">
          <div className="seg" role="tablist" aria-label="Modality">
            {modalities.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={m === modality}
                className={`seg-btn${m === modality ? " is-active" : ""}`}
                onClick={() => setModality(m)}
              >
                {MOD_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="controls-right">
            <span className="legend"><i className="legend-mark" />better value</span>
            <span className={`count${selected.length >= MAX_COLS ? " count--full" : ""}`}>
              {selected.length} / {MAX_COLS}
            </span>
            {selected.length > 0 && (
              <button className="link-btn" onClick={() => setSelected([])}>clear</button>
            )}
          </div>
        </div>

        {/* picker */}
        <div className="pick" role="group" aria-label="Choose models">
          {loading && pool.length === 0 ? (
            <span className="pick-empty">loading models…</span>
          ) : picker.length === 0 ? (
            <span className="pick-empty">no {MOD_LABEL[modality]} models in the catalog</span>
          ) : (
            picker.map((c) => {
              const on = selected.includes(c.key);
              const blocked = !on && selected.length >= MAX_COLS;
              return (
                <button
                  key={c.key}
                  className={`pill${on ? " is-on" : ""}`}
                  disabled={blocked}
                  onClick={() => toggle(c.key)}
                  title={blocked ? `Remove one to add — max ${MAX_COLS}` : c.key}
                >
                  <span className={`pill-dot pill-dot--${c.origin}`} />
                  <span className="pill-name">{c.name}</span>
                  <span className="pill-prov">{c.provider}</span>
                  {on && <span className="pill-check">{IcCheck}</span>}
                </button>
              );
            })
          )}
        </div>

        {/* comparison grid */}
        {cols.length < 2 ? (
          <div className="prompt">
            <p>Select at least two models above to compare them side by side.</p>
          </div>
        ) : (
          <div className="cmp-grid">
            {/* label rail */}
            <div className="cmp-col cmp-col--labels">
              <div className="cmp-head cmp-head--labels">
                <span className="kicker">Metric</span>
                <span className="cmp-head-note">specs · benchmarks</span>
              </div>
              {view.groups.map((s) => (
                <div key={s.group}>
                  <div className="cmp-cell cmp-cell--section">{s.group}</div>
                  {s.rows.map((m) => (
                    <div key={m.key} className="cmp-cell cmp-cell--label">
                      <span>{m.label}</span>
                      {m.dir && <span className={`dir dir--${m.dir}`}>{m.dir === "hi" ? "↑" : "↓"}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* model columns */}
            {cols.map((c) => {
              const wins = view.winTally.get(c.key) ?? 0;
              return (
                <div key={c.key} className="cmp-col cmp-col--model">
                  <div className="cmp-head">
                    <button className="cmp-remove" onClick={() => toggle(c.key)} aria-label={`Remove ${c.name}`}>
                      {IcX}
                    </button>
                    <span className="cmp-prov">
                      <span className={`pill-dot pill-dot--${c.origin}`} />
                      {c.provider} · {c.origin}
                    </span>
                    <h3 className="cmp-name" title={c.name}>{c.name}</h3>
                    <div className="cmp-tags">
                      <span className="tag">{MOD_LABEL[c.modality]}</span>
                      {wins > 0 && (
                        <span className="tag tag--win">
                          <span className="ic">{IcUp}</span>{wins} best
                        </span>
                      )}
                    </div>
                  </div>
                  {view.groups.map((s) => (
                    <div key={s.group}>
                      <div className="cmp-cell cmp-cell--section" aria-hidden />
                      {s.rows.map((m) => {
                        const isWin = view.winByKey.get(m.key)?.has(c.key) ?? false;
                        const txt = m.fmt(c);
                        return (
                          <div key={m.key} className={`cmp-cell cmp-cell--val${isWin ? " cmp-cell--win" : ""}${txt === "—" ? " cmp-cell--na" : ""}`}>
                            {isWin && <span className="win-mark">{IcUp}</span>}
                            <span className="val">{txt}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* citation */}
        {cols.length >= 2 && (
          <div className="cites">
            {cols.map((c) => (
              <span key={c.key} className="cite">
                <b>{c.name}</b> {c.source}{c.asOf ? ` · ${c.asOf}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
