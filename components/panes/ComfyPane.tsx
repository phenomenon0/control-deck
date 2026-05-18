"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Clipboard,
  Database,
  ExternalLink,
  Play,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

import { publishChatPrefill } from "@/lib/messages/chatPrefill";
import type { LedgerSnapshot } from "@/lib/resource/types";

const COMFY_STUDIO_URL = process.env.NEXT_PUBLIC_COMFY_URL ?? "http://localhost:8188";

type WorkflowFormat = "ui_graph" | "api_prompt";
type WorkflowLane = "image" | "audio" | "3d" | "video";

interface WorkflowRecord {
  id: string;
  slug: string;
  name: string;
  description?: string;
  format: WorkflowFormat;
  workflowJson: unknown;
  tags: string[];
  lane: WorkflowLane;
  estimateMb: number;
  createdAt: string;
  updatedAt: string;
}

interface ComfyJob {
  promptId: string;
  status?: { status_str: string; completed: boolean };
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
}

interface DraftState {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  tags: string;
  lane: WorkflowLane;
  estimateMb: number;
  format: WorkflowFormat | "auto";
}

export interface ComfyPaneHandle {
  reloadStudio: () => void;
  getStudioUrl: () => string;
}

const emptyDraft: DraftState = {
  id: null,
  name: "",
  slug: "",
  description: "",
  tags: "",
  lane: "image",
  estimateMb: 8000,
  format: "auto",
};

