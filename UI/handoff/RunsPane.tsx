/**
 * RunsPane — production React port of the mock's Runs pane.
 * --------------------------------------------------------------
 * This is a plain TSX file. No tailwind required — uses CSS vars
 * directly via className + a colocated RunsPane.module.css (below
 * as a string constant for copy/paste convenience; move it to a
 * real file when dropping into a repo).
 *
 * Zero business logic is invented: `useRuns` is a placeholder
 * hook — replace its body with your actual data fetcher (SWR,
 * React Query, Zustand, Redux, whatever you use). Everything
 * else is pure view.
 *
 * Dependencies assumed:
 *   - React 18+
 *   - tokens.standalone.css mounted once at app root
 *   - (optional) TweaksProvider from handoff/tweaks.tsx
 *
 * Drop-in: <RunsPane />   — nothing else required.
 * --------------------------------------------------------------
 */

import React, { useMemo, useState } from "react";
import styles from "./RunsPane.module.css";

// ═════════════════════════════════════════════════════════════
// TYPES — match these to your API shape; these are the minimum
// fields the view needs.
// ═════════════════════════════════════════════════════════════

export type RunStatus = "running" | "complete" | "failed" | "queued";

export interface Run {
  id: string;
  agent: string;               // e.g. "Claude Sonnet 4.5"
  task: string;                // short one-liner
  status: RunStatus;
  startedAt: Date;
  durationMs: number;          // use 0 while running
  tokens: { in: number; out: number };
  costUsd: number;
  tags?: string[];             // e.g. ["image", "tool"]
}

export interface TraceEvent {
  t: number;                   // ms since run start
  kind: "frame" | "stream" | "tool" | "art" | "system";
  label: string;
  detail?: string;
}

// ═════════════════════════════════════════════════════════════
// DATA HOOK — REPLACE THIS with your real fetcher.
// Keep the return shape and the component stays untouched.
// ═════════════════════════════════════════════════════════════

function useRuns() {
  // TODO: swap for useQuery / useSWR / zustand selector / etc.
  const runs: Run[] = useMemo(() => demoRuns(), []);
  const meters = useMemo(() => deriveMeters(runs), [runs]);
  return { runs, meters, isLoading: false, error: null as null | Error };
}

function useRunTrace(runId: string | null) {
  // TODO: swap for your trace stream / SSE / websocket.
  const events: TraceEvent[] = useMemo(
    () => (runId ? demoTrace(runId) : []),
    [runId]
  );
  return { events, isLoading: false };
}

// ═════════════════════════════════════════════════════════════
// COMPONENT
// ═════════════════════════════════════════════════════════════

