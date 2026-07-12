"use client";

/* =============================================================================
   ATLAS VISUAL 2 — VISUAL. The image surface at /v2/visual.
   -----------------------------------------------------------------------------
   Five view-tabs, all on real data:

     GENERATE · EDIT · UPSCALE  — chat-style composers. Each drives the real
       image tools through POST /api/tools/bridge (generate_image / edit_image /
       upscale_image), reads live model availability from /api/comfy/models,
       uploads sources through /api/upload, and reads the gallery from
       /api/image/recent. Edit/Upscale stage their source by clicking a plate in
       the gallery below (or the paperclip to attach a local file).

     WORKFLOWS — the saved-workflow library (SQLite-backed /api/comfy/workflows)
       plus recent ComfyUI jobs (/api/comfy/history), lifted as-is.

     COMFYUI — the live ComfyUI iframe embed.

   Everything is scoped under `.av2-visual`. The masthead carries one status tag
   (online + free VRAM from /api/comfy/free); no hero, no banner.
   ============================================================================= */

import { useCallback, useEffect, useRef, useState } from "react";
import "./visual-v2.css";

import { GenerateTab } from "./image/GenerateTab";
import { EditTab } from "./image/EditTab";
import { UpscaleTab } from "./image/UpscaleTab";
import { ComfyStartProvider, StartComfyButton, useComfyStart } from "./image/recovery";

/* ── types ──────────────────────────────────────────────────────────────── */
interface ComfyStatus {
  online: boolean;
  vramFreeMb: number | null;
  vramTotalMb: number | null;
}

/* saved workflow record (subset of ComfyWorkflowRecord from lib/comfy/workflows) */
interface WorkflowRow {
  id: string;
  slug: string;
  name: string;
  description?: string;
  format: "ui_graph" | "api_prompt";
  tags: string[];
  lane: "image" | "audio" | "3d" | "video";
  estimateMb: number;
  updatedAt: string;
}

/* ComfyUI history job (subset of /api/comfy/history item) */
interface JobItem {
  promptId: string;
  prompt?: [number, string, ...unknown[]];
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
  status?: { status_str?: string; completed?: boolean };
}

type View = "generate" | "edit" | "upscale" | "workflows" | "comfy";

const TABS: { id: View; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "edit", label: "Edit" },
  { id: "upscale", label: "Upscale" },
  { id: "workflows", label: "Workflows" },
  { id: "comfy", label: "ComfyUI" },
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

/* first output image of a history job → the /api/comfy/view proxy url */
function jobThumb(job: JobItem): string | null {
  const outputs = job.outputs ?? {};
  for (const node of Object.values(outputs)) {
    const img = node.images?.find((im) => im.type === "output") ?? node.images?.[0];
    if (img) {
      const p = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
      return `/api/comfy/view?${p.toString()}`;
    }
  }
  return null;
}

/* ── tiny inline icons (Atlas 24-grid stroke dialect) ─────────────────────── */
const IcRefresh = <svg viewBox="0 0 24 24" className="gl"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>;
const IcPlay = <svg viewBox="0 0 24 24" className="gl"><path d="M7 4l13 8-13 8z" /></svg>;
const IcTrash = <svg viewBox="0 0 24 24" className="gl"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>;
const IcImport = <svg viewBox="0 0 24 24" className="gl"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>;

type Toast = { id: number; kind: "ok" | "err"; text: string };

export default function VisualV2Page() {
  return (
    <ComfyStartProvider>
      <VisualV2Body />
    </ComfyStartProvider>
  );
}

