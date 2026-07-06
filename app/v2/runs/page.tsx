"use client";

/* =============================================================================
   ATLAS VISUAL 2 — RUNS. A feed of recent agent runs + a selected-run step
   timeline. Wired to the LIVE run store: GET /api/agui/runs (list + today's
   cost) and POST /api/agui/runs { runId } (per-run AG-UI events → step
   timeline). Shape mirrors the real Run/RunEvent contract
   (components/panes/runs/types.ts → lib/agui/db.ts). Fetches on mount and
   falls back to the realistic mock below on error/empty so it never looks
   broken. Markup is unchanged from the mock version.
   ============================================================================= */

import { useEffect, useMemo, useState } from "react";
import "./runs-v2.css";
import type { Run, RunEvent } from "@/components/panes/runs/types";
import { formatDuration, formatTime } from "@/components/panes/runs/types";
import type { DeckPayload } from "@/lib/agui/payload";

type Status = "running" | "finished" | "error";
type Tone = "positive" | "caution" | "danger";

interface RunV {
  id: string;
  task: string;
  status: Status;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: string; // clock label
  duration: string;
  when: string; // relative
  steps: Step[];
}
interface Step {
  tool: string;
  detail: string;
  status: "complete" | "running" | "error";
  dur: string;
}

const STATUS: Record<Status, { tone: Tone; label: string }> = {
  running: { tone: "caution", label: "running" },
  finished: { tone: "positive", label: "ok" },
  error: { tone: "danger", label: "failed" },
};

const RUNS: RunV[] = [
  {
    id: "run_9f3ac2", task: "Render a 768² sunset skyline and index it", status: "running",
    model: "qwen3-30b-a3b", input_tokens: 4120, output_tokens: 812, cost_usd: 0.0091,
    started_at: "18:42:07", duration: "…", when: "now",
    steps: [
      { tool: "web_search", detail: "reference: golden-hour skyline palettes", status: "complete", dur: "1.2s" },
      { tool: "generate_image", detail: "prompt · 768×768 · seed 41208", status: "complete", dur: "1.4s" },
      { tool: "analyze_image", detail: "verify horizon + colour balance", status: "complete", dur: "0.7s" },
      { tool: "vector_store", detail: "collection=renders · indexing", status: "running", dur: "…" },
    ],
  },
  {
    id: "run_8e7b10", task: "Summarise routing-thresholds.md and store", status: "finished",
    model: "llama3.3-70b", input_tokens: 8930, output_tokens: 1204, cost_usd: 0.0212,
    started_at: "18:31:55", duration: "6.8s", when: "11m ago",
    steps: [
      { tool: "read_file", detail: "docs/routing-thresholds.md", status: "complete", dur: "0.1s" },
      { tool: "vector_search", detail: "prior routing notes · hybrid k=5", status: "complete", dur: "0.4s" },
      { tool: "vector_store", detail: "collection=docs · 3 chunks", status: "complete", dur: "0.3s" },
    ],
  },
  {
    id: "run_7c1d94", task: "Build a live GPU meter on the canvas", status: "finished",
    model: "qwen3-30b-a3b", input_tokens: 2610, output_tokens: 2988, cost_usd: 0.0140,
    started_at: "17:58:12", duration: "4.1s", when: "45m ago",
    steps: [
      { tool: "execute_code", detail: "language=html · canvas mini-app", status: "complete", dur: "2.9s" },
      { tool: "workspace_open_pane", detail: "type=canvas · beside chat", status: "complete", dur: "0.2s" },
    ],
  },
  {
    id: "run_6a0f52", task: "Convert product shot to a 3D GLB", status: "error",
    model: "qwen3-30b-a3b", input_tokens: 1840, output_tokens: 402, cost_usd: 0.0038,
    started_at: "17:20:44", duration: "12.4s", when: "1h ago",
    steps: [
      { tool: "analyze_image", detail: "upload_2f19 · subject on white", status: "complete", dur: "0.6s" },
      { tool: "image_to_3d", detail: "hunyuan3d · draco compression", status: "error", dur: "11.8s" },
    ],
  },
  {
    id: "run_5b9e33", task: "Find semantically similar model cards", status: "finished",
    model: "llama3.3-70b", input_tokens: 5210, output_tokens: 640, cost_usd: 0.0116,
    started_at: "16:47:03", duration: "1.9s", when: "2h ago",
    steps: [
      { tool: "vector_search", detail: "query · hybrid · k=8", status: "complete", dur: "0.5s" },
      { tool: "web_search", detail: "cross-check publisher pages", status: "complete", dur: "1.1s" },
    ],
  },
  {
    id: "run_4d2a08", task: "Draft a sigil for the newsroom masthead", status: "finished",
    model: "qwen3-30b-a3b", input_tokens: 980, output_tokens: 1450, cost_usd: 0.0061,
    started_at: "15:12:39", duration: "0.9s", when: "3h ago",
    steps: [
      { tool: "glyph_motif", detail: "style=sigil · size 256 · seed 7", status: "complete", dur: "0.3s" },
    ],
  },
];