export function RunsPane() {
  const { runs, meters } = useRuns();
  const [filter, setFilter] = useState<RunStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(runs[0]?.id ?? null);

  const visible = useMemo(
    () => (filter === "all" ? runs : runs.filter((r) => r.status === filter)),
    [runs, filter]
  );
  const selected = useMemo(
    () => visible.find((r) => r.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId]
  );

  return (
    <div className={styles.stage}>
      <Header />
      <Meters meters={meters} />

      <div className={styles.filterBar}>
        {(["all", "running", "complete", "failed", "queued"] as const).map((s) => (
          <button
            key={s}
            className={`${styles.filterPill} ${filter === s ? styles.filterPillActive : ""}`}
            onClick={() => setFilter(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
            <span className={styles.filterCount}>
              {s === "all" ? runs.length : runs.filter((r) => r.status === s).length}
            </span>
          </button>
        ))}
      </div>

      <div className={styles.split}>
        <RunList runs={visible} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        <TracePanel run={selected} />
      </div>
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────

function Header() {
  return (
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>Operations</div>
        <h1 className={styles.title}>Runs</h1>
        <p className={styles.lede}>
          Every task the stack has run — with cost, duration, and a full trace.
        </p>
      </div>
      <div className={styles.headerActions}>
        <button className={styles.pillGhost}>Export CSV</button>
        <button className={styles.pill}>New run</button>
      </div>
    </header>
  );
}

// ─── Meters ────────────────────────────────────────────────────

interface MetersData {
  spend24h: number;
  runs24h: number;
  medianLatencyMs: number;
  failureRate: number; // 0..1
  sparkline: number[]; // 24 hourly spend values
}

function Meters({ meters }: { meters: MetersData }) {
  return (
    <section className={styles.meters}>
      <Meter label="Spend (24h)" value={`$${meters.spend24h.toFixed(2)}`} trend="+12%" />
      <Meter label="Runs (24h)"  value={meters.runs24h.toString()}        trend="+4"   />
      <Meter label="Median latency" value={`${(meters.medianLatencyMs / 1000).toFixed(1)}s`} trend="−0.3s" trendGood />
      <Meter label="Failure rate"   value={`${(meters.failureRate * 100).toFixed(1)}%`} trend="−0.4pp" trendGood />
      <div className={styles.spark}>
        <div className={styles.sparkLabel}>Spend · last 24h</div>
        <Sparkline values={meters.sparkline} />
      </div>
    </section>
  );
}

function Meter({ label, value, trend, trendGood }: { label: string; value: string; trend: string; trendGood?: boolean }) {
  return (
    <div className={styles.meter}>
      <div className={styles.meterLabel}>{label}</div>
      <div className={styles.meterValue}>{value}</div>
      <div className={`${styles.meterTrend} ${trendGood ? styles.meterTrendGood : ""}`}>{trend}</div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const w = 260;
  const h = 48;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - (v / max) * (h - 6) - 3}`).join(" ");
  return (
    <svg width={w} height={h} className={styles.sparkSvg} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" points={points} />
      <polyline
        fill="var(--accent-muted)"
        stroke="none"
        points={`0,${h} ${points} ${w},${h}`}
      />
    </svg>
  );
}

// ─── Run list ──────────────────────────────────────────────────

function RunList({
  runs,
  selectedId,
  onSelect,
}: {
  runs: Run[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={styles.listWrap}>
      <div className={styles.listHead}>
        <span>Started</span>
        <span>Task</span>
        <span>Model</span>
        <span>Tokens</span>
        <span>Cost</span>
        <span>Status</span>
      </div>
      <div className={styles.list}>
        {runs.map((r) => (
          <RunRow key={r.id} run={r} selected={r.id === selectedId} onClick={() => onSelect(r.id)} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run, selected, onClick }: { run: Run; selected: boolean; onClick: () => void }) {
  return (
    <button className={`${styles.row} ${selected ? styles.rowActive : ""}`} onClick={onClick}>
      <span className={styles.rowWhen}>{fmtTime(run.startedAt)}</span>
      <span className={styles.rowTask}>
        <span className={styles.rowTaskTitle}>{run.task}</span>
        {run.tags && run.tags.length > 0 && (
          <span className={styles.rowTags}>
            {run.tags.map((t) => (
              <span key={t} className={styles.tag}>{t}</span>
            ))}
          </span>
        )}
      </span>
      <span className={styles.rowModel}>{run.agent}</span>
      <span className={styles.rowTokens}>
        <span className={styles.rowTokenIn}>{fmtK(run.tokens.in)}</span>
        <span className={styles.rowTokenSep}>↗</span>
        <span className={styles.rowTokenOut}>{fmtK(run.tokens.out)}</span>
      </span>
      <span className={styles.rowCost}>${run.costUsd.toFixed(3)}</span>
      <StatusDot status={run.status} />
    </button>
  );
}

function StatusDot({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { color: string; label: string; pulse?: boolean }> = {
    running:  { color: "var(--accent)", label: "Running", pulse: true },
    complete: { color: "var(--ok)",     label: "Done"    },
    failed:   { color: "var(--err)",    label: "Failed"  },
    queued:   { color: "var(--fg-dim)", label: "Queued"  },
  };
  const { color, label, pulse } = map[status];
  return (
    <span className={styles.status}>
      <span className={`${styles.dot} ${pulse ? styles.dotPulse : ""}`} style={{ background: color }} />
      {label}
    </span>
  );
}

// ─── Trace panel ───────────────────────────────────────────────

function TracePanel({ run }: { run: Run | null }) {
  const { events } = useRunTrace(run?.id ?? null);
  if (!run) {
    return (
      <aside className={styles.trace}>
        <div className={styles.traceEmpty}>Select a run to see its trace.</div>
      </aside>
    );
  }
  return (
    <aside className={styles.trace}>
      <div className={styles.traceHead}>
        <div className={styles.eyebrow}>Trace</div>
        <h3 className={styles.traceTitle}>{run.task}</h3>
        <div className={styles.traceMeta}>
          <span>{run.agent}</span>
          <span>·</span>
          <span>{fmtDuration(run.durationMs)}</span>
          <span>·</span>
          <span>${run.costUsd.toFixed(3)}</span>
        </div>
      </div>
      <ol className={styles.traceList}>
        {events.map((e, i) => (
          <li key={i} className={styles.traceItem} data-kind={e.kind}>
            <span className={styles.traceTime}>{fmtMs(e.t)}</span>
            <span className={styles.traceKind} data-kind={e.kind}>{e.kind}</span>
            <span className={styles.traceLabel}>{e.label}</span>
            {e.detail && <code className={styles.traceDetail}>{e.detail}</code>}
          </li>
        ))}
      </ol>
    </aside>
  );
}

// ═════════════════════════════════════════════════════════════
// utils
// ═════════════════════════════════════════════════════════════
const fmtTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtMs = (ms: number) =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
const fmtDuration = (ms: number) =>
  ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
const fmtK = (n: number) =>
  n < 1000 ? n.toString() : n < 10_000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;

// ═════════════════════════════════════════════════════════════
// DEMO data — delete when wiring real hooks.
// ═════════════════════════════════════════════════════════════

function demoRuns(): Run[] {
  const base = Date.now();
  const seed = (i: number) => ({
    id: `r_${i.toString(36)}`,
    startedAt: new Date(base - i * 1000 * 60 * 7),
  });
  return [
    { ...seed(0), agent: "Claude Sonnet 4.5", task: "Draft Q3 investor update",                status: "running",  durationMs: 0,      tokens: { in: 12_400, out: 0     }, costUsd: 0.041, tags: ["long-context"] },
    { ...seed(1), agent: "Claude Haiku 4.5",  task: "Label inbound tickets — batch 218",       status: "complete", durationMs: 8_200,  tokens: { in: 1_840,  out: 920   }, costUsd: 0.004 },
    { ...seed(2), agent: "Claude Sonnet 4.5", task: "Generate release notes from commits",      status: "complete", durationMs: 22_500, tokens: { in: 8_200,  out: 2_140 }, costUsd: 0.038, tags: ["tool"] },
    { ...seed(3), agent: "FLUX.1 [dev]",      task: "Hero render — v4 warm",                    status: "complete", durationMs: 44_800, tokens: { in: 0,      out: 0     }, costUsd: 0.012, tags: ["image"] },
    { ...seed(4), agent: "Claude Opus 4.1",   task: "Audit proposal for tone + claims",          status: "failed",   durationMs: 3_100,  tokens: { in: 6_400,  out: 0     }, costUsd: 0.028 },
    { ...seed(5), agent: "Claude Sonnet 4.5", task: "Refactor billing module — plan",            status: "complete", durationMs: 61_200, tokens: { in: 22_100, out: 4_800 }, costUsd: 0.112, tags: ["tool", "code"] },
    { ...seed(6), agent: "Whisper Large v3",  task: "Transcribe — standup 04/17",                status: "complete", durationMs: 14_600, tokens: { in: 0,      out: 0     }, costUsd: 0.006, tags: ["voice"] },
    { ...seed(7), agent: "Claude Haiku 4.5",  task: "Summarize RSS batch",                       status: "queued",   durationMs: 0,      tokens: { in: 0,      out: 0     }, costUsd: 0     },
  ];
}

function deriveMeters(runs: Run[]): MetersData {
  const spend = runs.reduce((s, r) => s + r.costUsd, 0);
  const done  = runs.filter((r) => r.status === "complete" && r.durationMs > 0);
  const mid   = done.map((r) => r.durationMs).sort((a, b) => a - b)[Math.floor(done.length / 2)] ?? 0;
  const fails = runs.filter((r) => r.status === "failed").length;
  // synthesize a 24-point sparkline from run timestamps
  const now = Date.now();
  const buckets = Array.from({ length: 24 }, () => 0);
  runs.forEach((r) => {
    const hrsAgo = Math.floor((now - r.startedAt.getTime()) / (1000 * 60 * 60));
    if (hrsAgo >= 0 && hrsAgo < 24) buckets[23 - hrsAgo] += r.costUsd;
  });
  // spread a bit so sparkline doesn't look like a single pillar
  for (let i = 0; i < buckets.length; i++) {
    buckets[i] += (0.003 + Math.sin(i / 3) * 0.002 + Math.random() * 0.002);
  }
  return {
    spend24h: spend,
    runs24h: runs.length,
    medianLatencyMs: mid,
    failureRate: runs.length ? fails / runs.length : 0,
    sparkline: buckets,
  };
}

function demoTrace(runId: string): TraceEvent[] {
  return [
    { t: 0,      kind: "system", label: "run.start",        detail: `id=${runId}` },
    { t: 180,    kind: "frame",  label: "system message",   detail: "instructions loaded (2.1kb)" },
    { t: 340,    kind: "frame",  label: "user input",       detail: "3 attachments, 840 tokens" },
    { t: 1_220,  kind: "tool",   label: "filesystem.read",  detail: "src/billing/invoice.ts (412 loc)" },
    { t: 2_060,  kind: "stream", label: "thinking…",        detail: "reasoning tokens = 820" },
    { t: 3_800,  kind: "tool",   label: "search.web",       detail: 'q="stripe invoice statuses 2024"' },
    { t: 5_100,  kind: "stream", label: "drafting response" },
    { t: 7_640,  kind: "art",    label: "chart.render",     detail: "line · 24 points" },
    { t: 8_200,  kind: "system", label: "run.complete",     detail: "out=2140 tokens · $0.038" },
  ];
}

export default RunsPane;
