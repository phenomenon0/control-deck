"use client";

/* =============================================================================
   ATLAS VISUAL 2 — VISUAL. The image / generation surface at /v2/visual.
   -----------------------------------------------------------------------------
   Two halves, both on real data:

     1. GENERATION BAR — a Deep-Well prompt, a model select, a size select and a
        Generate button, with a live ComfyUI status chip (online/offline + free
        VRAM from /api/comfy/free). Generate builds a real ComfyUI graph with the
        repo's own loadWorkflow() and queues it through /api/comfy/prompt.

     2. GALLERY — recent generated images, newest-first, from /v2/visual/recent
        (scans data/artifacts, reads real PNG dimensions + the model from each
        ComfyUI filename prefix). Rendered in one of the three sanctioned Atlas
        media treatments — the matted PLATE, the hairline FRAME, or the accent
        DUOTONE — with a mono meta line (frame id · dims · model · time). A model
        filter narrows the wall.

   Everything is scoped under `.av2-visual`; the wrapper carries data-theme="light"
   (Atlas paper-klein). Falls back to tasteful placeholders only if the feed is
   empty or unreachable.
   ============================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadWorkflow } from "@/lib/tools/workflows";
import "./visual-v2.css";

/* ── types ──────────────────────────────────────────────────────────────── */
interface RecentImage {
  url: string;
  runId: string;
  name: string;
  model: string;
  width: number | null;
  height: number | null;
  seq: number | null;
  bytes: number;
  createdAt: string;
  seed?: number; // present only for images generated in-session
}
interface ComfyStatus {
  online: boolean;
  vramFreeMb: number | null;
  vramTotalMb: number | null;
}

type Treatment = "plate" | "frame" | "duo";

/* ── generation presets (map to lib/tools/workflows presets → filename prefix) ── */
const MODELS: { preset: string; label: string; note: string; sizes: number[]; defaultSize: number }[] = [
  { preset: "sdxl-turbo", label: "SDXL Turbo", note: "1–4 steps · fast", sizes: [512, 768, 1024], defaultSize: 768 },
  { preset: "sdxl-t2i", label: "SDXL", note: "base · 20 steps", sizes: [768, 1024], defaultSize: 1024 },
  { preset: "flux-gguf", label: "FLUX GGUF", note: "12B · Q8", sizes: [768, 1024], defaultSize: 1024 },
  { preset: "flux-nunchaku", label: "FLUX Nunchaku", note: "int4 · light", sizes: [768, 1024], defaultSize: 1024 },
];

/* ── placeholders — only when the real feed is empty/unreachable ──────────── */
const PLACEHOLDERS: RecentImage[] = [
  { url: "", runId: "—", name: "specimen_01", model: "SDXL Turbo", width: 768, height: 768, seq: 1, bytes: 0, createdAt: new Date().toISOString() },
  { url: "", runId: "—", name: "specimen_02", model: "SDXL", width: 1024, height: 1024, seq: 2, bytes: 0, createdAt: new Date().toISOString() },
  { url: "", runId: "—", name: "specimen_03", model: "SDXL Lightning", width: 1024, height: 768, seq: 3, bytes: 0, createdAt: new Date().toISOString() },
];

