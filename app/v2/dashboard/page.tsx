"use client";
import "./dashboard-v2.css";
import { useEffect, useState, type ReactNode } from "react";

/* Atlas icon dialect — path data only; .ic svg supplies stroke/fill (see CSS). */
const P: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6"/>',
  bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>',
  "chevron-right": '<path d="M9 18l6-6-6-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
};
function Ico({ name, size = 15, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
  return (
    <span className="ic" style={{ display: "inline-flex" }}>
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} strokeWidth={stroke}
        dangerouslySetInnerHTML={{ __html: P[name] }} />
    </span>
  );
}

type Stat = { label: string; value: string; delta: string; cls: string };
type Surface = { kicker: string; h3: string; p: string; stamps: string[]; meta: string; tag: string; tone: string };
type Feed = { icon: string; b: string; small: string; tag: ReactNode };

/* Realistic placeholders — used as the initial render and as the graceful
   fallback when a real source is offline or unreachable. */
const STATS_FALLBACK: Stat[] = [
  { label: "Models loaded", value: "4", delta: "±0 this hour", cls: "" },
  { label: "VRAM used", value: "18.4G", delta: "▲ 77% of 24G", cls: "warn" },
  // Requests / Failed have no real source until /api/agui/runs answers — these
  // are honest placeholders (marked "sample"), never faked precision.
  { label: "Requests · today", value: "—", delta: "sample", cls: "" },
  { label: "Failed jobs", value: "—", delta: "sample", cls: "" },
];

const SURFACES_FALLBACK: Surface[] = [
  { kicker: "MDL-30B · llm", h3: "qwen3-30b-a3b", p: "Routed local under 8k ctx, warm on the 4090.", stamps: ["local", "gguf"], meta: "loaded 2h ago", tag: "serving", tone: "positive" },
  { kicker: "MDL-SDXL · image", h3: "sdxl-turbo", p: "Text-to-image, 768². Cold start ~1.4s from idle.", stamps: ["image", "fp16"], meta: "idle 40m", tag: "idle", tone: "caution" },
  { kicker: "SVC-CMF · pipeline", h3: "comfyui queue", p: "Hunyuan3D job wedged on draco compression.", stamps: ["pipeline", "gpu"], meta: "3d stale", tag: "blocked", tone: "danger" },
];

const FEED_FALLBACK: Feed[] = [
  { icon: "image", b: "sdxl-turbo · seed 41208.png", small: "bounced 2h ago · 768² · 1.4s", tag: <span className="tag">image</span> },
  { icon: "file", b: "routing-thresholds.md", small: "edited yesterday · jethro", tag: <span className="tag">docs</span> },
  { icon: "cpu", b: "hunyuan3d-pipeline", small: "failing · draco compression", tag: <span className="tag tag--status tag--danger">blocked</span> },
];

