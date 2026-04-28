"use client";

/**
 * AudioDiagnosticsDrawer — slide-in panel that surfaces the current state
 * of every audio surface for debugging.
 *
 * - Voice API connection status (STT/TTS streaming)
 * - FSM state + label
 * - Selected input/output devices
 * - Mic ownership claim (cross-tab, via activity-bus)
 * - Latency marks for the current VoiceTurn
 * - Tail of recent FSM transitions
 *
 * Read-only. Owns no agent logic.
 */

import { useEffect, useRef, useState } from "react";
import { useAudioDock } from "./AudioDockProvider";
import {
  getCurrentVoiceActivity,
  type VoiceActivityClaim,
} from "@/lib/voice/activity-bus";
import type { VoiceSessionState } from "@/lib/voice/session-machine";

interface DiagnosticsDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface TransitionEntry {
  state: VoiceSessionState;
  at: number;
}

const HISTORY_LIMIT = 16;

export function AudioDiagnosticsDrawer({ open, onClose }: DiagnosticsDrawerProps) {
  const { session, route } = useAudioDock();
  const [history, setHistory] = useState<TransitionEntry[]>([]);
  const [claim, setClaim] = useState<VoiceActivityClaim | null>(null);
  const lastStateRef = useRef<VoiceSessionState | null>(null);

  // Track state transitions only — don't append on identical re-renders.
  useEffect(() => {
    const state = session.state;
    if (state === lastStateRef.current) return;
    lastStateRef.current = state;
    setHistory((prev) => {
      const next = [...prev, { state, at: Date.now() }];
      return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
    });
  }, [session.state]);

  // Poll the cross-tab activity claim while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const tick = () => setClaim(getCurrentVoiceActivity());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) return null;

  const turn = session.currentTurn;
  const marks = turn?.marks;
  const latency = (a?: number, b?: number) =>
    a && b ? `${Math.max(0, b - a)} ms` : "—";

  return (
    <div className="ad-diagnostics" role="dialog" aria-label="Audio diagnostics">
      <div className="ad-diagnostics__head">
        <span>Audio diagnostics</span>
        <button
          type="button"
          className="ad-btn ad-btn--ghost ad-btn--compact"
          onClick={onClose}
          aria-label="Close diagnostics"
        >
          ×
        </button>
      </div>

      <section className="ad-diagnostics__section">
        <h4>Session</h4>
        <Row label="State" value={session.state} />
        <Row label="Label" value={session.stateLabel} />
        <Row label="Route" value={`${route.label} (${route.id})`} />
        <Row label="Mode" value={route.mode} />
        <Row label="Voice API" value={session.voiceChat.voiceApiStatus} />
        <Row label="STT streaming" value={session.voiceChat.isProcessingSTT ? "yes" : "no"} />
        <Row label="TTS speaking" value={session.voiceChat.isSpeaking ? "yes" : "no"} />
      </section>

      <section className="ad-diagnostics__section">
        <h4>Devices</h4>
        <Row label="Input" value={session.currentDevices?.inputId ?? "(default)"} />
        <Row label="Output" value={session.currentDevices?.outputId ?? "(default)"} />
        <Row
          label="Mic owner"
          value={
            claim
              ? `${claim.ownerId} — ${claim.reason} (${ageMs(claim.at)} ago)`
              : "(none)"
          }
        />
      </section>

      <section className="ad-diagnostics__section">
        <h4>Current turn</h4>
        {turn ? (
          <>
            <Row label="Turn" value={turn.turnId} />
            <Row label="Run" value={turn.runId ?? "—"} />
            <Row label="Source" value={`${turn.source} / ${turn.surface}`} />
            <Row label="STT first → final" value={latency(marks?.stt.firstPartialAt, marks?.stt.finalAt)} />
            <Row label="LLM submit → first text" value={latency(marks?.llm.submittedAt, marks?.llm.firstTextAt)} />
            <Row label="LLM submit → done" value={latency(marks?.llm.submittedAt, marks?.llm.completedAt)} />
            <Row label="TTS first phrase → audio" value={latency(marks?.tts.firstPhraseAt, marks?.tts.firstAudioAt)} />
          </>
        ) : (
          <Row label="—" value="(no active turn)" />
        )}
      </section>

      <section className="ad-diagnostics__section">
        <h4>Transitions</h4>
        <ul className="ad-diagnostics__history">
          {history.length === 0 ? (
            <li className="ad-diagnostics__empty">(no transitions yet)</li>
          ) : (
            history
              .slice()
              .reverse()
              .map((entry, i) => (
                <li key={`${entry.at}-${i}`}>
                  <span className="ad-diagnostics__when">{formatTime(entry.at)}</span>
                  <span className="ad-diagnostics__what">{entry.state}</span>
                </li>
              ))
          )}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ad-diagnostics__row">
      <span className="ad-diagnostics__label">{label}</span>
      <span className="ad-diagnostics__value">{value}</span>
    </div>
  );
}

function ageMs(at: number): string {
  const delta = Math.max(0, Date.now() - at);
  if (delta < 1000) return `${delta}ms`;
  if (delta < 60_000) return `${Math.round(delta / 1000)}s`;
  return `${Math.round(delta / 60_000)}m`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
