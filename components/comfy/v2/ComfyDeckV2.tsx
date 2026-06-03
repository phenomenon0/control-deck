"use client";

/**
 * ComfyDeckV2 — the recomposed v2 Comfy surface, wired live.
 *
 * Composes the v2 leaves (WorkflowLibrary + JobQueue + OutputGallery +
 * StudioStatusBar) around the REAL embedded ComfyUI (iframe in browser /
 * Electron <webview>) as the centerpiece. Owns the deck-native data: workflows,
 * job history, ComfyUI health + VRAM — fetched from /api/comfy/* and
 * /api/resource/ledger, mirroring the legacy ComfyPane but mapped onto the
 * prop-driven v2 leaves.
 *
 * Layout mirrors the chat rail pattern: the flows column (collapsible) sits on
 * the left like chat threads; the ComfyUI surface dominates on the right. The
 * ☰ in the studio header collapses the flows column.
 *
 * Mounted at /deck/comfy-v2 as a side-by-side surface — the legacy
 * /deck/visual (ComfyPane) is untouched. Token-driven, so it renders in the
 * deck's native theme.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { publishChatPrefill } from "@/lib/messages/chatPrefill";
import type { LedgerSnapshot } from "@/lib/resource/types";

import { ComfyStudioFrame, type StudioEmbedState } from "./ComfyStudioFrame";
import { StudioStatusBar, type ComfyHealth } from "./StudioStatusBar";
import { WorkflowLibrary, type WorkflowItem, type WorkflowFormat, type WorkflowLane } from "./WorkflowLibrary";
import { JobQueue, type JobItem, type JobStatus } from "./JobQueue";
import { OutputGallery } from "./OutputGallery";
import type { GenerationOutput } from "./OutputCard";

const STUDIO_URL = process.env.NEXT_PUBLIC_COMFY_URL ?? "http://127.0.0.1:8188";

interface WorkflowRecord {
  id: string;
  slug: string;
  name: string;
  description?: string;
  format: WorkflowFormat;
  lane: WorkflowLane;
  tags?: string[];
  comfyPath?: string;
  estimateMb?: number;
}

interface HistoryItem {
  promptId: string;
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
  status?: { status_str?: string; completed?: boolean };
}

interface StatusVram {
  free?: number;
  total?: number;
  used?: number;
}

function fmtMb(mb?: number): string {
  if (!mb || !Number.isFinite(mb) || mb <= 0) return "0 GB";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function viewUrl(img: { filename: string; subfolder: string; type: string }): string {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
  return `/api/comfy/view?${q.toString()}`;
}

export function ComfyDeckV2() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [health, setHealth] = useState<ComfyHealth>("checking");
  const [vram, setVram] = useState<StatusVram | null>(null);
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [flowsOpen, setFlowsOpen] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const border = { borderColor: "var(--border-subtle)" };

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/comfy/workflows", { cache: "no-store" });
      const data = await res.json();
      setWorkflows(Array.isArray(data.workflows) ? data.workflows : []);
    } catch {
      setWorkflows([]);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/comfy/history?limit=20", { cache: "no-store" });
      const data = await res.json();
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch {
      setHistory([]);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const [healthRes, ledgerRes] = await Promise.all([
        fetch("/api/comfy/status", { cache: "no-store" }),
        fetch("/api/resource/ledger", { cache: "no-store" }),
      ]);
      const status = (await healthRes.json().catch(() => null)) as { comfyui?: string; vram?: StatusVram } | null;
      setHealth(status?.comfyui === "online" ? "online" : "offline");
      setVram(status?.vram ?? null);
      if (ledgerRes.ok) setLedger((await ledgerRes.json()) as LedgerSnapshot);
    } catch {
      setHealth("offline");
    }
  }, []);

  useEffect(() => {
    void fetchWorkflows();
    void fetchStatus();
    void fetchHistory();
    const interval = setInterval(() => {
      void fetchStatus();
      void fetchHistory();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkflows, fetchStatus, fetchHistory]);

  // ── map deck data → leaf props ──
  const workflowItems: WorkflowItem[] = useMemo(
    () =>
      workflows.map((w) => ({
        id: w.id,
        slug: w.slug,
        name: w.name,
        description: w.description,
        format: w.format,
        lane: w.lane,
        tags: w.tags,
        meta: w.comfyPath ?? fmtMb(w.estimateMb),
      })),
    [workflows],
  );

  const jobs: JobItem[] = useMemo(
    () =>
      history.map((h) => {
        const str = h.status?.status_str ?? "";
        const status: JobStatus = h.status?.completed
          ? "done"
          : /error|fail/i.test(str)
            ? "error"
            : str
              ? "running"
              : "queued";
        return {
          id: h.promptId,
          status,
          statusLabel: h.status?.completed ? "done" : str || undefined,
          error: status === "error" ? str || "failed" : undefined,
        };
      }),
    [history],
  );

  const outputs: GenerationOutput[] = useMemo(() => {
    const out: GenerationOutput[] = [];
    for (const h of history) {
      if (!h.outputs) continue;
      for (const node of Object.values(h.outputs)) {
        for (const img of node.images ?? []) {
          if (img.type === "temp") continue;
          out.push({ id: `${h.promptId}:${img.filename}`, status: "done", imageUrl: viewUrl(img) });
        }
      }
    }
    return out;
  }, [history]);

  const vramProp = useMemo(() => {
    const total = vram?.total ?? ledger?.totalMb;
    const used = vram?.used ?? (ledger ? ledger.totalMb - ledger.freeMb : undefined);
    if (!total) return undefined;
    return {
      usedPct: used ? used / total : 0,
      usedLabel: fmtMb(used),
      totalLabel: fmtMb(total),
      availableLabel: ledger ? fmtMb(Math.max(0, ledger.freeMb - ledger.reserveMb)) : fmtMb(vram?.free),
      reserveLabel: ledger ? fmtMb(ledger.reserveMb) : undefined,
    };
  }, [vram, ledger]);

  const embedState: StudioEmbedState = health === "checking" ? "loading" : health === "online" ? "ready" : "offline";

  const runWorkflow = useCallback(
    async (id: string) => {
      const wf = workflows.find((w) => w.id === id);
      if (!wf || wf.format !== "api_prompt") return;
      setRunningId(id);
      try {
        await fetch(`/api/comfy/workflows/${id}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        await fetchHistory();
      } finally {
        setRunningId(null);
      }
    },
    [workflows, fetchHistory],
  );

  const insertReference = useCallback(
    (id: string) => {
      const wf = workflows.find((w) => w.id === id);
      if (!wf) return;
      publishChatPrefill({ source: "comfy-v2", title: wf.name, text: `@workflow/${wf.slug}` });
    },
    [workflows],
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* LEFT: flows column (like chat threads) — collapsible. */}
      {flowsOpen && (
        <aside className="flex w-[280px] shrink-0 flex-col border-r" style={border} aria-label="Deck panel">
          <div className="min-h-0 flex-1 border-b" style={border}>
            <WorkflowLibrary
              title="Flows"
              workflows={workflowItems}
              activeId={activeId}
              runningId={runningId}
              onSelect={setActiveId}
              onRun={runWorkflow}
              onInsertReference={insertReference}
              emptyLabel="No saved workflows yet."
            />
          </div>
          <div className="shrink-0 border-b" style={{ ...border, maxHeight: "28%", overflowY: "auto" }}>
            <JobQueue jobs={jobs} onRetry={runWorkflow} emptyLabel="No recent jobs." />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-3 pt-2">
              <span className="cd-eyebrow text-[var(--text-secondary)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                Outputs
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <OutputGallery
                outputs={outputs}
                columnWidth={120}
                emptyTitle="No outputs yet"
                emptyLabel="Run a flow to fill this."
                onOpen={(id) => window.open(viewUrlFromId(id), "_blank")}
              />
            </div>
          </div>
        </aside>
      )}

      {/* RIGHT: the real ComfyUI surface — dominant, full-bleed. */}
      <div className="flex min-w-0 flex-1">
        <ComfyStudioFrame
          embedState={embedState}
          studioUrl={STUDIO_URL}
          leadingSlot={
            <button
              type="button"
              onClick={() => setFlowsOpen((v) => !v)}
              aria-label="Toggle flows"
              aria-pressed={flowsOpen}
              title="Flows"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: flowsOpen ? "rgb(var(--accent-rgb))" : "var(--text-secondary)" }}
            >
              ☰
            </button>
          }
          statusSlot={<StudioStatusBar health={health} vram={vramProp} metrics={[{ label: "jobs", value: String(jobs.length) }]} />}
          onReload={() => setReloadKey((k) => k + 1)}
          onOpenExternal={() => window.open(STUDIO_URL, "_blank")}
          renderEmbed={({ studioUrl }) => <StudioEmbed studioUrl={studioUrl} reloadKey={reloadKey} />}
        />
      </div>
    </div>
  );
}

