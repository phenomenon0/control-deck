"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import { useLabStore, type LabRun } from "@/lib/voice-lab/store";
import type { VoiceSessionState } from "@/lib/voice/session-machine";

interface StateTransition {
  from: VoiceSessionState;
  to: VoiceSessionState;
  at: number;
}

interface HealthSnapshot {
  bargeIns: number;
  interrupts: number;
  transitions: StateTransition[];
}

const STATE_COLORS: Record<VoiceSessionState, string> = {
  idle: "bg-zinc-500",
  arming: "bg-amber-400",
  listening: "bg-emerald-500",
  transcribing: "bg-sky-500",
  submitting: "bg-indigo-500",
  thinking: "bg-violet-500",
  speaking: "bg-fuchsia-500",
  confirming: "bg-yellow-500",
  interrupted: "bg-rose-500",
  reconnecting: "bg-orange-500",
  error: "bg-red-600",
};

export function CallHealth() {
  const dock = useOptionalAudioDock();
  const session = dock?.session ?? null;
  const { runs, usage } = useLabStore();

  const [snap, setSnap] = useState<HealthSnapshot>(() => ({
    bargeIns: 0,
    interrupts: 0,
    transitions: [],
  }));

  const prevStateRef = useRef<VoiceSessionState | null>(null);
  const sessionState = session?.state ?? null;
  useEffect(() => {
    if (!sessionState) return;
    const from = prevStateRef.current;
    const to = sessionState;
    if (from === to) return;
    prevStateRef.current = to;
    if (!from) return;
    setSnap((s) => {
      const next: HealthSnapshot = {
        ...s,
        transitions: [...s.transitions, { from, to, at: performance.now() }].slice(-12),
      };
      if (from === "speaking" && to === "listening") next.bargeIns = s.bargeIns + 1;
      if (to === "interrupted") next.interrupts = s.interrupts + 1;
      return next;
    });
  }, [sessionState]);

  const gaps = useMemo(() => runs.map(headlineGap).filter((v): v is number => v !== null), [runs]);
  const gapStats = useMemo(() => computeGapStats(gaps), [gaps]);
  const lastGap = runs.length ? headlineGap(runs[0]) : null;
  const turnCount = numberFromUsage(usage, ["turns", "turn_count", "requests"]) ?? runs.length;
  const cancellations = numberFromUsage(usage, ["cancellations", "cancelled", "canceled"]) ?? snap.interrupts;
  const tokenCount = tokensFromUsage(usage);

  const stateColor = session ? STATE_COLORS[session.state] : "bg-zinc-700";
  const stateLabel = session?.stateLabel ?? "no session";

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">Call health</h2>
        <button
          type="button"
          onClick={() => setSnap({ bargeIns: 0, interrupts: 0, transitions: [] })}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          reset
        </button>
      </header>

      <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
        <span className={`h-2.5 w-2.5 rounded-full ${stateColor}`} />
        <span className="font-mono text-xs text-[var(--text-primary)]">{stateLabel}</span>
        {session?.isInterruptible ? (
          <span className="ml-auto rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-400">
            barge-able
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Turns" value={formatCount(turnCount)} />
        <Stat label="Cancels" value={formatCount(cancellations)} tone={cancellations ? "warn" : "muted"} />
        <Stat label="Tokens" value={tokenCount === null ? "-" : formatCount(tokenCount)} />
        <Stat label="Barge-ins" value={snap.bargeIns.toString()} tone={snap.bargeIns ? "warn" : "muted"} />
        <Stat label="Last gap" value={formatMs(lastGap)} tone={gapTone(lastGap)} />
        <Stat label="Gap p95" value={formatMs(gapStats.p95)} tone={gapTone(gapStats.p95)} />
      </div>

      <section>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Recent turns</div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-2 text-xs">
          {runs.length === 0 ? (
            <div className="text-[var(--text-muted)]">no turns yet</div>
          ) : (
            <ul className="space-y-0.5 font-mono">
              {runs.slice(0, 6).map((run, index) => {
                const gap = headlineGap(run);
                return (
                  <li key={run.id} className="flex justify-between gap-2">
                    <span className="truncate text-[var(--text-muted)]">
                      {runs.length - index} {new Date(run.startedAt).toLocaleTimeString()}
                    </span>
                    <span className={gapTextColor(gap)}>{formatMs(gap)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">State transitions</div>
        <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-2 text-[11px] font-mono">
          {snap.transitions.length === 0 ? (
            <div className="text-[var(--text-muted)]">none</div>
          ) : (
            <ul className="space-y-0.5">
              {snap.transitions.slice().reverse().map((tr, i) => (
                <li key={`${tr.at}-${i}`} className="flex justify-between gap-2">
                  <span className="text-[var(--text-muted)]">{formatClock(tr.at)}</span>
                  <span>
                    <span className="text-[var(--text-muted)]">{tr.from}</span>
                    <span className="mx-1">-&gt;</span>
                    <span className="text-[var(--text-primary)]">{tr.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function headlineGap(run: LabRun): number | null {
  return (
    run.report.spans.speech_stop_to_first_audio ??
    run.report.spans.mic_stop_to_first_audio ??
    null
  );
}

interface GapStats {
  p50: number | null;
  p95: number | null;
}

function computeGapStats(values: number[]): GapStats {
  const vals = [...values].sort((a, b) => a - b);
  if (vals.length === 0) return { p50: null, p95: null };
  return {
    p50: vals[Math.floor(vals.length * 0.5)] ?? null,
    p95: vals[Math.floor(vals.length * 0.95)] ?? null,
  };
}

function numberFromUsage(usage: Record<string, unknown> | null, keys: string[]): number | null {
  if (!usage) return null;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function tokensFromUsage(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null;
  const direct = numberFromUsage(usage, ["tokens", "total_tokens", "token_count"]);
  if (direct !== null) return direct;
  const prompt = numberFromUsage(usage, ["prompt_tokens", "input_tokens"]);
  const completion = numberFromUsage(usage, ["completion_tokens", "output_tokens"]);
  if (prompt !== null || completion !== null) return (prompt ?? 0) + (completion ?? 0);
  return null;
}

function formatMs(ms: number | null): string {
  return ms === null ? "-" : `${Math.round(ms)} ms`;
}

function formatCount(value: number): string {
  return Intl.NumberFormat("en-US").format(value);
}

function gapTone(ms: number | null): StatTone {
  if (ms === null) return "muted";
  if (ms < 800) return "good";
  if (ms < 2000) return "warn";
  return "bad";
}

function gapTextColor(ms: number | null): string {
  if (ms === null) return "text-[var(--text-muted)]";
  if (ms < 800) return "text-emerald-400";
  if (ms < 2000) return "text-amber-400";
  return "text-rose-400";
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

type StatTone = "good" | "warn" | "bad" | "muted";

function Stat({ label, value, tone = "muted" }: { label: string; value: string; tone?: StatTone }) {
  const colorMap: Record<StatTone, string> = {
    good: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-rose-400",
    muted: "text-[var(--text-primary)]",
  };
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`tabular-nums font-mono text-base ${colorMap[tone]}`}>{value}</div>
    </div>
  );
}