function tokens(n: number) {
  return n.toLocaleString("en-US");
}

/* ── live-data helpers ──────────────────────────────────────────────────────── */

function shortId(id: string): string {
  return id.includes("-") ? id.split("-")[0] : id;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 45) return "now";
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s ago`;
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtMs(ms: number): string {
  const v = Math.max(0, ms);
  return v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

function durBetween(a?: string, b?: string): string {
  if (!a || !b) return "";
  return fmtMs(new Date(b).getTime() - new Date(a).getTime());
}

/** Pull a readable string out of a DeckPayload for a timeline detail line. */
function payloadText(p: DeckPayload | undefined | null): string {
  if (!p) return "";
  if (p.kind === "text") return p.text;
  if (p.kind === "glyph") return `glyph payload · ~${p.approxBytes ?? 0}b`;
  if (p.kind === "binary") return p.mimeType;
  // json
  const d = p.data;
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    // MCP tool-result convention: { content: [{ type, text }] }
    const obj = d as { content?: Array<{ text?: string }> };
    if (Array.isArray(obj.content) && typeof obj.content[0]?.text === "string") {
      return obj.content[0].text;
    }
    try {
      return JSON.stringify(d);
    } catch {
      return "[object]";
    }
  }
  return d == null ? "" : String(d);
}

function preview(p: DeckPayload | undefined | null, max = 140): string {
  return payloadText(p).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Build the step timeline from a run's real AG-UI events. */
function buildSteps(events: RunEvent[], runStatus: Status): Step[] {
  const steps: Step[] = [];
  const idx: Record<string, number> = {}; // toolCallId → step index
  const startTs: Record<number, string> = {}; // step index → tool start ts
  const textBuf: Record<number, string> = {}; // step index → accumulated text
  const textStart: Record<number, string> = {};
  const textEnd: Record<number, string> = {};
  let activeText: number | null = null;
  let errorMsg = "";
  let hasTool = false;

  for (const e of events) {
    switch (e.type) {
      case "RunStarted": {
        const t = preview(e.input as DeckPayload | undefined, 160);
        if (t) steps.push({ tool: "prompt", detail: t, status: "complete", dur: "" });
        break;
      }
      case "TextMessageContent": {
        if (activeText == null) {
          activeText = steps.length;
          steps.push({ tool: "response", detail: "", status: "complete", dur: "" });
          textBuf[activeText] = "";
          textStart[activeText] = e.timestamp;
        }
        textBuf[activeText] += e.delta ?? "";
        textEnd[activeText] = e.timestamp;
        break;
      }
      case "ToolCallStart": {
        activeText = null; // close any open response step
        if (e.toolCallId) {
          idx[e.toolCallId] = steps.length;
          startTs[steps.length] = e.timestamp;
          steps.push({ tool: e.toolName || "tool", detail: "", status: "running", dur: "…" });
          hasTool = true;
        }
        break;
      }
      case "InterruptRequested":
      case "ToolCallArgs": {
        if (e.toolCallId != null && idx[e.toolCallId] != null && e.args) {
          const s = steps[idx[e.toolCallId]];
          if (!s.detail) s.detail = preview(e.args as DeckPayload);
        }
        break;
      }
      case "ToolCallResult": {
        if (e.toolCallId != null && idx[e.toolCallId] != null) {
          const i = idx[e.toolCallId];
          const s = steps[i];
          s.status = e.success === false ? "error" : "complete";
          s.dur = e.durationMs != null ? fmtMs(e.durationMs) : durBetween(startTs[i], e.timestamp);
          if (!s.detail) s.detail = preview(e.result as DeckPayload);
        }
        break;
      }
      case "RunError": {
        errorMsg = e.error?.message ?? "error";
        break;
      }
    }
  }

  // finalize response steps
  for (const key of Object.keys(textBuf)) {
    const i = Number(key);
    steps[i].detail = textBuf[i].replace(/\s+/g, " ").trim().slice(0, 180) || "(streaming…)";
    if (textStart[i] && textEnd[i]) steps[i].dur = durBetween(textStart[i], textEnd[i]);
  }
  // resolve dangling running tool steps against the run's terminal status
  if (runStatus !== "running") {
    for (const s of steps) {
      if (s.status === "running") {
        s.status = runStatus === "error" ? "error" : "complete";
        if (s.dur === "…") s.dur = "";
      }
    }
  }
  // surface a run-level error on chat-only runs (no tool step carries it)
  if (runStatus === "error" && errorMsg && !hasTool) {
    steps.push({ tool: "failed", detail: errorMsg, status: "error", dur: "" });
  }
  return steps;
}

function mapRun(r: Run): RunV {
  const line = (r.preview ?? "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  const task = line ? line.slice(0, 120) : r.status === "running" ? "Working…" : "Untitled run";
  return {
    id: r.id,
    task,
    status: r.status,
    model: r.model || "unknown",
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cost_usd: r.cost_usd ?? 0,
    started_at: formatTime(r.started_at),
    duration: formatDuration(r.started_at, r.ended_at),
    when: relTime(r.started_at),
    steps: [],
  };
}

function fallbackSteps(a: RunV, loading: boolean): Step[] {
  return [
    {
      tool: loading ? "loading" : "run",
      detail: loading ? "fetching events…" : a.task,
      status: a.status === "error" ? "error" : a.status === "running" ? "running" : "complete",
      dur: a.duration === "…" ? "" : a.duration,
    },
  ];
}

export default function RunsV2Page() {
  const [runs, setRuns] = useState<RunV[]>(RUNS);
  const [usingMock, setUsingMock] = useState(true);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [selected, setSelected] = useState<string>(RUNS[0].id);
  const [stepsByRun, setStepsByRun] = useState<Record<string, Step[]>>({});
  const [loadingSteps, setLoadingSteps] = useState(false);

  // Fetch recent runs from the live store on mount; keep the mock on error/empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agui/runs?limit=50");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const live: Run[] = Array.isArray(data.runs) ? data.runs : [];
        if (!cancelled && live.length > 0) {
          const mapped = live.map(mapRun);
          setRuns(mapped);
          setUsingMock(false);
          setSelected(mapped[0].id);
        }
      } catch (err) {
        console.warn("[runs-v2] live fetch failed, using mock:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pull the selected run's real events → step timeline (cached per run).
  useEffect(() => {
    if (usingMock || !selected || stepsByRun[selected]) return;
    let cancelled = false;
    setLoadingSteps(true);
    (async () => {
      try {
        const res = await fetch("/api/agui/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: selected }),
        });
        const data = await res.json();
        const events: RunEvent[] = Array.isArray(data.events) ? data.events : [];
        const runStatus = (runs.find((r) => r.id === selected)?.status ?? "finished") as Status;
        if (!cancelled) setStepsByRun((prev) => ({ ...prev, [selected]: buildSteps(events, runStatus) }));
      } catch (err) {
        console.warn("[runs-v2] events fetch failed:", err);
        if (!cancelled) setStepsByRun((prev) => ({ ...prev, [selected]: [] }));
      } finally {
        if (!cancelled) setLoadingSteps(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [usingMock, selected, stepsByRun, runs]);

  const filtered = useMemo(
    () => (filter === "all" ? runs : runs.filter((r) => r.status === filter)),
    [filter, runs],
  );
  const active = runs.find((r) => r.id === selected) ?? runs[0];

  const counts = {
    all: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    finished: runs.filter((r) => r.status === "finished").length,
    error: runs.filter((r) => r.status === "error").length,
  };

  const cached = stepsByRun[active.id];
  const activeSteps = usingMock
    ? active.steps
    : cached && cached.length
      ? cached
      : fallbackSteps(active, loadingSteps);

  return (
    <div className="av2-runs">
      <header className="top">
        <h1>Runs</h1>
        <span className="count">{runs.length} recent</span>
        <div className="spacer" />
        <nav className="segs" aria-label="Filter by status">
          {(["all", "running", "finished", "error"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={"seg" + (filter === k ? " is-active" : "")}
              onClick={() => setFilter(k)}
            >
              {k === "finished" ? "ok" : k === "error" ? "failed" : k}
              <span className="seg__n">{counts[k]}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="body">
        {/* ── run feed ────────────────────────────────────────────────── */}
        <div className="feed" role="listbox" aria-label="Runs">
          {filtered.map((r) => {
            const s = STATUS[r.status];
            return (
              <button
                key={r.id}
                type="button"
                className={"run" + (r.id === selected ? " is-active" : "")}
                onClick={() => setSelected(r.id)}
                role="option"
                aria-selected={r.id === selected}
              >
                <span className="run__head">
                  <span className="run__id">{shortId(r.id)}</span>
                  <span className={"tag tag--status tag--" + s.tone + (r.status === "running" ? " is-live" : "")}>
                    {s.label}
                  </span>
                  <span className="run__when">{r.when}</span>
                </span>
                <span className="run__task">{r.task}</span>
                <span className="run__stats">
                  <span className="run__model">{r.model}</span>
                  <span className="dotsep">·</span>
                  <span>{r.duration}</span>
                  <span className="dotsep">·</span>
                  <span>{tokens(r.input_tokens + r.output_tokens)} tok</span>
                  <span className="dotsep">·</span>
                  <span>${r.cost_usd.toFixed(4)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* ── detail: run + step timeline ─────────────────────────────── */}
        <aside className="detail">
          <div className="card panel">
            <span className="kicker">{shortId(active.id)}</span>
            <h2 className="rtitle">{active.task}</h2>
            <div className="rmeta">
              <span className={"tag tag--status tag--" + STATUS[active.status].tone}>
                {STATUS[active.status].label}
              </span>
              <span className="tag">{active.model}</span>
              <span className="tag">{active.started_at}</span>
            </div>

            <div className="kpis">
              <div className="kpi"><span className="kpi__v">{active.duration}</span><span className="kpi__l">duration</span></div>
              <div className="kpi"><span className="kpi__v">{tokens(active.input_tokens)}</span><span className="kpi__l">in tok</span></div>
              <div className="kpi"><span className="kpi__v">{tokens(active.output_tokens)}</span><span className="kpi__l">out tok</span></div>
              <div className="kpi"><span className="kpi__v">${active.cost_usd.toFixed(4)}</span><span className="kpi__l">cost</span></div>
            </div>

            <div className="sec-label">Timeline<span className="sec-label__n">{activeSteps.length} steps</span></div>
            <ol className="timeline">
              {activeSteps.map((st, i) => (
                <li key={i} className={"tstep tstep--" + st.status}>
                  <span className="tstep__rail"><span className="tstep__dot" /></span>
                  <span className="tstep__body">
                    <span className="tstep__top">
                      <b className="tstep__tool">{st.tool}</b>
                      <span className="tstep__dur">{st.dur}</span>
                    </span>
                    <small className="tstep__detail">{st.detail}</small>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