/** `${promptId}:${filename}` → the /api/comfy/view URL for opening in a tab. */
function viewUrlFromId(id: string): string {
  const filename = id.slice(id.indexOf(":") + 1);
  return `/api/comfy/view?${new URLSearchParams({ filename, type: "output" }).toString()}`;
}

/**
 * The real embed: an Electron <webview> when available (created imperatively,
 * the same way the legacy ComfyPane does), otherwise a sandboxed <iframe>.
 * Mounted only when the frame is in its "ready" state.
 */
function StudioEmbed({ studioUrl, reloadKey }: { studioUrl: string; reloadKey: number }) {
  const isElectron = typeof window !== "undefined" && Boolean((window as unknown as { deck?: { electronVersion?: string } }).deck?.electronVersion);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isElectron) return;
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const view = document.createElement("webview") as HTMLElement & { src: string };
    view.src = studioUrl;
    view.setAttribute("style", "width:100%;height:100%;border:0;background:var(--bg-inset);");
    view.setAttribute("allowpopups", "true");
    host.appendChild(view);
    return () => {
      if (host.contains(view)) host.removeChild(view);
    };
  }, [isElectron, studioUrl, reloadKey]);

  if (isElectron) return <div ref={hostRef} className="absolute inset-0" />;
  return (
    <iframe
      key={reloadKey}
      src={studioUrl}
      title="ComfyUI"
      className="absolute inset-0 h-full w-full"
      style={{ border: 0, background: "var(--bg-inset)" }}
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
    />
  );
}

export default ComfyDeckV2;