function VisualV2Body() {
  const [view, setView] = useState<View>("generate");

  const [comfy, setComfy] = useState<ComfyStatus>({ online: false, vramFreeMb: null, vramTotalMb: null });
  const { startError } = useComfyStart();

  /* ---- workflow library + recent jobs (Workflows tab) ---- */
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((kind: "ok" | "err", text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  /* ---- comfy status (real, polled) — feeds the hero chip ---- */
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

  /* ---- when the shared start flow reports the rig up, re-read /free at once ---- */
  useEffect(() => {
    const onOnline = () => void loadComfy();
    window.addEventListener("comfy:online", onOnline);
    return () => window.removeEventListener("comfy:online", onOnline);
  }, [loadComfy]);

  /* ---- workflow library (real, SQLite-backed) ---- */
  const loadWorkflows = useCallback(async () => {
    setWfLoading(true);
    setWfError(null);
    try {
      const r = await fetch("/api/comfy/workflows?limit=100", { cache: "no-store" });
      if (!r.ok) throw new Error(`workflows ${r.status}`);
      const d = (await r.json()) as { workflows: WorkflowRow[] };
      setWorkflows(Array.isArray(d.workflows) ? d.workflows : []);
    } catch (e) {
      setWfError(e instanceof Error ? e.message : "failed to load workflows");
      setWorkflows([]);
    } finally {
      setWfLoading(false);
    }
  }, []);

  /* ---- recent ComfyUI jobs (real, from /history) ---- */
  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const r = await fetch("/api/comfy/history?limit=20", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { items?: JobItem[]; error?: string };
      if (!r.ok) throw new Error(d.error || `history ${r.status}`);
      setJobs(Array.isArray(d.items) ? d.items : []);
    } catch (e) {
      setJobsError(e instanceof Error ? e.message : "ComfyUI unreachable");
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  /* load library + jobs when the Workflows tab opens */
  useEffect(() => {
    if (view !== "workflows") return;
    void loadWorkflows();
    void loadJobs();
  }, [view, loadWorkflows, loadJobs]);

  /* ---- run a saved workflow ---- */
  const runWorkflow = useCallback(async (wf: WorkflowRow) => {
    if (runningId) return;
    setRunningId(wf.id);
    try {
      const r = await fetch(`/api/comfy/workflows/${wf.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = (await r.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!r.ok) throw new Error(d.error || `run ${r.status}`);
      pushToast("ok", `ran · ${wf.name} · ${d.status ?? "queued"}`);
      setTimeout(() => void loadJobs(), 1500);
    } catch (e) {
      pushToast("err", `run failed — ${e instanceof Error ? e.message : "unreachable"}`);
    } finally {
      setRunningId(null);
    }
  }, [runningId, pushToast, loadJobs]);

  /* ---- delete a saved workflow ---- */
  const deleteWorkflow = useCallback(async (wf: WorkflowRow) => {
    try {
      const r = await fetch(`/api/comfy/workflows/${wf.id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || `delete ${r.status}`);
      }
      setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
      pushToast("ok", `deleted · ${wf.name}`);
    } catch (e) {
      pushToast("err", `delete failed — ${e instanceof Error ? e.message : "error"}`);
    }
  }, [pushToast]);

  /* ---- import a workflow JSON from disk ---- */
  const importWorkflow = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const raw = await file.text();
      let json: unknown;
      try { json = JSON.parse(raw); }
      catch { throw new Error("not valid JSON"); }
      const name = file.name.replace(/\.json$/i, "").trim() || "imported workflow";
      const r = await fetch("/api/comfy/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, workflowJson: json }),
      });
      const d = (await r.json().catch(() => ({}))) as { workflow?: WorkflowRow; error?: string };
      if (!r.ok) throw new Error(d.error || `import ${r.status}`);
      pushToast("ok", `imported · ${name}`);
      void loadWorkflows();
    } catch (e) {
      pushToast("err", `import failed — ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setImporting(false);
    }
  }, [pushToast, loadWorkflows]);

  const vramLabel =
    comfy.vramFreeMb != null && comfy.vramTotalMb != null
      ? `${(comfy.vramFreeMb / 1024).toFixed(1)} GB free`
      : "—";

  return (
      <div className="av2-visual">
        <div className="wrap">
          {/* ── masthead — the view-tabs row + one status tag ────────────── */}
          <div className="masthead">
            <div className="view-tabs" role="tablist" aria-label="View">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={view === t.id}
                  className={`vtab${view === t.id ? " is-active" : ""}`}
                  onClick={() => setView(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className={`tag--status tag--${comfy.online ? "positive" : "caution"}`}>
              {comfy.online ? `comfy · ${vramLabel}` : "comfy offline"}
            </span>
          </div>
          {!comfy.online ? (
            <p className="rig-hint comfy-start">
              comfy offline ·
              <StartComfyButton />
            </p>
          ) : null}
          {startError ? <p className="rig-hint rig-hint--danger">{startError}</p> : null}

          {/* ── panels ───────────────────────────────────────────────────── */}
          <div className="tabpanel" style={{ display: view === "generate" ? "block" : "none" }}>
            <GenerateTab />
          </div>
          <div className="tabpanel" style={{ display: view === "edit" ? "block" : "none" }}>
            <EditTab />
          </div>
          <div className="tabpanel" style={{ display: view === "upscale" ? "block" : "none" }}>
            <UpscaleTab />
          </div>

          {view === "workflows" ? (
            <section className="wf">
              {/* library toolbar */}
              <div className="toolbar">
                <div className="toolbar-lede">
                  <span className="kicker">Workflow library</span>
                  <span className="count">{wfLoading ? "loading…" : `${workflows.length} saved`}</span>
                </div>
                <div className="toolbar-ctls">
                  <button className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={importing}>
                    <span className="ic">{IcImport}</span>{importing ? "importing…" : "Import JSON"}
                  </button>
                  <input
                    ref={fileRef} type="file" accept="application/json,.json" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void importWorkflow(f); e.target.value = ""; }}
                  />
                  <button className="btn btn--icon" onClick={() => void loadWorkflows()} title="refresh library">
                    <span className="ic">{IcRefresh}</span>
                  </button>
                </div>
              </div>

              {wfError ? (
                <div className="err-chip">library error — {wfError}</div>
              ) : wfLoading ? (
                <div className="empty">Loading workflows…</div>
              ) : workflows.length === 0 ? (
                <div className="empty">No saved workflows. Import an API-prompt or UI-graph JSON to begin.</div>
              ) : (
                <ul className="wf-list">
                  {workflows.map((wf) => {
                    const runnable = wf.format === "api_prompt";
                    return (
                      <li className="wf-row card" key={wf.id}>
                        <div className="wf-main">
                          <div className="wf-head">
                            <span className="wf-name">{wf.name}</span>
                            <span className="tag tag--accent">{wf.lane}</span>
                            <span className="tag">{wf.format === "api_prompt" ? "api" : "ui graph"}</span>
                            <span className="tag">{(wf.estimateMb / 1024).toFixed(1)} GB</span>
                          </div>
                          {wf.tags.length > 0 && (
                            <div className="wf-tags">
                              {wf.tags.map((t) => <span key={t} className="wf-tag">#{t}</span>)}
                            </div>
                          )}
                          <span className="wf-slug">{wf.slug} · updated {relTime(wf.updatedAt)}</span>
                        </div>
                        <div className="wf-acts">
                          <button
                            className="btn btn--primary btn--sm"
                            onClick={() => void runWorkflow(wf)}
                            disabled={!runnable || runningId === wf.id}
                            title={runnable ? "queue this workflow" : "only api-prompt workflows are runnable"}
                          >
                            <span className="ic">{IcPlay}</span>{runningId === wf.id ? "running…" : "Run"}
                          </button>
                          <button className="btn btn--danger btn--sm btn--icon" onClick={() => void deleteWorkflow(wf)} title="delete workflow">
                            <span className="ic">{IcTrash}</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* recent jobs */}
              <div className="toolbar wf-jobs-bar">
                <div className="toolbar-lede">
                  <span className="kicker">Recent jobs</span>
                  <span className="count">{jobsLoading ? "loading…" : `${jobs.length} in history`}</span>
                </div>
                <button className="btn btn--icon" onClick={() => void loadJobs()} title="refresh jobs">
                  <span className="ic">{IcRefresh}</span>
                </button>
              </div>

              {jobsError ? (
                <div className="err-chip">jobs error — {jobsError}</div>
              ) : jobsLoading ? (
                <div className="empty">Loading jobs…</div>
              ) : jobs.length === 0 ? (
                <div className="empty">No jobs in ComfyUI history yet.</div>
              ) : (
                <div className="jobs">
                  {jobs.map((job) => {
                    const thumb = jobThumb(job);
                    const done = job.status?.completed;
                    return (
                      <figure className="job" key={job.promptId}>
                        <div className="img-plate job-shot">
                          {thumb ? (
                            <img src={thumb} alt={job.promptId} loading="lazy" />
                          ) : (
                            <span className="ph" style={{ aspectRatio: "1 / 1" }} />
                          )}
                        </div>
                        <figcaption className="meta">
                          <span className={`job-dot job-dot--${done ? "ok" : "wait"}`} />
                          <span className="meta-id">{job.promptId.slice(0, 8)}</span>
                          <span className="meta-dot">·</span>
                          <span>{job.status?.status_str ?? (done ? "done" : "pending")}</span>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

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
                <div className="comfy-embed__off">
                  <p>ComfyUI is offline.</p>
                  <StartComfyButton />
                  {startError ? <p className="rig-hint rig-hint--danger">{startError}</p> : null}
                </div>
              )}
            </section>
          ) : null}
        </div>

        {/* ── toasts ─────────────────────────────────────────────────────── */}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.kind}`}>{t.text}</div>
          ))}
        </div>
      </div>
  );
}