/* ── formatting ───────────────────────────────────────────────────────────── */
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d`;
  const w = d / 7;
  if (w < 4.5) return `${Math.round(w)}w`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
const dims = (i: RecentImage) => (i.width && i.height ? `${i.width}×${i.height}` : "—");

/* ── tiny inline icons (Atlas 24-grid stroke dialect) ─────────────────────── */
const IcSpark = <svg viewBox="0 0 24 24" className="gl"><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" /><path d="M19 3v3M20.5 4.5h-3" /></svg>;
const IcRefresh = <svg viewBox="0 0 24 24" className="gl"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>;
const IcClose = <svg viewBox="0 0 24 24" className="gl"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const IcPlate = <svg viewBox="0 0 24 24" className="gl"><rect x="4" y="4" width="16" height="16" rx="1.5" /><rect x="8" y="8" width="8" height="8" rx="1" /></svg>;
const IcFrame = <svg viewBox="0 0 24 24" className="gl"><rect x="3" y="3" width="18" height="18" rx="1" /></svg>;
const IcDuo = <svg viewBox="0 0 24 24" className="gl"><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M3 14l5-4 5 4 3-2 5 4" /><circle cx="9" cy="8" r="1.4" /></svg>;

const TREATMENTS: { id: Treatment; label: string; icon: React.ReactNode }[] = [
  { id: "plate", label: "Plate", icon: IcPlate },
  { id: "frame", label: "Frame", icon: IcFrame },
  { id: "duo", label: "Duo", icon: IcDuo },
];

type Toast = { id: number; kind: "ok" | "err"; text: string };

export default function VisualV2Page() {
  const [images, setImages] = useState<RecentImage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  const [comfy, setComfy] = useState<ComfyStatus>({ online: false, vramFreeMb: null, vramTotalMb: null });

  const [prompt, setPrompt] = useState("");
  const [modelPreset, setModelPreset] = useState(MODELS[0].preset);
  const [size, setSize] = useState(MODELS[0].defaultSize);
  const [generating, setGenerating] = useState(false);

  const [treatment, setTreatment] = useState<Treatment>("plate");
  const [filter, setFilter] = useState<string>("all");
  const [lightbox, setLightbox] = useState<RecentImage | null>(null);
  const [view, setView] = useState<"atelier" | "comfy">("atelier");

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((kind: "ok" | "err", text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const model = MODELS.find((m) => m.preset === modelPreset) ?? MODELS[0];

  /* ---- recent images (real) ---- */
  const loadRecent = useCallback(async () => {
    try {
      const r = await fetch("/v2/visual/recent?limit=120", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { images: RecentImage[]; total: number };
      if (d.images.length === 0) {
        setImages(PLACEHOLDERS);
        setUsingFallback(true);
        setTotal(0);
      } else {
        setImages(d.images);
        setUsingFallback(false);
        setTotal(d.total);
      }
    } catch {
      setImages(PLACEHOLDERS);
      setUsingFallback(true);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  /* ---- comfy status (real, polled) ---- */
  const loadComfy = useCallback(async () => {
    try {
      const r = await fetch("/api/comfy/free", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { comfyui?: string; vram?: { free: number; total: number } | null };
      setComfy({
        online: d.comfyui === "online",
        vramFreeMb: d.vram?.free ?? null,
        vramTotalMb: d.vram?.total ?? null,
      });
    } catch {
      setComfy({ online: false, vramFreeMb: null, vramTotalMb: null });
    }
  }, []);
  useEffect(() => {
    void loadComfy();
    const t = setInterval(() => void loadComfy(), 10000);
    return () => clearInterval(t);
  }, [loadComfy]);

  /* keep the size valid when the model changes */
  useEffect(() => {
    if (!model.sizes.includes(size)) setSize(model.defaultSize);
  }, [model, size]);

  /* ---- generate (real queue into ComfyUI) ---- */
  const doGenerate = useCallback(async () => {
    const text = prompt.trim();
    if (!text) { pushToast("err", "write a prompt first"); return; }
    if (generating) return;
    setGenerating(true);
    const seed = Math.floor(Math.random() * 1_000_000_000);
    try {
      const workflow = loadWorkflow(model.preset, { prompt: text, width: size, height: size, seed });
      const r = await fetch("/api/comfy/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow }),
      });
      const d = (await r.json().catch(() => ({}))) as { promptId?: string; error?: string };
      if (!r.ok) throw new Error(d.error || `ComfyUI ${r.status}`);
      pushToast("ok", `queued · ${model.label} · seed ${seed} · ${d.promptId?.slice(0, 8) ?? "sent"}`);
      // The job lands in ComfyUI; re-scan the artifact feed shortly in case it registers.
      setTimeout(() => void loadRecent(), 2500);
    } catch (e) {
      pushToast("err", `generate failed — ${e instanceof Error ? e.message : "ComfyUI unreachable"}`);
    } finally {
      setGenerating(false);
    }
  }, [prompt, generating, model, size, pushToast, loadRecent]);

  const onPromptKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void doGenerate(); }
  };

  /* ---- model filter facets ---- */
  const facets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of images) counts.set(i.model, (counts.get(i.model) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [images]);

  const shown = useMemo(
    () => (filter === "all" ? images : images.filter((i) => i.model === filter)),
    [images, filter],
  );

  const vramLabel =
    comfy.vramFreeMb != null && comfy.vramTotalMb != null
      ? `${(comfy.vramFreeMb / 1024).toFixed(1)} GB free`
      : "—";

  return (
    <div className="av2-visual">
      <div className="wrap">
        {/* ── hero ─────────────────────────────────────────────────────── */}
        <header className="hero">
          <div className="hero-lede">
            <span className="kicker">Image atelier</span>
            <h1>Visual</h1>
            <p>Everything the deck has drawn, newest first — matted on paper. Compose below and queue it to the local diffusion rig.</p>
          </div>
          <div className="hero-side">
            <span className={`status-chip status-chip--${comfy.online ? "ok" : "off"}`}>
              <span className="dot" />
              {comfy.online ? "ComfyUI online" : "ComfyUI offline"}
            </span>
            <span className="status-sub">{comfy.online ? vramLabel : "start the rig to generate"}</span>
          </div>
        </header>

        {/* ── view tabs: Atelier | ComfyUI ─────────────────────────────── */}
        <div className="view-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "atelier"}
            className={`vtab${view === "atelier" ? " is-active" : ""}`}
            onClick={() => setView("atelier")}>Atelier</button>
          <button type="button" role="tab" aria-selected={view === "comfy"}
            className={`vtab${view === "comfy" ? " is-active" : ""}`}
            onClick={() => setView("comfy")}>ComfyUI</button>
        </div>

        {view === "comfy" ? (
          <section className="comfy-embed card">
            <div className="comfy-embed__bar">
              <span className="kicker">ComfyUI · 127.0.0.1:8188</span>
              <span className={`status-chip status-chip--${comfy.online ? "ok" : "off"}`}>
                <span className="dot" />{comfy.online ? "online" : "offline"}
              </span>
              <span className="comfy-embed__spacer" />
              <a className="btn btn--icon" href="http://localhost:8188" target="_blank" rel="noreferrer" title="open ComfyUI in a new window">
                <svg viewBox="0 0 24 24" className="ic"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
              </a>
            </div>
            {comfy.online ? (
              <iframe className="comfy-embed__frame" src="http://localhost:8188" title="ComfyUI" />
            ) : (
              <div className="comfy-embed__off">ComfyUI is offline — start the rig, then reload this tab.</div>
            )}
          </section>
        ) : (
        <>
        {/* ── generation bar ───────────────────────────────────────────── */}
        <section className="composer card">
          <div className="composer-well">
            <span className="kicker">Prompt · Deep Well</span>
            <textarea
              className="well"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onPromptKey}
              placeholder="a brass astrolabe on weathered parchment, warm side light, shallow depth of field…"
              rows={3}
              spellCheck={false}
            />
          </div>
          <div className="composer-controls">
            <label className="ctl">
              <span className="ctl-lbl">Model</span>
              <div className="select">
                <select value={modelPreset} onChange={(e) => setModelPreset(e.target.value)}>
                  {MODELS.map((m) => (
                    <option key={m.preset} value={m.preset}>{m.label}</option>
                  ))}
                </select>
                <svg viewBox="0 0 24 24" className="chev"><path d="M6 9l6 6 6-6" /></svg>
              </div>
              <span className="ctl-note">{model.note}</span>
            </label>

            <label className="ctl">
              <span className="ctl-lbl">Size</span>
              <div className="seg" role="radiogroup" aria-label="Size">
                {model.sizes.map((s) => (
                  <button
                    key={s} type="button" role="radio" aria-checked={s === size}
                    onClick={() => setSize(s)}
                    className={`seg-btn${s === size ? " is-active" : ""}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <span className="ctl-note">square · {size}²</span>
            </label>

            <div className="composer-go">
              <button
                className="btn btn--primary generate"
                onClick={() => void doGenerate()}
                disabled={generating || !prompt.trim()}
              >
                <span className="ic">{IcSpark}</span>
                {generating ? "queuing…" : "Generate"}
              </button>
              <span className="go-hint">⌘⏎ to run</span>
            </div>
          </div>
        </section>

        {/* ── gallery toolbar ──────────────────────────────────────────── */}
        <div className="toolbar">
          <div className="toolbar-lede">
            <span className="kicker">Recent</span>
            <span className="count">{usingFallback ? "no images yet" : `${total} generated`}</span>
          </div>
          <div className="toolbar-ctls">
            <div className="seg treatment" role="tablist" aria-label="Treatment">
              {TREATMENTS.map((t) => (
                <button
                  key={t.id} type="button" role="tab" aria-selected={t.id === treatment}
                  onClick={() => setTreatment(t.id)}
                  className={`seg-btn seg-btn--ic${t.id === treatment ? " is-active" : ""}`}
                  title={`${t.label} treatment`}
                >
                  <span className="ic">{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
            <button className="btn btn--icon" onClick={() => void loadRecent()} title="refresh feed">
              <span className="ic">{IcRefresh}</span>
            </button>
          </div>
        </div>

        {/* model facets */}
        {!usingFallback && facets.length > 1 && (
          <div className="facets">
            <button
              type="button"
              className={`facet${filter === "all" ? " is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All<span className="facet-n">{images.length}</span>
            </button>
            {facets.map(([m, n]) => (
              <button
                key={m} type="button"
                className={`facet${filter === m ? " is-active" : ""}`}
                onClick={() => setFilter(m)}
              >
                {m}<span className="facet-n">{n}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── gallery ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className={`gallery gallery--${treatment}`}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="tile" key={i}><div className="skel" /></div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">No {filter === "all" ? "" : `${filter} `}images.</div>
        ) : (
          <div className={`gallery gallery--${treatment}`}>
            {shown.map((img) => (
              <figure className="tile" key={img.url || img.name}>
                <button
                  type="button"
                  className={`shot img-${treatment}`}
                  onClick={() => img.url && setLightbox(img)}
                  disabled={!img.url}
                  aria-label={`open ${img.name}`}
                >
                  {img.url ? (
                    <img src={img.url} alt={img.name} loading="lazy" />
                  ) : (
                    <span className="ph" style={{ aspectRatio: `${img.width ?? 1} / ${img.height ?? 1}` }} />
                  )}
                </button>
                <figcaption className="meta">
                  <span className="meta-id">{img.seed != null ? `seed ${img.seed}` : `#${img.seq ?? "—"}`}</span>
                  <span className="meta-dot">·</span>
                  <span>{dims(img)}</span>
                  <span className="meta-dot">·</span>
                  <span className="meta-model">{img.model}</span>
                  <span className="meta-dot">·</span>
                  <span className="meta-time">{relTime(img.createdAt)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        </>
        )}
      </div>

      {/* ── lightbox ───────────────────────────────────────────────────── */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="close">
            <span className="ic">{IcClose}</span>
          </button>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="img-plate lightbox-plate">
              <img src={lightbox.url} alt={lightbox.name} />
            </div>
            <div className="lightbox-meta">
              <span className="tag tag--accent">{lightbox.model}</span>
              <span className="tag">{dims(lightbox)}</span>
              {lightbox.seed != null && <span className="tag">seed {lightbox.seed}</span>}
              <span className="tag">{(lightbox.bytes / 1024).toFixed(0)} KB</span>
              <span className="tag">{relTime(lightbox.createdAt)}</span>
              <span className="lightbox-name">{lightbox.name}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── toasts ─────────────────────────────────────────────────────── */}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