/** Deterministic "N ago" formatter — pure code, no model in the loop. */
function rel(iso?: string): string {
  if (!iso) return "recently";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "recently";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function gb(bytes?: number): string {
  return ((bytes ?? 0) / 1e9).toFixed(1) + "G";
}

interface LoadedModel {
  name: string;
  size: number;
  size_vram: number;
  details?: { format?: string; family?: string; parameter_size?: string; quantization_level?: string };
}

/* Real agent-run telemetry from /api/agui/runs (SQLite-backed). Drives the
   "Requests · today" + "Failed jobs" stats with genuine counts. */
interface RunRow {
  started_at: string;
  status: "running" | "finished" | "error";
}

const TOGGLES = [
  { b: "Auto-unload idle models", small: "after 15m, keep 1 warm", checked: true, disabled: false },
  { b: "Stream tokens", small: "SSE to the deck", checked: true, disabled: false },
  { b: "Route to cloud on OOM", small: "OpenRouter fallback", checked: false, disabled: false },
  { b: "Publish renders to library", small: "vector-indexed", checked: false, disabled: true },
];

export default function DashboardV2Page() {
  const [stats, setStats] = useState<Stat[]>(STATS_FALLBACK);
  const [surfaces, setSurfaces] = useState<Surface[]>(SURFACES_FALLBACK);
  const [feed, setFeed] = useState<Feed[]>(FEED_FALLBACK);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);
  // Per-region readiness — until a region's fetch settles we show skeletons
  // instead of a flash of placeholder data.
  const [statsReady, setStatsReady] = useState(false);
  const [surfacesReady, setSurfacesReady] = useState(false);
  const [feedReady, setFeedReady] = useState(false);

  useEffect(() => {
    let alive = true;

    // VRAM stat — real GPU memory from /api/system/stats (degrades if no GPU).
    const sysP = fetch("/api/system/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const g = d?.gpu;
        if (!g || !alive) return;
        const usedG = (g.memoryUsed / 1024).toFixed(1);
        const totalG = Math.round(g.memoryTotal / 1024);
        const pct = g.memoryPercent;
        setStats((prev) => {
          const next = [...prev];
          next[1] = { label: "VRAM used", value: `${usedG}G`, delta: `▲ ${pct}% of ${totalG}G`, cls: pct >= 70 ? "warn" : "" };
          return next;
        });
      })
      .catch(() => {});

    // Loaded models — /api/ollama/ps drives the "Models loaded" stat + surfaces.
    const psP = fetch("/api/ollama/ps")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const models: LoadedModel[] = Array.isArray(d?.models) ? d.models : [];
        if (!alive) return;
        setLoadedCount(models.length);
        setStats((prev) => {
          const next = [...prev];
          next[0] = { label: "Models loaded", value: String(models.length), delta: models.length ? "warm in VRAM" : "none resident", cls: "" };
          return next;
        });
        if (models.length) {
          setSurfaces(
            models.slice(0, 3).map((m) => ({
              kicker: `${m.details?.parameter_size ?? "llm"} · ${m.details?.family ?? "llm"}`,
              h3: m.name,
              p: `Resident on the GPU — ${gb(m.size_vram)} of VRAM${m.details?.quantization_level ? `, ${m.details.quantization_level}` : ""}.`,
              stamps: ["local", m.details?.format ?? "gguf"],
              meta: `~${gb(m.size)} on disk`,
              tag: "serving",
              tone: "positive",
            }))
          );
        }
      })
      .catch(() => {});

    // Requests + failures — real agent-run ledger from /api/agui/runs. Counts
    // runs started today and how many ended in error. Keeps the "sample"
    // placeholders if the ledger is empty or unreachable.
    const runsP = fetch("/api/agui/runs?limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const runs: RunRow[] = Array.isArray(d?.runs) ? d.runs : [];
        if (!runs.length || !alive) return;
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const cutoff = startOfDay.getTime();
        const today = runs.filter((r) => new Date(r.started_at).getTime() >= cutoff);
        const failed = today.filter((r) => r.status === "error").length;
        const rate = today.length ? (failed / today.length) * 100 : 0;
        setStats((prev) => {
          const next = [...prev];
          next[2] = { label: "Requests · today", value: today.length.toLocaleString(), delta: "agent runs", cls: today.length ? "up" : "" };
          next[3] = { label: "Failed jobs", value: String(failed), delta: today.length ? `${rate.toFixed(rate < 10 ? 1 : 0)}% of today` : "none today", cls: failed ? "warn" : "" };
          return next;
        });
      })
      .catch(() => {});

    // Recent activity — real chat threads from /api/threads.
    const threadsP = fetch("/api/threads")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const threads: Array<{ title?: string; created_at?: string; updated_at?: string }> = Array.isArray(d?.threads) ? d.threads : [];
        if (!threads.length || !alive) return;
        setFeed(
          threads.slice(0, 3).map((t) => ({
            icon: "file",
            b: t.title?.trim() || "New conversation",
            small: `edited ${rel(t.updated_at || t.created_at)} · jethro`,
            tag: <span className="tag">chat</span>,
          }))
        );
      })
      .catch(() => {});

    // Reveal each region once its source(s) settle (resolved or caught).
    Promise.all([sysP, psP, runsP]).then(() => { if (alive) setStatsReady(true); });
    psP.then(() => { if (alive) setSurfacesReady(true); });
    threadsP.then(() => { if (alive) setFeedReady(true); });

    return () => { alive = false; };
  }, []);

  const modelCount = loadedCount ?? 4;

  return (
    <div className="av2-dash">
      <div className="app">
        <aside className="side">
          <div className="wordmark"><span className="dot" />ATLAS</div>
          <nav className="nav">
            <a className="nitem active"><Ico name="grid" size={14} />overview</a>
            <a className="nitem"><Ico name="cpu" size={14} />models <span className="count">{modelCount}</span></a>
            <a className="nitem"><Ico name="activity" size={14} />jobs <span className="count">2</span></a>
            <a className="nitem"><Ico name="database" size={14} />library</a>
            <a className="nitem"><Ico name="sliders" size={14} />settings</a>
          </nav>
          <div className="side-foot">
            <label className="ctl">
              <input type="checkbox" defaultChecked />
              <span className="ctl__track" />
              <span className="lbl">focus_mode</span>
            </label>
          </div>
        </aside>

        <main className="main">
          <div className="top">
            <div>
              <h1>Good evening, Jethro</h1>
              <div className="sub">sat jul 05 · {modelCount} models in motion · 46.62.210.42</div>
            </div>
            <div className="spacer" />
            <div className="field searchbox">
              <input className="field__input" placeholder="search models, jobs…" aria-label="Search" />
            </div>
            <button className="btn">filter</button>
            <button className="btn btn--primary">deploy_model</button>
          </div>

          <section>
            <div className="grid4">
              {statsReady
                ? stats.map((s) => (
                    <div key={s.label} className="card card--click stat" tabIndex={0}>
                      <div className="label">{s.label}</div>
                      <div className="value">{s.value}</div>
                      <span className={"delta " + s.cls}>{s.delta}</span>
                    </div>
                  ))
                : [0, 1, 2, 3].map((i) => (
                    <div key={i} className="card stat stat--skel" aria-hidden>
                      <span className="skel is-shimmer skel--line" style={{ width: "52%" }} />
                      <span className="skel is-shimmer skel--value" style={{ width: "64%" }} />
                      <span className="skel is-shimmer skel--line" style={{ width: "40%" }} />
                    </div>
                  ))}
            </div>
          </section>

          <section>
            <div className="sec-head"><h2>Surfaces in motion</h2><a>view all →</a></div>
            <div className="grid3">
              {surfacesReady
                ? surfaces.map((c) => (
                    <div key={c.h3} className="card card--click pcard" tabIndex={0}>
                      <span className="kicker">{c.kicker}</span>
                      <h3>{c.h3}</h3>
                      <p>{c.p}</p>
                      <div className="stamps">
                        {c.stamps.map((s) => <span key={s} className="tag">{s}</span>)}
                      </div>
                      <div className="cfoot">
                        <span className="meta">{c.meta}</span>
                        <span className={"tag tag--status tag--" + c.tone}>{c.tag}</span>
                      </div>
                    </div>
                  ))
                : [0, 1, 2].map((i) => (
                    <div key={i} className="card pcard pcard--skel" aria-hidden>
                      <span className="skel is-shimmer skel--line" style={{ width: "42%" }} />
                      <span className="skel is-shimmer skel--title" style={{ width: "72%" }} />
                      <span className="skel is-shimmer skel--line" style={{ width: "100%" }} />
                      <span className="skel is-shimmer skel--line" style={{ width: "84%" }} />
                      <div className="stamps">
                        <span className="skel is-shimmer skel--tag" />
                        <span className="skel is-shimmer skel--tag" />
                      </div>
                      <div className="cfoot">
                        <span className="skel is-shimmer skel--line" style={{ width: "34%", marginRight: "auto" }} />
                        <span className="skel is-shimmer skel--tag" style={{ width: 60 }} />
                      </div>
                    </div>
                  ))}
            </div>
          </section>

          <section className="cols">
            <div>
              <div className="sec-head"><h2>Recent activity</h2><a>everything →</a></div>
              <div className="feed">
                {feedReady
                  ? feed.map((f) => (
                      <div key={f.b} className="card card--click frow" tabIndex={0}>
                        <span className="fico"><Ico name={f.icon} /></span>
                        <span className="ft"><b>{f.b}</b><small>{f.small}</small></span>
                        {f.tag}
                        <span className="chev"><Ico name="chevron-right" /></span>
                      </div>
                    ))
                  : [0, 1, 2].map((i) => (
                      <div key={i} className="card frow frow--skel" aria-hidden>
                        <span className="skel is-shimmer skel--favatar" />
                        <span className="ft">
                          <span className="skel is-shimmer skel--line" style={{ width: "58%" }} />
                          <span className="skel is-shimmer skel--line" style={{ width: "36%" }} />
                        </span>
                      </div>
                    ))}
                <div className="card card--well empty">
                  <Ico name="bell" size={26} stroke={1.5} />
                  <b>nothing older today</b>
                  <span>yesterday&apos;s activity is in the archive</span>
                  <button className="btn btn--sm">open_archive</button>
                </div>
              </div>
            </div>

            <div>
              <div className="sec-head"><h2>Inference defaults</h2></div>
              <div className="card panel">
                <h3>Fleet policy</h3>
                <p>Applies to every new load + request.</p>
                {TOGGLES.map((t) => (
                  <div key={t.b} className="srow">
                    <span className="st"><b>{t.b}</b><small>{t.small}</small></span>
                    <label className="ctl">
                      <input type="checkbox" defaultChecked={t.checked} disabled={t.disabled} />
                      <span className="ctl__track" />
                    </label>
                  </div>
                ))}
                <div className="card card--well codewell"><code>qwen3 · ctx 8192 · gpu_layers 99 · -14 LUFS n/a</code></div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
