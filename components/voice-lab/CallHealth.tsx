"use client";

/**
 * Conversation-health sidebar for the call lab.
 *
 * Watches the shared voice session + the latency probe and surfaces the
 * signals you need to judge whether a call "feels good":
 *
 *   - FSM state pill (idle / listening / transcribing / thinking / speaking)
 *   - Turn count
 *   - Response gap per turn (user-final → first assistant audio chunk)
 *   - Rolling p50/p95 response gap
 *   - Barge-in count (user spoke during `speaking`)
 *   - Interrupt count (assistant turn cut short)
 *   - Last 12 FSM transitions with millisecond timestamps
 *
 * Mounts inside `<VoiceLab>` next to the live conversation surface. Reads
 * from the global `AudioDockProvider` session — no parallel voice pipeline.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import type { VoiceSessionState } from "@/lib/voice/session-machine";
import { createProbe, installProbe, uninstallProbe, type Mark } from "@/lib/voice/test-harness/latency-probe";

interface TurnRow {
  index: number;
  gapMs: number | null;
  startedAt: number;
}

interface StateTransition {
  from: VoiceSessionState;
  to: VoiceSessionState;
  at: number;
}

interface HealthSnapshot {
  turns: TurnRow[];
  bargeIns: number;
  interrupts: number;
  transitions: StateTransition[];
  lastUserFinalAt: number | null;
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

  const [snap, setSnap] = useState<HealthSnapshot>(() => ({
    turns: [],
    bargeIns: 0,
    interrupts: 0,
    transitions: [],
    lastUserFinalAt: null,
  }));

  // Install a probe with a live mark-listener. The harness clears any prior
  // probe on unmount so production paths regain the no-op fast path.
  useEffect(() => {
    const probe = createProbe({
      onMark(m) {
        handleMark(m, setSnap);
      },
    });
    installProbe(probe);
    return () => uninstallProbe();
  }, []);

  // Watch FSM state transitions. Each change is appended to the log; the
  // speaking → listening transition is a barge-in; any → interrupted is a
  // hard cancel.
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

  const stateColor = session ? STATE_COLORS[session.state] : "bg-zinc-700";
  const stateLabel = session?.stateLabel ?? "no session";

  const gapStats = useMemo(() => computeGapStats(snap.turns), [snap.turns]);
  const lastGap = snap.turns.length ? snap.turns[snap.turns.length - 1].gapMs : null;

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">
          Call health
        </h2>
        <button
          type="button"
          onClick={() =>
            setSnap({
              turns: [],
              bargeIns: 0,
              interrupts: 0,
              transitions: [],
              lastUserFinalAt: null,
            })
          }
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          reset
        </button>
      </header>

      <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
        <span className={`h-2.5 w-2.5 rounded-full ${stateColor}`} />
        <span className="font-mono text-xs text-[var(--text-primary)]">{stateLabel}</span>
        {session?.isInterruptible && (
          <span className="ml-auto rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-400">
            barge-able
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Turns" value={snap.turns.length.toString()} />
        <Stat label="Barge-ins" value={snap.bargeIns.toString()} tone={snap.bargeIns ? "warn" : "muted"} />
        <Stat
          label="Last gap"
          value={lastGap === null ? "—" : `${Math.round(lastGap)} ms`}
          tone={gapTone(lastGap)}
        />
        <Stat label="Interrupts" value={snap.interrupts.toString()} tone={snap.interrupts ? "warn" : "muted"} />
        <Stat
          label="Gap p50"
          value={gapStats.p50 == null ? "—" : `${Math.round(gapStats.p50)} ms`}
          tone={gapTone(gapStats.p50)}
        />
        <Stat
          label="Gap p95"
          value={gapStats.p95 == null ? "—" : `${Math.round(gapStats.p95)} ms`}
          tone={gapTone(gapStats.p95)}
        />
      </div>

      <section>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          Recent turns
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-2 text-xs">
          {snap.turns.length === 0 ? (
            <div className="text-[var(--text-muted)]">no turns yet — start talking</div>
          ) : (
            <ul className="space-y-0.5 font-mono">
              {snap.turns.slice(-6).map((t) => (
                <li key={t.index} className="flex justify-between">
                  <span className="text-[var(--text-muted)]">turn {t.index}</span>
                  <span className={gapTextColor(t.gapMs)}>
                    {t.gapMs === null ? "no reply" : `${Math.round(t.gapMs)} ms`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          State transitions
        </div>
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
                    <span className="mx-1">→</span>
                    <span className="text-[var(--text-primary)]">{tr.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Legend />
    </div>
  );
}

function handleMark(
  m: Mark,
  setSnap: (fn: (s: HealthSnapshot) => HealthSnapshot) => void,
) {
  // The probe's `t` is relative to probe-start. Convert to performance.now()
  // for joining with state-transition timestamps. Approximate by capturing
  // now() on every mark — accurate to within a few ms.
  const nowAbs = performance.now();
  if (m.name === "stt_final") {
    setSnap((s) => ({
      ...s,
      turns: [
        ...s.turns,
        { index: s.turns.length + 1, gapMs: null, startedAt: nowAbs },
      ],
      lastUserFinalAt: nowAbs,
    }));
  } else if (m.name === "tts_first_chunk" || m.name === "audio_started") {
    setSnap((s) => {
      if (!s.turns.length || s.lastUserFinalAt === null) return s;
      const last = s.turns[s.turns.length - 1];
      if (last.gapMs !== null) return s;
      const gap = nowAbs - s.lastUserFinalAt;
      const turns = s.turns.slice(0, -1).concat({ ...last, gapMs: gap });
      return { ...s, turns };
    });
  }
}

interface GapStats {
  p50: number | null;
  p95: number | null;
}

function computeGapStats(turns: TurnRow[]): GapStats {
  const vals = turns.map((t) => t.gapMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (vals.length === 0) return { p50: null, p95: null };
  return {
    p50: vals[Math.floor(vals.length * 0.5)] ?? null,
    p95: vals[Math.floor(vals.length * 0.95)] ?? null,
  };
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

function Legend() {
  return (
    <details className="text-[11px] text-[var(--text-muted)]">
      <summary className="cursor-pointer hover:text-[var(--text-primary)]">what counts</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        <li>
          <strong>Last gap</strong>: ms between your final transcript and the first audio chunk you hear.
        </li>
        <li>
          <strong>Barge-in</strong>: counted when you start talking while the assistant is speaking and the FSM moves <code>speaking → listening</code>.
        </li>
        <li>
          <strong>Interrupt</strong>: counted when the FSM enters <code>interrupted</code> (manual cut or watchdog).
        </li>
        <li>
          <span className="text-emerald-400">green</span>: &lt;800ms · <span className="text-amber-400">amber</span>: &lt;2s · <span className="text-rose-400">red</span>: ≥2s
        </li>
      </ul>
    </details>
  );
}