export const ComfyPane = forwardRef<ComfyPaneHandle>(function ComfyPane(_props, ref) {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [jobs, setJobs] = useState<ComfyJob[]>([]);
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const [healthy, setHealthy] = useState<"online" | "offline" | "checking">("checking");
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [jsonText, setJsonText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const webviewHostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLElement | null>(null);

  const isElectron = typeof window !== "undefined" && Boolean(window.deck?.electronVersion);
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === draft.id) ?? null,
    [draft.id, workflows],
  );

  const reloadStudio = useCallback(() => {
    const view = viewRef.current as unknown as { reload?: () => void; src?: string } | null;
    if (view?.reload) view.reload();
    else if (view?.src) view.src = COMFY_STUDIO_URL;
  }, []);

  useImperativeHandle(ref, () => ({
    reloadStudio,
    getStudioUrl: () => COMFY_STUDIO_URL,
  }), [reloadStudio]);

  const fetchWorkflows = useCallback(async () => {
    const res = await fetch("/api/comfy/workflows", { cache: "no-store" });
    const data = await res.json();
    setWorkflows(data.workflows ?? []);
  }, []);

  const fetchHistory = useCallback(async () => {
    const res = await fetch("/api/comfy/history?limit=20", { cache: "no-store" });
    const data = await res.json();
    setJobs(data.items ?? []);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const [healthRes, ledgerRes] = await Promise.all([
        fetch("/api/comfy/free", { cache: "no-store" }),
        fetch("/api/resource/ledger", { cache: "no-store" }),
      ]);
      const health = await healthRes.json().catch(() => null) as { comfyui?: string } | null;
      setHealthy(health?.comfyui === "online" ? "online" : "offline");
      if (ledgerRes.ok) setLedger((await ledgerRes.json()) as LedgerSnapshot);
    } catch {
      setHealthy("offline");
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchWorkflows(), fetchHistory(), fetchStatus()]);
    } finally {
      setLoading(false);
    }
  }, [fetchHistory, fetchStatus, fetchWorkflows]);

  useEffect(() => {
    void refreshAll();
    const interval = setInterval(() => {
      void Promise.all([fetchHistory(), fetchStatus()]);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchHistory, fetchStatus, refreshAll]);

  useEffect(() => {
    if (!isElectron) return;
    const host = webviewHostRef.current;
    if (!host || viewRef.current) return;
    const view = document.createElement("webview") as HTMLElement & {
      src: string;
      setAttribute(name: string, value: string): void;
    };
    view.src = COMFY_STUDIO_URL;
    view.setAttribute("style", "width:100%;height:100%;border:0;background:#111;");
    view.setAttribute("allowpopups", "true");
    host.appendChild(view);
    viewRef.current = view;
    return () => {
      if (host.contains(view)) host.removeChild(view);
      viewRef.current = null;
    };
  }, [isElectron]);

  const selectWorkflow = (workflow: WorkflowRecord) => {
    setDraft({
      id: workflow.id,
      name: workflow.name,
      slug: workflow.slug,
      description: workflow.description ?? "",
      tags: workflow.tags.join(", "),
      lane: workflow.lane,
      estimateMb: workflow.estimateMb,
      format: workflow.format,
    });
    setJsonText(JSON.stringify(workflow.workflowJson, null, 2));
    setNotice(null);
  };

  const resetDraft = () => {
    setDraft(emptyDraft);
    setJsonText("");
    setNotice(null);
  };

  const saveWorkflow = async () => {
    let workflowJson: unknown;
    try {
      workflowJson = JSON.parse(jsonText);
    } catch {
      setNotice("Workflow JSON is not valid.");
      return;
    }
    if (!draft.name.trim()) {
      setNotice("Workflow name is required.");
      return;
    }
    setBusy("save");
    try {
      const payload = {
        name: draft.name,
        slug: draft.slug || undefined,
        description: draft.description || undefined,
        tags: splitTags(draft.tags),
        lane: draft.lane,
        estimateMb: draft.estimateMb,
        format: draft.format === "auto" ? undefined : draft.format,
        workflowJson,
      };
      const res = await fetch(draft.id ? `/api/comfy/workflows/${draft.id}` : "/api/comfy/workflows", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      setNotice(`Saved @workflow/${data.workflow.slug}.`);
      await fetchWorkflows();
      selectWorkflow(data.workflow);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  };

  const deleteWorkflow = async () => {
    if (!selectedWorkflow) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/comfy/workflows/${selectedWorkflow.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? "delete failed");
      }
      setNotice(`Deleted @workflow/${selectedWorkflow.slug}.`);
      resetDraft();
      await fetchWorkflows();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy(null);
    }
  };

  const runWorkflow = async (workflow: WorkflowRecord) => {
    setBusy(`run:${workflow.id}`);
    try {
      const res = await fetch(`/api/comfy/workflows/${workflow.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "run failed");
      setNotice(data.status === "queued" ? `Queued @workflow/${workflow.slug}.` : `Ran @workflow/${workflow.slug}.`);
      await fetchHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Run failed.");
    } finally {
      setBusy(null);
    }
  };

  const insertWorkflowReference = (workflow: WorkflowRecord) => {
    publishChatPrefill({
      source: "comfy-studio",
      title: workflow.name,
      text: `@workflow/${workflow.slug}`,
    });
    setNotice(`Inserted @workflow/${workflow.slug} into chat.`);
  };

  const captureFromStudio = async () => {
    const view = viewRef.current as unknown as {
      executeJavaScript?: (script: string) => Promise<unknown>;
    } | null;
    if (!view?.executeJavaScript) {
      setNotice("Capture needs the Electron webview. Use export/paste JSON in browser mode.");
      return;
    }
    setBusy("capture");
    try {
      const graph = await view.executeJavaScript(`
        (() => {
          const app = globalThis.app;
          const graph = app && app.graph;
          if (graph && typeof graph.serialize === "function") return graph.serialize();
          return null;
        })()
      `);
      if (!graph || typeof graph !== "object") throw new Error("ComfyUI graph was not available.");
      setJsonText(JSON.stringify(graph, null, 2));
      if (!draft.name) {
        setDraft((prev) => ({ ...prev, name: `Captured ${new Date().toLocaleTimeString()}`, format: "ui_graph" }));
      }
      setNotice("Captured current ComfyUI graph.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Capture failed.");
    } finally {
      setBusy(null);
    }
  };

  const readFile = async (file: File) => {
    const text = await file.text();
    setJsonText(text);
    setDraft((prev) => ({ ...prev, name: prev.name || file.name.replace(/\.json$/i, "") }));
  };

  const freeAfterReserve = ledger ? Math.max(0, ledger.freeMb - ledger.reserveMb) : 0;

  return (
    <div style={shell}>
      <section style={studio}>
        <header style={studioTopbar}>
          <div>
            <div style={eyebrow}>ComfyUI Studio</div>
            <strong style={title}>Live workflow surface</strong>
          </div>
          <div style={topActions}>
            <StatusPill status={healthy} />
            <IconButton label="Reload Studio" onClick={reloadStudio}><RefreshCcw size={15} /></IconButton>
            <IconButton label="Open ComfyUI" onClick={() => window.open(COMFY_STUDIO_URL, "_blank")}><ExternalLink size={15} /></IconButton>
          </div>
        </header>
        <div style={embedWrap}>
          {isElectron ? (
            <div ref={webviewHostRef} style={{ width: "100%", height: "100%" }} />
          ) : (
            <iframe
              src={COMFY_STUDIO_URL}
              title="ComfyUI"
              style={iframeStyle}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
            />
          )}
        </div>
      </section>

      <aside style={rail}>
        <section style={railHeader}>
          <div>
            <div style={eyebrow}>Workflow Library</div>
            <strong style={title}>{workflows.length} saved</strong>
          </div>
          <IconButton label="Refresh" onClick={refreshAll}><RefreshCcw size={15} /></IconButton>
        </section>

        <section style={metrics}>
          <Metric label="Available" value={fmtMb(freeAfterReserve)} />
          <Metric label="Reserve" value={fmtMb(ledger?.reserveMb ?? 0)} />
          <Metric label="Jobs" value={String(jobs.length)} />
        </section>

        <section style={toolbar}>
          <button type="button" style={buttonPrimary} onClick={saveWorkflow} disabled={busy === "save"}>
            <Save size={15} /> Save
          </button>
          <button type="button" style={button} onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} /> Import
          </button>
          <button type="button" style={button} onClick={captureFromStudio} disabled={busy === "capture"}>
            <Database size={15} /> Capture
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void readFile(file);
            }}
          />
        </section>

        {notice && <div style={noticeStyle}>{notice}</div>}

        <section style={editorPanel}>
          <div style={fieldGrid}>
            <label style={fieldLabel}>
              Name
              <input style={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label style={fieldLabel}>
              Slug
              <input style={input} value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="auto" />
            </label>
            <label style={fieldLabel}>
              Lane
              <select style={input} value={draft.lane} onChange={(e) => setDraft({ ...draft, lane: e.target.value as WorkflowLane })}>
                <option value="image">image</option>
                <option value="audio">audio</option>
                <option value="3d">3d</option>
                <option value="video">video</option>
              </select>
            </label>
            <label style={fieldLabel}>
              Estimate MB
              <input
                style={input}
                type="number"
                min={512}
                max={65536}
                value={draft.estimateMb}
                onChange={(e) => setDraft({ ...draft, estimateMb: Number(e.target.value) })}
              />
            </label>
            <label style={fieldLabel}>
              Format
              <select style={input} value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value as DraftState["format"] })}>
                <option value="auto">auto</option>
                <option value="api_prompt">api prompt</option>
                <option value="ui_graph">ui graph</option>
              </select>
            </label>
            <label style={fieldLabel}>
              Tags
              <input style={input} value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="flux, draft" />
            </label>
          </div>
          <label style={fieldLabel}>
            Description
            <input style={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label style={fieldLabel}>
            Workflow JSON
            <textarea
              style={textarea}
              value={jsonText}
              spellCheck={false}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder="Paste ComfyUI API prompt JSON or UI graph JSON here."
            />
          </label>
          <div style={toolbar}>
            <button type="button" style={button} onClick={resetDraft}>New</button>
            {selectedWorkflow && (
              <button type="button" style={buttonDanger} onClick={deleteWorkflow} disabled={busy === "delete"}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </section>

        <section style={listPanel}>
          <div style={sectionHead}>
            <span>Saved Workflows</span>
            {loading && <span style={muted}>loading</span>}
          </div>
          <div style={workflowList}>
            {workflows.length === 0 ? (
              <p style={empty}>No saved workflows yet.</p>
            ) : (
              workflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  style={workflow.id === draft.id ? workflowRowActive : workflowRow}
                  onClick={() => selectWorkflow(workflow)}
                >
                  <span style={workflowName}>{workflow.name}</span>
                  <span style={workflowMeta}>
                    @{workflow.slug} · {workflow.format === "api_prompt" ? "runnable" : "reference"} · {fmtMb(workflow.estimateMb)}
                  </span>
                  <span style={rowActions}>
                    <MiniAction label="Insert reference" onClick={(e) => { e.stopPropagation(); insertWorkflowReference(workflow); }}>
                      <Clipboard size={13} />
                    </MiniAction>
                    <MiniAction
                      label="Run workflow"
                      disabled={workflow.format !== "api_prompt" || busy === `run:${workflow.id}`}
                      onClick={(e) => { e.stopPropagation(); void runWorkflow(workflow); }}
                    >
                      <Play size={13} />
                    </MiniAction>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section style={listPanel}>
          <div style={sectionHead}>
            <span>Recent Jobs</span>
            <button type="button" style={linkButton} onClick={fetchHistory}>refresh</button>
          </div>
          {jobs.slice(0, 5).map((job) => (
            <div key={job.promptId} style={jobRow}>
              <span style={{ color: job.status?.completed ? "#39d98a" : "#f0b400" }}>●</span>
              <span style={mono}>{job.promptId.slice(0, 10)}</span>
              <span style={muted}>{job.status?.completed ? "done" : job.status?.status_str ?? "pending"}</span>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
});

function splitTags(raw: string): string[] {
  return raw.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function StatusPill({ status }: { status: "online" | "offline" | "checking" }) {
  const color = status === "online" ? "#39d98a" : status === "offline" ? "#ff6b6b" : "#f0b400";
  return <span style={{ ...pill, color, borderColor: color }}>{status}</span>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" style={iconButton} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function MiniAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: (event: React.MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      title={label}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick(event as unknown as React.MouseEvent);
      }}
      style={{ ...miniAction, opacity: disabled ? 0.35 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={metric}>
      <span style={muted}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function fmtMb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return "0 MB";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

const shell: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 390px",
  height: "100%",
  minHeight: 0,
  background: "#080b10",
  color: "#e6edf3",
};
const studio: React.CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 };
const studioTopbar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  background: "#0d1117",
};
const topActions: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const embedWrap: React.CSSProperties = { flex: 1, minHeight: 0, background: "#111" };
const iframeStyle: React.CSSProperties = { width: "100%", height: "100%", border: 0, background: "#111" };
const rail: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  borderLeft: "1px solid rgba(255,255,255,0.08)",
  background: "#0b0f15",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
const railHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const eyebrow: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 0, opacity: 0.55 };
const title: React.CSSProperties = { fontSize: 14 };
const pill: React.CSSProperties = {
  fontSize: 11,
  border: "1px solid",
  borderRadius: 999,
  padding: "3px 8px",
  background: "rgba(255,255,255,0.04)",
};
const iconButton: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "#d8e1ea",
  cursor: "pointer",
};
const metrics: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 };
const metric: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.035)",
  borderRadius: 6,
  padding: 8,
  display: "flex",
  flexDirection: "column",
  gap: 3,
  fontSize: 12,
};
const toolbar: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const buttonBase: React.CSSProperties = {
  minHeight: 34,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 12,
  cursor: "pointer",
};
const button: React.CSSProperties = {
  ...buttonBase,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.045)",
  color: "#d8e1ea",
};
const buttonPrimary: React.CSSProperties = {
  ...buttonBase,
  border: "1px solid rgba(57,217,138,0.45)",
  background: "rgba(57,217,138,0.15)",
  color: "#e6fff2",
};
const buttonDanger: React.CSSProperties = {
  ...buttonBase,
  border: "1px solid rgba(255,107,107,0.45)",
  background: "rgba(255,107,107,0.12)",
  color: "#ffd9d9",
};
const noticeStyle: React.CSSProperties = {
  border: "1px solid rgba(95,179,255,0.25)",
  background: "rgba(95,179,255,0.08)",
  borderRadius: 6,
  padding: 9,
  fontSize: 12,
  color: "#b9dcff",
};
const editorPanel: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 9,
};
const fieldGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 };
const fieldLabel: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 11, opacity: 0.9 };
const input: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 5,
  background: "rgba(255,255,255,0.04)",
  color: "#e6edf3",
  fontSize: 12,
  padding: "7px 8px",
  outline: "none",
};
const textarea: React.CSSProperties = {
  ...input,
  minHeight: 180,
  resize: "vertical",
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  lineHeight: 1.35,
};
const listPanel: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  padding: 10,
};
const sectionHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0,
  opacity: 0.75,
};
const workflowList: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const workflowRow: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  background: "rgba(255,255,255,0.025)",
  color: "#e6edf3",
  padding: 9,
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: 4,
  textAlign: "left",
  cursor: "pointer",
};
const workflowRowActive: React.CSSProperties = {
  ...workflowRow,
  border: "1px solid rgba(95,179,255,0.45)",
  background: "rgba(95,179,255,0.1)",
};
const workflowName: React.CSSProperties = { gridColumn: "1 / 2", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const workflowMeta: React.CSSProperties = { gridColumn: "1 / 2", fontSize: 11, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const rowActions: React.CSSProperties = { gridRow: "1 / 3", gridColumn: "2 / 3", display: "flex", gap: 5, alignItems: "center" };
const miniAction: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 5,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(0,0,0,0.22)",
};
const empty: React.CSSProperties = { margin: 0, fontSize: 12, opacity: 0.55 };
const muted: React.CSSProperties = { fontSize: 11, opacity: 0.55 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 };
const jobRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 };
const linkButton: React.CSSProperties = {
  border: 0,
  background: "transparent",
  color: "#7ab8ff",
  fontSize: 11,
  cursor: "pointer",
};
