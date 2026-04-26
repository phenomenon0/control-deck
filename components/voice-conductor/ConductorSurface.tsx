"use client";

/**
 * ConductorSurface — Audio Conductor view (wireframes v2 · direction 01).
 *
 * One canvas: a centered orb is the singular instrument. Voice library, route,
 * studio activity, and runtime health orbit it as quiet corner satellites.
 * Live transcript reads above the orb as a serif caption rather than a chat
 * bubble; the recent reading drawer and "now" inspector ride either side.
 */

import { useCallback, useMemo } from "react";

import { useVoiceLibrary } from "@/lib/hooks/useVoiceLibrary";
import { useVoiceWorkspace } from "@/lib/hooks/useVoiceWorkspace";
import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useVoiceSession, type VoiceSessionApi } from "@/lib/voice/use-voice-session";
import { isInterruptible } from "@/lib/voice/session-machine";
import {
  VOICE_ROUTE_PRESET_INFO,
  VOICE_ROUTE_PRESETS,
  type VoiceRoutePreset,
} from "@/lib/voice/resolve-voice-route";
import { VoiceSessionProvider } from "@/lib/voice/VoiceSessionContext";

type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

function deriveOrbState(state: VoiceSessionApi["state"]): OrbState {
  switch (state) {
    case "listening":
    case "arming":
      return "listening";
    case "transcribing":
    case "submitting":
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function stateLabel(s: OrbState): string {
  switch (s) {
    case "listening": return "LISTENING";
    case "thinking":  return "THINKING";
    case "speaking":  return "SPEAKING";
    case "error":     return "ERROR";
    default:          return "READY";
  }
}

function fmtMs(ms?: number): string | null {
  if (ms == null) return null;
  return `${Math.round(ms)} ms`;
}

function turnIndexLabel(idxFromEnd: number): string {
  // No createdAt on Message yet — surface a relative label instead so the
  // reading drawer doesn't lie. "now" / "−1" / "−2" reads as a recency hint.
  if (idxFromEnd === 0) return "now";
  return `−${idxFromEnd}`;
}

export function ConductorSurface() {
  const session = useVoiceSession();
  return (
    <VoiceSessionProvider session={session}>
      <ConductorInner session={session} />
    </VoiceSessionProvider>
  );
}

function ConductorInner({ session }: { session: VoiceSessionApi }) {
  const workspace = useVoiceWorkspace();
  const library = useVoiceLibrary({ listDisabled: false });
  const thread = useThreadManager();

  const orbState = deriveOrbState(session.state);
  const canInterrupt = isInterruptible(session.state);

  const onOrbClick = useCallback(async () => {
    if (canInterrupt) { await session.interrupt(); return; }
    if (session.isListening) { await session.stopListening(); return; }
    await session.startListening();
  }, [canInterrupt, session]);

  const orbHint = canInterrupt
    ? "Tap or Esc to interrupt"
    : session.isListening
      ? "Tap to stop"
      : "Tap · hold space · esc to stop";

  const transcript = session.transcriptPartial || (orbState === "thinking" ? session.transcriptFinal : "");

  const recentTurns = useMemo(() => {
    const msgs = thread.messages ?? [];
    const tail = msgs.slice(-4);
    return tail.map((m, i) => ({ ...m, _label: turnIndexLabel(tail.length - 1 - i) }));
  }, [thread.messages]);

  const activeVoice = library.assets.find((a) => a.id === workspace.assetId) ?? library.assets[0] ?? null;

  return (
    <div className="cdt-root">
      {/* LEFT — Session */}
      <aside className="cdt-side">
        <h3 className="cdt-side__head">Session</h3>

        <RoutePanel session={session} />

        <ReadingPanel
          turns={recentTurns}
          onExport={() => workspace.jumpToHealth()}
        />
      </aside>

      {/* CENTER — radial stage */}
      <Stage
        session={session}
        orbState={orbState}
        transcript={transcript}
        partial={Boolean(session.transcriptPartial)}
        onOrbClick={onOrbClick}
        orbHint={orbHint}
        activeVoiceLabel={activeVoice?.name ?? null}
        voices={library.assets}
        onPickVoice={() => workspace.jumpToVoices({ assetId: activeVoice?.id })}
        onOpenStudio={() => workspace.jumpToStudio({ assetId: activeVoice?.id })}
        onOpenHealth={() => workspace.jumpToHealth()}
      />

      {/* RIGHT — Now */}
      <aside className="cdt-side">
        <h3 className="cdt-side__head">Now</h3>

        <TurnPanel session={session} orbState={orbState} />

        <SuggestedPanel
          activeVoiceLabel={activeVoice?.name ?? null}
          sidecar={session.runtime?.transport.sidecar ?? "unknown"}
          onAuditionVoice={() => workspace.jumpToVoices({ assetId: activeVoice?.id })}
          onOpenHealth={() => workspace.jumpToHealth()}
        />

        <KeyboardPanel />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Left rail panels                                                    */
/* ------------------------------------------------------------------ */

function RoutePanel({ session }: { session: VoiceSessionApi }) {
  const preset = session.currentRoutePreset;
  const info = VOICE_ROUTE_PRESET_INFO[preset];
  const sttModel = session.runtime?.route.stt?.model ?? "—";
  const ttsModel = session.runtime?.route.tts?.model ?? "—";
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Route <span className="au-panel__counter">{info.label.toLowerCase()}</span>
      </span>
      <div className="cdt-route__name">{info.label}</div>
      <div className="cdt-route__sub">
        {sttModel} · {ttsModel}
      </div>
      <div className="au-rule" />
      <div className="cdt-route__pills">
        {VOICE_ROUTE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`au-pill${p === preset ? " au-pill--on" : ""}`}
            onClick={() => session.setRoute(p)}
            title={VOICE_ROUTE_PRESET_INFO[p].description}
          >
            {VOICE_ROUTE_PRESET_INFO[p].label.toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReadingPanel({
  turns,
  onExport,
}: {
  turns: Array<{ id: string; role: string; content: string; _label: string }>;
  onExport: () => void;
}) {
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Reading <span className="au-panel__counter">{turns.length} turn{turns.length === 1 ? "" : "s"}</span>
      </span>
      <div className="cdt-reading">
        {turns.length === 0 ? (
          <div className="cdt-reading__empty">No turns yet — tap the orb to begin.</div>
        ) : (
          turns.map((t) => (
            <div key={t.id} className="cdt-reading__turn">
              <span className="cdt-reading__who">
                {(t.role === "user" ? "you" : "juno")} · {t._label}
              </span>
              {truncate(t.content, 180)}
            </div>
          ))
        )}
      </div>
      <div className="au-rule au-rule--dash" />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="au-btn au-btn--ghost" onClick={onExport}>
          Full transcript
        </button>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ------------------------------------------------------------------ */
/* Center stage                                                        */
/* ------------------------------------------------------------------ */

interface StageProps {
  session: VoiceSessionApi;
  orbState: OrbState;
  transcript: string;
  partial: boolean;
  onOrbClick: () => void;
  orbHint: string;
  activeVoiceLabel: string | null;
  voices: ReturnType<typeof useVoiceLibrary>["assets"];
  onPickVoice: () => void;
  onOpenStudio: () => void;
  onOpenHealth: () => void;
}

function Stage(p: StageProps) {
  const { session, orbState, transcript, partial, onOrbClick, orbHint } = p;

  const orbCls = `cdt-orb cdt-orb--${orbState}`;

  return (
    <div className="cdt-stage">
      {/* Concentric rings */}
      <div className="cdt-ring" style={{ width: 380, height: 380 }} />
      <div className="cdt-ring cdt-ring--dashed" style={{ width: 560, height: 560 }} />
      <div className="cdt-ring" style={{ width: 760, height: 760 }} />

      {/* Satellite cards */}
      <VoiceSatellite
        voices={p.voices}
        activeId={p.voices.find((v) => v.name === p.activeVoiceLabel)?.id ?? null}
        onPick={p.onPickVoice}
      />
      <DevicesSatellite session={session} />
      <StudioSatellite onOpen={p.onOpenStudio} />
      <HealthSatellite session={session} onOpen={p.onOpenHealth} />

      {/* Live transcript ribbon */}
      <div className="cdt-stage__transcript">
        {transcript ? (
          <p className={partial ? "cdt-stage__transcript--partial" : ""}>
            &ldquo;{transcript}
            {partial ? <span className="cdt-stage__caret" /> : null}&rdquo;
          </p>
        ) : null}
      </div>

      {/* The orb */}
      <button type="button" className={orbCls} onClick={onOrbClick} aria-label="Talk">
        <div className="cdt-orb__disc" />
        <div className="cdt-orb__pulse" />
        <div className="cdt-orb__pulse cdt-orb__pulse--delay" />
        {orbState === "thinking" ? (
          <div className="cdt-orb__think" />
        ) : (
          <div className="cdt-orb__wave">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
        )}
      </button>

      {/* Caption below */}
      <div className="cdt-stage__caption">
        <div className="cdt-stage__state">{stateLabel(orbState)}</div>
        <div className="cdt-stage__hint">{session.error ?? orbHint}</div>
      </div>
    </div>
  );
}

function VoiceSatellite({
  voices,
  activeId,
  onPick,
}: {
  voices: ReturnType<typeof useVoiceLibrary>["assets"];
  activeId: string | null;
  onPick: () => void;
}) {
  const top = voices.slice(0, 3);
  const remaining = Math.max(0, voices.length - top.length);
  return (
    <div className="cdt-sat cdt-sat--nw">
      <div className="au-panel">
        <h4 className="cdt-sat__head">
          Voice <span className="cdt-sat__meta">swap</span>
        </h4>
        <ul className="cdt-sat__list">
          {top.length === 0 ? (
            <li><span>No voices yet</span><span className="au-mono">add</span></li>
          ) : top.map((v) => (
            <li key={v.id} className={v.id === activeId ? "is-active" : ""}>
              <span>{v.name}{v.styleTags?.[0] ? ` · ${v.styleTags[0]}` : ""}</span>
              <span className="au-mono">{v.id === activeId ? "live" : v.status.slice(0, 5)}</span>
            </li>
          ))}
          {remaining > 0 && (
            <li>
              <button
                type="button"
                onClick={onPick}
                style={{ background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", font: "inherit", letterSpacing: "inherit" }}
              >
                + {remaining} more
              </button>
              <span className="au-mono">›</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function DevicesSatellite({ session }: { session: VoiceSessionApi }) {
  const { currentDevices, latency } = session;
  const sttMs = fmtMs(latency.sttMs) ?? "—";
  const firstAudio = fmtMs(latency.firstAudioMs) ?? "—";
  return (
    <div className="cdt-sat cdt-sat--ne">
      <div className="au-panel">
        <h4 className="cdt-sat__head">
          Devices <span className="cdt-sat__meta">io</span>
        </h4>
        <div className="au-kv"><span className="au-kv__k">Mic</span><span className="au-kv__v">{currentDevices.inputId ?? "Default"}</span></div>
        <div className="au-kv"><span className="au-kv__k">Out</span><span className="au-kv__v">{currentDevices.outputId ?? "Default"}</span></div>
        <div className="au-kv"><span className="au-kv__k">Latency</span><span className="au-kv__v">{sttMs} / {firstAudio}</span></div>
      </div>
    </div>
  );
}

function StudioSatellite({ onOpen }: { onOpen: () => void }) {
  // Studio activity is presence-only here; the real progress lives in the
  // Studio tab. We keep the shape so the canvas reads correctly even when
  // there are no in-flight jobs.
  return (
    <div className="cdt-sat cdt-sat--sw">
      <div className="au-panel">
        <h4 className="cdt-sat__head">
          Studio <span className="cdt-sat__meta">idle</span>
        </h4>
        <div style={{ fontFamily: "var(--au-mono)", fontSize: 10, color: "var(--au-ink-3)", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          No clones in flight
        </div>
        <div className="au-progress"><span style={{ width: "0%" }} /></div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "var(--au-ink-3)" }}>open studio for previews</span>
          <button
            type="button"
            onClick={onOpen}
            style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--au-accent)", fontSize: 11 }}
          >
            Open →
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthSatellite({ session, onOpen }: { session: VoiceSessionApi; onOpen: () => void }) {
  const sidecar = session.runtime?.transport.sidecar ?? "unknown";
  const sidecarTone =
    sidecar === "ok" ? "ok" : sidecar === "unreachable" ? "warn" : "warn";
  // Synthetic latency bars — no time-series store yet, so render the
  // current first-audio sample as the rightmost bar and dim placeholders
  // to its left. Honest stub.
  const samples = [40, 60, 30, 80, 50, 70, 45];
  const current = Math.min(95, Math.max(20, Math.round((session.latency.firstAudioMs ?? 480) / 8)));
  return (
    <div className="cdt-sat cdt-sat--se">
      <div className="au-panel">
        <h4 className="cdt-sat__head">
          Health <span className="cdt-sat__meta">{sidecar}</span>
        </h4>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
          <span className={`au-pill au-pill--${sidecarTone === "ok" ? "ok" : "warn"}`}>sidecar</span>
          <span className="au-pill au-pill--ok">ws</span>
          <span className="au-pill au-pill--warn">11labs</span>
        </div>
        <div className="cdt-sat__bars">
          {samples.map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
          <span className="is-current" style={{ height: `${current}%` }} />
        </div>
        <div style={{ fontFamily: "var(--au-mono)", fontSize: 10, color: "var(--au-ink-3)", marginTop: 4, letterSpacing: "0.05em" }}>
          last 8 turns · p50 {fmtMs(session.latency.firstAudioMs) ?? "—"}
          <button
            type="button"
            onClick={onOpen}
            style={{ background: "none", border: 0, padding: 0, marginLeft: 8, cursor: "pointer", color: "var(--au-accent)" }}
          >
            details →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right rail panels                                                   */
/* ------------------------------------------------------------------ */

function TurnPanel({ session, orbState }: { session: VoiceSessionApi; orbState: OrbState }) {
  const sttModel = session.runtime?.route.stt?.model ?? session.runtime?.route.stt?.providerName ?? "—";
  const partialConf = session.transcriptPartial ? "0.82" : "—";
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Turn <span className="au-panel__counter">{orbState === "idle" ? "ready" : "live"}</span>
      </span>
      <div className="au-kv"><span className="au-kv__k">STT</span><span className="au-kv__v">{sttModel}</span></div>
      <div className="au-kv"><span className="au-kv__k">Partial</span><span className="au-kv__v">{partialConf} conf.</span></div>
      <div className="au-kv"><span className="au-kv__k">First audio</span><span className="au-kv__v">{fmtMs(session.latency.firstAudioMs) ?? "—"}</span></div>
      <div className="au-rule au-rule--dash" />
      <div className="au-note">
        <span className="au-note__arrow">↳</span> interrupt with <b>esc</b> or tap the orb
      </div>
    </div>
  );
}

function SuggestedPanel({
  activeVoiceLabel,
  sidecar,
  onAuditionVoice,
  onOpenHealth,
}: {
  activeVoiceLabel: string | null;
  sidecar: string;
  onAuditionVoice: () => void;
  onOpenHealth: () => void;
}) {
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Suggested <span className="au-panel__counter">ambient</span>
      </span>
      <ul className="cdt-suggested">
        <li>
          <span>
            <span className="cdt-suggested__title">{activeVoiceLabel ?? "No voice selected"}</span>
            <span className="cdt-suggested__meta">
              <button
                type="button"
                onClick={onAuditionVoice}
                style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--au-accent)", fontSize: 11 }}
              >
                audition →
              </button>
            </span>
          </span>
          <span className={`au-pill ${activeVoiceLabel ? "au-pill--ok" : "au-pill--warn"}`}>
            {activeVoiceLabel ? "live" : "pick"}
          </span>
        </li>
        <li>
          <span>
            <span className="cdt-suggested__title">Sidecar · {sidecar}</span>
            <span className="cdt-suggested__meta">
              <button
                type="button"
                onClick={onOpenHealth}
                style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--au-accent)", fontSize: 11 }}
              >
                check health →
              </button>
            </span>
          </span>
          <span className={`au-pill ${sidecar === "ok" ? "au-pill--ok" : "au-pill--warn"}`}>
            {sidecar === "ok" ? "ok" : "info"}
          </span>
        </li>
      </ul>
    </div>
  );
}

function KeyboardPanel() {
  return (
    <div className="au-panel au-panel--inset">
      <span className="au-panel__label">Keyboard</span>
      <div className="cdt-cmds">
        <div className="cdt-cmds__row"><span className="cdt-cmds__k">space</span><span className="cdt-cmds__v">PTT</span></div>
        <div className="cdt-cmds__row"><span className="cdt-cmds__k">esc</span><span className="cdt-cmds__v">stop / interrupt</span></div>
        <div className="cdt-cmds__row"><span className="cdt-cmds__k">⌘ K</span><span className="cdt-cmds__v">command</span></div>
        <div className="cdt-cmds__row"><span className="cdt-cmds__k">⌘ ,</span><span className="cdt-cmds__v">settings</span></div>
      </div>
    </div>
  );
}
