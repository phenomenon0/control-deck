"use client";

/* =============================================================================
   ATLAS VISUAL 2 — RUNS. A feed of recent agent runs + a selected-run step
   timeline. Wired to the LIVE run store: GET /api/agui/runs (list + today's
   cost) and POST /api/agui/runs { runId } (per-run AG-UI events → step
   timeline). Shape mirrors the real Run/RunEvent contract
   (components/panes/runs/types.ts → lib/agui/db.ts). No fabricated data: an
   empty store shows an honest "no runs yet" state, a failed fetch shows an
   error state with retry, and a per-run events failure shows an inline warning
   row (with retry) rather than a bland placeholder step.
   ============================================================================= */

import { useCallback, useEffect, useMemo, useState } from "react";
import "./runs-v2.css";
import type { Run, RunEvent } from "@/components/panes/runs/types";
import { formatDuration, formatTime } from "@/components/panes/runs/types";
import type { DeckPayload } from "@/lib/agui/payload";

type Status = "running" | "finished" | "error";
type Tone = "positive" | "caution" | "danger";
type ListState = "loading" | "ok" | "error";

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
  status: "complete" | "running" | "error" | "warning";
  dur: string;
}

const STATUS: Record<Status, { tone: Tone; label: string }> = {
  running: { tone: "caution", label: "running" },
  finished: { tone: "positive", label: "ok" },
  error: { tone: "danger", label: "failed" },
};

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
      case "WarningRaised": {
        activeText = null; // warnings punctuate the flow like tool steps
        const src = typeof e.source === "string" ? e.source : "warning";
        steps.push({
          tool: `⚠ ${src}`,
          detail: typeof e.message === "string" ? e.message : "",
          status: "warning",
          dur: "",
        });
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

export default function RunsV2Page() {
  const [runs, setRuns] = useState<RunV[]>([]);
  const [listState, setListState] = useState<ListState>("loading");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [selected, setSelected] = useState<string>("");
  const [stepsByRun, setStepsByRun] = useState<Record<string, Step[]>>({});
  const [stepsErr, setStepsErr] = useState<Record<string, boolean>>({});
  const [loadingSteps, setLoadingSteps] = useState(false);

  // Fetch recent runs from the live store. Honest states only: no runs → empty,
  // fetch failure → error + retry. Never fabricated feed data.
  const loadRuns = useCallback(async () => {
    setListState("loading");
    try {
      const res = await fetch("/api/agui/runs?limit=50", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const live: Run[] = Array.isArray(data.runs) ? data.runs : [];
      const mapped = live.map(mapRun);
      setRuns(mapped);
      setSelected((prev) => (prev && mapped.some((r) => r.id === prev) ? prev : mapped[0]?.id ?? ""));
      setListState("ok");
    } catch (err) {
      console.warn("[runs-v2] live fetch failed:", err);
      setListState("error");
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Pull the selected run's real events → step timeline (cached per run). A
  // failure is recorded distinctly so the timeline can offer a retry instead of
  // masquerading as a step-less run.
  useEffect(() => {
    if (!selected || stepsByRun[selected] || stepsErr[selected]) return;
    let cancelled = false;
    setLoadingSteps(true);
    (async () => {
      try {
        const res = await fetch("/api/agui/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: selected }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const events: RunEvent[] = Array.isArray(data.events) ? data.events : [];
        const runStatus = (runs.find((r) => r.id === selected)?.status ?? "finished") as Status;
        if (!cancelled) setStepsByRun((prev) => ({ ...prev, [selected]: buildSteps(events, runStatus) }));
      } catch (err) {
        console.warn("[runs-v2] events fetch failed:", err);
        if (!cancelled) setStepsErr((prev) => ({ ...prev, [selected]: true }));
      } finally {
        if (!cancelled) setLoadingSteps(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, stepsByRun, stepsErr, runs]);

  const retryEvents = useCallback((id: string) => {
    setStepsErr((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setStepsByRun((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

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

  const eventsFailed = active ? !!stepsErr[active.id] : false;
  const cached = active ? stepsByRun[active.id] : undefined;
  const activeSteps = cached ?? [];

  const countLabel =
    listState === "loading" && runs.length === 0
      ? "loading…"
      : listState === "error"
        ? "unavailable"
        : `${runs.length} recent`;

  return (
    <div className="av2-runs">
      <header className="top">
        <h1>Runs</h1>
        <span className="count">{countLabel}</span>
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

      {listState === "error" ? (
        /* ── honest error state ─────────────────────────────────────────── */
        <div className="statewrap">
          <div className="card statecard statecard--error">
            <span className="statecard__mark ic" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </span>
            <h3>Couldn&rsquo;t load runs</h3>
            <p>The run store didn&rsquo;t respond. Nothing is lost — retry once it&rsquo;s reachable.</p>
            <button type="button" className="btn" onClick={() => void loadRuns()}>retry</button>
          </div>
        </div>
      ) : listState === "loading" && runs.length === 0 ? (
        /* ── first load ─────────────────────────────────────────────────── */
        <div className="statewrap">
          <div className="card statecard">
            <p>Loading runs…</p>
          </div>
        </div>
      ) : runs.length === 0 ? (
        /* ── honest empty state ─────────────────────────────────────────── */
        <div className="statewrap">
          <div className="card statecard">
            <span className="statecard__mark ic" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16v16H4z" opacity="0" />
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </span>
            <h3>No runs yet</h3>
            <p>Agent runs appear here as they happen. Start one from Chat and its step timeline lands here live.</p>
          </div>
        </div>
      ) : (
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
            {active && (
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

                <div className="sec-label">
                  Timeline
                  <span className="sec-label__n">
                    {eventsFailed ? "" : `${activeSteps.length} steps`}
                  </span>
                </div>
                <ol className="timeline">
                  {eventsFailed ? (
                    <li className="tstep tstep--error">
                      <span className="tstep__rail"><span className="tstep__dot" /></span>
                      <span className="tstep__body">
                        <span className="tstep__top">
                          <b className="tstep__tool">couldn&rsquo;t load events</b>
                        </span>
                        <small className="tstep__detail">
                          The events store didn&rsquo;t respond for this run.{" "}
                          <button type="button" className="linkbtn" onClick={() => retryEvents(active.id)}>
                            retry
                          </button>
                        </small>
                      </span>
                    </li>
                  ) : loadingSteps && !cached ? (
                    <li className="tstep tstep--running">
                      <span className="tstep__rail"><span className="tstep__dot" /></span>
                      <span className="tstep__body">
                        <span className="tstep__top"><b className="tstep__tool">loading events…</b></span>
                      </span>
                    </li>
                  ) : activeSteps.length === 0 ? (
                    <li className="tstep">
                      <span className="tstep__rail"><span className="tstep__dot" /></span>
                      <span className="tstep__body">
                        <span className="tstep__top"><b className="tstep__tool">no steps</b></span>
                        <small className="tstep__detail">This run recorded no tool or message events.</small>
                      </span>
                    </li>
                  ) : (
                    activeSteps.map((st, i) => (
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
                    ))
                  )}
                </ol>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
