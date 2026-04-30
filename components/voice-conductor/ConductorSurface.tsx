"use client";

/**
 * ConductorSurface — Audio Conductor view (wireframes v2 · direction 02 · v4).
 *
 * One canvas, three columns:
 *   SESSION  →  Route panel + Reading drawer
 *   STAGE    →  4 corner satellites (Voice / Devices / Studio / Health) +
 *               concentric rings + transcript ribbon + orb + caption + textbar
 *   NOW      →  Turn live + Suggested ambient + Keyboard cheat-sheet
 *
 * Wired to live backend:
 *   - useVoiceSession drives orb state, transcript, turns, latency, runtime.
 *   - /api/voice/library    → Voice satellite (clickable swap, jumps to Voices)
 *   - /api/voice/jobs       → Studio satellite (active jobs + progress)
 *   - /api/voice/health     → Health satellite (provider pills + summary)
 *   - DeckSettings.voice    → Devices satellite (mic + output selection)
 *   - useVoiceWorkspace     → corner promotion ("tap corners to promote")
 *
 * The orb is the singular instrument; everything else orbits as quiet
 * corner cards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import { useVoiceSession, type VoiceSessionApi } from "@/lib/voice/use-voice-session";
import { matchPhrase, isCancellation } from "@/lib/voice/voice-approval";
import { useVoiceLibrary, type VoiceAssetSummary } from "@/lib/hooks/useVoiceLibrary";
import { useVoiceWorkspace } from "@/lib/hooks/useVoiceWorkspace";
import { isInterruptible } from "@/lib/voice/session-machine";
import { VoiceSessionProvider, useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import {
  VOICE_ROUTE_PRESETS,
  VOICE_ROUTE_PRESET_INFO,
  type VoiceRoutePreset,
} from "@/lib/voice/resolve-voice-route";
import { FoldPanel } from "@/components/voice-shared/FoldPanel";

interface VoiceJob {
  id: string;
  voiceAssetId: string;
  jobType: string;
  status: string;
  engineId: string | null;
  providerId: string | null;
  modelId: string | null;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}

interface HealthProvider {
  id: string;
  modalities: string[];
  configured: boolean;
  reachable: boolean | null;
  detail?: string;
  latencyMs?: number;
}

interface HealthSnapshot {
  status: "ok" | "degraded";
  sidecar: "ok" | "unreachable";
  providers: HealthProvider[];
  summary: { reachable: string[]; unreachable: string[]; unconfigured: string[] };
}

export function ConductorSurface() {
  // Reuse a session already provided up-tree (AudioDockProvider in DeckShell,
  // or any VoiceSessionProvider) so we don't run two parallel mics + TTS
  // pipelines for the same deck. Only when standalone do we own a session.
  const sharedSession = useOptionalVoiceSession();
  const dock = useOptionalAudioDock();
  const ownSession = useVoiceSession({ enabled: !sharedSession && !dock });
  const session = sharedSession ?? dock?.session ?? ownSession;
  return (
    <VoiceSessionProvider session={session}>
      <ConductorInner session={session} />
    </VoiceSessionProvider>
  );
}

function ConductorInner({ session }: { session: VoiceSessionApi }) {
  const workspace = useVoiceWorkspace();
  const { prefs } = useDeckSettings();
  const dock = useOptionalAudioDock();
  const library = useVoiceLibrary();
  const jobs = useVoiceJobs();
  const health = useVoiceHealth();
  const devices = useDeviceLabels(prefs.voice.audioInputId, prefs.voice.audioOutputId);

  // Wire the model used for /api/chat in runTurn — pulled from DeckSettings,
  // same source the chat surface uses.
  const selectedModel = pickRunModel(prefs);
  const threadId = "voice-conductor";

  // Subscribe to agentic SSE while the conductor is mounted so artifact +
  // tool events flow into session.tools. Depend on the stable callback ref,
  // not the whole `session` — the session memo invalidates on every audio
  // frame which would otherwise tear down + re-open the SSE constantly.
  const attachThread = session.attachThread;
  useEffect(() => attachThread(threadId), [attachThread, threadId]);

  // Drive a turn whenever the session emits a final transcript. While the
  // FSM is in `confirming`, the same transcript is interpreted as the
  // exact-phrase response to a pending approval rather than a new turn —
  // mirrors VoiceModeSheet:68-81 so speaking the approval phrase doesn't
  // also fire a new chat turn.
  const lastSubmittedRef = useRef<string>("");
  useEffect(() => {
    const text = session.transcriptFinal.trim();
    if (!text || text === lastSubmittedRef.current) return;
    lastSubmittedRef.current = text;

    if (session.state === "confirming" && session.pendingApproval) {
      if (isCancellation(text)) {
        void session.confirmApproval("rejected", "user-cancelled");
      } else if (matchPhrase(session.pendingApproval, text)) {
        void session.confirmApproval("approved");
      }
      // Non-matching speech in confirming state stays as ambient noise.
      return;
    }

    void session.runTurn(text, {
      threadId,
      model: selectedModel,
      voice: {
        routeId: dock?.routeId ?? "handsfree-chat",
        mode: dock?.mode ?? "chat",
        surface: "conductor",
        source: "manual",
      },
    });
  }, [session, session.transcriptFinal, selectedModel, dock?.routeId, dock?.mode]);

  const orbState = mapOrbState(session.state);
  const stateLabel = orbStateLabel(session.state);
  const liveText = session.transcriptPartial || (session.state === "thinking" ? session.transcriptFinal : "");

  const onOrbClick = useCallback(async () => {
    if (session.state === "error") {
      // Clear the prior error before re-arming so the user gets a fresh state
      // even if startListening fails again.
      session.clearTurns();
    }
    if (isInterruptible(session.state)) {
      await session.interrupt();
      return;
    }
    if (session.isListening) {
      await session.stopListening();
      return;
    }
    try {
      await session.startListening();
    } catch (err) {
      console.error("[ConductorSurface] startListening failed:", err);
    }
  }, [session]);

  return (
    <div className="cdt-root">
      <SessionColumn
        session={session}
        onPickRoute={session.setRoute}
      />

      <Stage
        orbState={orbState}
        stateLabel={stateLabel}
        liveText={liveText}
        errorMsg={session.error}
        onOrbClick={onOrbClick}
        onOrbKey={onOrbClick}
        nw={
          <VoiceSatellite
            assets={library.assets}
            currentVoiceId={session.currentVoiceId}
            ttsModel={session.runtime?.route?.tts?.model ?? null}
            onOpen={() => workspace.jumpToVoices()}
          />
        }
        ne={
          <DevicesSatellite
            inputLabel={devices.input}
            outputLabel={devices.output}
            onOpen={() => workspace.jumpToHealth()}
          />
        }
        sw={
          <StudioSatellite
            jobs={jobs.jobs}
            onOpen={() => workspace.jumpToStudio()}
          />
        }
        se={
          <HealthSatellite
            health={health.snapshot}
            onOpen={() => workspace.jumpToHealth()}
          />
        }
      >
        <Textbar session={session} model={selectedModel} threadId={threadId} />
      </Stage>

      <NowColumn
        session={session}
        health={health.snapshot}
        jobs={jobs.jobs}
      />
    </div>
  );
}

/* ─── SESSION column ────────────────────────────────────────────────── */

function SessionColumn({
  session,
  onPickRoute,
}: {
  session: VoiceSessionApi;
  onPickRoute: (preset: VoiceRoutePreset) => void;
}) {
  const route = session.runtime?.route;
  const stt = route?.stt;
  const tts = route?.tts;
  const presetLabel = VOICE_ROUTE_PRESET_INFO[session.currentRoutePreset].label;

  return (
    <aside className="cdt-side">
      <h3 className="cdt-side__head">Session</h3>

      <div className="au-panel">
        <span className="au-panel__label">
          Route <span className="au-panel__counter">{session.currentRoutePreset}</span>
        </span>
        <div className="cdt-route__name">{presetLabel}</div>
        <div className="cdt-route__sub">
          {[stt?.providerName ?? null, stt?.model ?? null, tts?.providerName ?? null, tts?.model ?? null]
            .filter(Boolean)
            .join(" · ") || (session.runtimeLoading ? "resolving…" : "no providers configured")}
        </div>
        <div className="au-rule" />
        <div className="cdt-route__pills">
          {VOICE_ROUTE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`au-pill${p === session.currentRoutePreset ? " au-pill--on" : ""}`}
              onClick={() => onPickRoute(p)}
              title={VOICE_ROUTE_PRESET_INFO[p].description}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <ReadingDrawer session={session} />
    </aside>
  );
}

function ReadingDrawer({ session }: { session: VoiceSessionApi }) {
  const workspace = useVoiceWorkspace();
  const turns = session.turns;
  const visible = useMemo(() => {
    return turns
      .filter((t) => t.role !== "system" || (t.content && t.content.length > 0))
      .slice(-12);
  }, [turns]);

  return (
    <FoldPanel
      storageKey="control-deck.conductor.fold.reading"
      defaultOpen={false}
      label="Reading"
      counter={`${turns.length} turns`}
    >
      <div className="cdt-reading">
        {visible.length === 0 ? (
          <div className="cdt-reading__empty">No turns yet — tap the orb to begin.</div>
        ) : (
          visible.map((t) => (
            <div key={t.id} className="cdt-reading__turn">
              <span className="cdt-reading__who">
                {t.role === "user" ? "you" : t.role === "assistant" ? "juno" : "•"}
                {t.isStreaming ? " · live" : ""}
              </span>
              {t.content || (t.isStreaming ? "…" : "")}
            </div>
          ))
        )}
      </div>
      <div className="au-rule au-rule--dash" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="au-btn au-btn--ghost"
          onClick={() => session.clearTurns()}
          disabled={turns.length === 0}
        >
          Clear
        </button>
        <button
          type="button"
          className="au-btn au-btn--ghost"
          onClick={() => exportTurns(turns)}
          disabled={turns.length === 0}
        >
          Export
        </button>
        <button
          type="button"
          className="au-btn au-btn--ghost"
          onClick={() => workspace.jumpToNewsroom()}
          title="Open the full transcript / decisions surface"
        >
          Newsroom →
        </button>
      </div>
    </FoldPanel>
  );
}

/* ─── STAGE ─────────────────────────────────────────────────────────── */

function Stage({
  orbState,
  stateLabel,
  liveText,
  errorMsg,
  onOrbClick,
  onOrbKey,
  nw,
  ne,
  sw,
  se,
  children,
}: {
  orbState: "idle" | "listening" | "thinking" | "speaking" | "error";
  stateLabel: string;
  liveText: string;
  errorMsg: string | null;
  onOrbClick: () => void;
  onOrbKey: () => void;
  nw: React.ReactNode;
  ne: React.ReactNode;
  sw: React.ReactNode;
  se: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="cdt-stage">
      <div className="cdt-ring" style={{ width: 380, height: 380 }} />
      <div className="cdt-ring cdt-ring--dashed" style={{ width: 560, height: 560 }} />
      <div className="cdt-ring" style={{ width: 760, height: 760 }} />

      {nw}
      {ne}
      {sw}
      {se}

      <div className="cdt-stage__transcript">
        {liveText ? (
          <p>&ldquo;{liveText}<span className="cdt-stage__caret" /></p>
        ) : null}
      </div>

      <button
        type="button"
        className={`cdt-orb cdt-orb--${orbState}`}
        onClick={onOrbClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOrbKey(); }}
        aria-label={stateLabel}
      >
        <div className="cdt-orb__disc" />
        <div className="cdt-orb__pulse" />
        <div className="cdt-orb__pulse cdt-orb__pulse--delay" />
        <div className="cdt-orb__wave">
          <span /><span /><span /><span /><span /><span /><span />
        </div>
        {orbState === "thinking" ? <div className="cdt-orb__think" /> : null}
      </button>

      <div className="cdt-stage__caption">
        <div className="cdt-stage__state">{stateLabel}</div>
        <div className="cdt-stage__hint">{errorMsg || stageHintFor(orbState)}</div>
      </div>

      {children}
    </div>
  );
}

function Textbar({
  session,
  model,
  threadId,
}: {
  session: VoiceSessionApi;
  model: string;
  threadId: string;
}) {
  const [pending, setPending] = useState("");
  const busy = session.state === "thinking" || session.state === "submitting";

  const send = useCallback(() => {
    const text = pending.trim();
    if (!text || busy) return;
    setPending("");
    void session.runTurn(text, { threadId, model });
  }, [pending, busy, session, model, threadId]);

  return (
    <form
      className="cdt-textbar"
      onSubmit={(e) => { e.preventDefault(); send(); }}
    >
      <input
        type="text"
        className="cdt-textbar__input"
        placeholder="Type a message…"
        value={pending}
        onChange={(e) => setPending(e.target.value)}
        disabled={busy}
      />
      <button
        type="submit"
        className="cdt-textbar__send"
        disabled={!pending.trim() || busy}
      >
        Send
      </button>
    </form>
  );
}

/* ─── Satellites ────────────────────────────────────────────────────── */

function VoiceSatellite({
  assets,
  currentVoiceId,
  ttsModel,
  onOpen,
}: {
  assets: VoiceAssetSummary[];
  currentVoiceId: string | null;
  ttsModel: string | null;
  onOpen: () => void;
}) {
  const active = assets.find((a) => a.id === currentVoiceId) ?? assets[0] ?? null;
  const value = active ? `${active.name}${active.styleTags?.[0] ? ` · ${active.styleTags[0]}` : ""}` : "No voice";
  const sub = ttsModel ?? `${assets.length} in library`;
  return (
    <SatelliteCard pos="nw" label="Voice" value={value} sub={sub} onOpen={onOpen} />
  );
}

function DevicesSatellite({
  inputLabel,
  outputLabel,
  onOpen,
}: {
  inputLabel: string;
  outputLabel: string;
  onOpen: () => void;
}) {
  return (
    <SatelliteCard
      pos="ne"
      label="Devices"
      value={inputLabel}
      sub={outputLabel}
      onOpen={onOpen}
    />
  );
}

function StudioSatellite({
  jobs,
  onOpen,
}: {
  jobs: VoiceJob[];
  onOpen: () => void;
}) {
  const liveJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const value = liveJobs.length === 0 ? "Idle" : `${liveJobs.length} ${liveJobs.length === 1 ? "job" : "jobs"} live`;
  const recent = jobs.find((j) => j.status === "succeeded" && j.endedAt);
  const sub = liveJobs.length > 0
    ? `${liveJobs[0]?.jobType ?? ""} · ${liveJobs[0]?.engineId ?? liveJobs[0]?.providerId ?? "?"}`
    : recent
      ? `last ${recent.jobType} · ${minutesAgo(recent.endedAt!)}m ago`
      : "no recent jobs";
  return <SatelliteCard pos="sw" label="Studio" value={value} sub={sub} onOpen={onOpen} />;
}

function HealthSatellite({
  health,
  onOpen,
}: {
  health: HealthSnapshot | null;
  onOpen: () => void;
}) {
  if (!health) {
    return <SatelliteCard pos="se" label="Health" value="Probing…" sub="" onOpen={onOpen} dot="warn" />;
  }
  const dot: "ok" | "warn" | "err" =
    health.sidecar !== "ok"
      ? "err"
      : health.summary.unreachable.length > 0
        ? "warn"
        : "ok";
  const value = dot === "err" ? "Sidecar down" : dot === "warn" ? "Degraded" : "Green";
  const flagged = health.summary.unreachable.slice(0, 2).join(", ");
  const sub = dot === "ok"
    ? `${health.providers.filter((p) => p.reachable).length}/${health.providers.filter((p) => p.configured).length} providers ok`
    : flagged || "tap to inspect";
  return <SatelliteCard pos="se" label="Health" value={value} sub={sub} onOpen={onOpen} dot={dot} />;
}

function SatelliteCard({
  pos,
  label,
  value,
  sub,
  onOpen,
  dot,
}: {
  pos: "nw" | "ne" | "sw" | "se";
  label: string;
  value: string;
  sub: string;
  onOpen: () => void;
  dot?: "ok" | "warn" | "err";
}) {
  return (
    <button
      type="button"
      className={`cdt-sat cdt-sat--${pos}`}
      onClick={onOpen}
      title={`Open ${label}`}
    >
      <div className="cdt-sat__lbl">
        {dot ? <span className={`cdt-sat__dot cdt-sat__dot--${dot}`} aria-hidden /> : null}
        <span>{label}</span>
      </div>
      <div className="cdt-sat__v">{value}</div>
      {sub ? <div className="cdt-sat__sub">{sub}</div> : null}
    </button>
  );
}

/* ─── NOW column ────────────────────────────────────────────────────── */

function NowColumn({
  session,
  health,
  jobs,
}: {
  session: VoiceSessionApi;
  health: HealthSnapshot | null;
  jobs: VoiceJob[];
}) {
  const stt = session.runtime?.route?.stt;
  const tts = session.runtime?.route?.tts;
  const partial = session.transcriptPartial;
  const sttModel = stt?.model ?? "—";
  const partialConf = partial ? "≈ live" : "—";
  const duration = useElapsed(session.isListening);

  const suggested = useMemo(() => buildSuggested(jobs, health), [jobs, health]);

  return (
    <aside className="cdt-side">
      <h3 className="cdt-side__head">Now</h3>

      <div className="au-panel">
        <span className="au-panel__label">
          Turn <span className="au-panel__counter">{session.stateLabel}</span>
        </span>
        <div className="au-kv"><span className="au-kv__k">STT</span><span className="au-kv__v">{sttModel}</span></div>
        <div className="au-kv"><span className="au-kv__k">TTS</span><span className="au-kv__v">{tts?.model ?? "—"}</span></div>
        <div className="au-kv"><span className="au-kv__k">Partial</span><span className="au-kv__v">{partialConf}</span></div>
        <div className="au-kv"><span className="au-kv__k">Duration</span><span className="au-kv__v">{formatClock(duration)}</span></div>
        <div className="au-rule au-rule--dash" />
        <div className="au-note">
          <span className="au-note__arrow">↳</span> interrupt with <b>esc</b> or tap the orb
        </div>
      </div>

      <FoldPanel
        storageKey="control-deck.conductor.fold.suggested"
        defaultOpen={false}
        label="Suggested"
        counter={suggested.length || "ambient"}
      >
        <ul className="cdt-suggested">
          {suggested.length === 0 ? (
            <li><span><span className="cdt-suggested__title">All clear</span><span className="cdt-suggested__meta">no recent events</span></span><span className="au-pill au-pill--ok">ok</span></li>
          ) : (
            suggested.map((s) => (
              <li key={s.id}>
                <span>
                  <span className="cdt-suggested__title">{s.title}</span>
                  <span className="cdt-suggested__meta">{s.meta}</span>
                </span>
                <span className={`au-pill au-pill--${s.tone}`}>{s.badge}</span>
              </li>
            ))
          )}
        </ul>
      </FoldPanel>

      <FoldPanel
        storageKey="control-deck.conductor.fold.keyboard"
        defaultOpen={false}
        label="Keyboard"
        counter="4"
        className="au-panel--inset"
      >
        <div className="cdt-cmds">
          <CmdRow k="space" v="PTT" />
          <CmdRow k="esc" v="stop / interrupt" />
          <CmdRow k="⌘ K" v="command" />
          <CmdRow k="⌘ ," v="settings" />
        </div>
      </FoldPanel>
    </aside>
  );
}

function CmdRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="cdt-cmds__row">
      <span className="cdt-cmds__k">{k}</span>
      <span className="cdt-cmds__v">{v}</span>
    </div>
  );
}

/* ─── Hooks ─────────────────────────────────────────────────────────── */

function useVoiceJobs() {
  const [jobs, setJobs] = useState<VoiceJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/jobs", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `jobs ${res.status}`);
      setJobs((data.jobs ?? []) as VoiceJob[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { jobs, error, refresh };
}

function useVoiceHealth() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/health", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      setSnapshot(data as HealthSnapshot);
    } catch {
      /* tolerated; the satellite renders a "probing" state */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { snapshot, refresh };
}

function useDeviceLabels(inputId: string | null | undefined, outputId: string | null | undefined) {
  const [input, setInput] = useState("System default");
  const [output, setOutput] = useState("System default");

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    void navigator.mediaDevices.enumerateDevices().then((devs) => {
      if (cancelled) return;
      if (inputId) {
        const hit = devs.find((d) => d.kind === "audioinput" && d.deviceId === inputId);
        setInput(hit?.label?.trim() || "System default");
      } else setInput("System default");
      if (outputId) {
        const hit = devs.find((d) => d.kind === "audiooutput" && d.deviceId === outputId);
        setOutput(hit?.label?.trim() || "System default");
      } else setOutput("System default");
    }).catch(() => { /* ignore — labels need permission */ });
    return () => { cancelled = true; };
  }, [inputId, outputId]);

  return { input, output };
}

function useElapsed(running: boolean): number {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      startRef.current = null;
      setMs(0);
      return;
    }
    startRef.current = Date.now();
    const id = window.setInterval(() => {
      if (startRef.current != null) setMs(Date.now() - startRef.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [running]);
  return ms;
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function mapOrbState(state: VoiceSessionApi["state"]): "idle" | "listening" | "thinking" | "speaking" | "error" {
  switch (state) {
    case "listening":
    case "arming":
    case "transcribing":
      return "listening";
    case "thinking":
    case "submitting":
      return "thinking";
    case "speaking":
      return "speaking";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function orbStateLabel(state: VoiceSessionApi["state"]): string {
  switch (state) {
    case "listening":
    case "arming":
      return "LISTENING";
    case "transcribing":
      return "TRANSCRIBING";
    case "submitting":
    case "thinking":
      return "THINKING";
    case "speaking":
      return "SPEAKING";
    case "error":
      return "ERROR";
    default:
      return "READY";
  }
}

function stageHintFor(orbState: "idle" | "listening" | "thinking" | "speaking" | "error"): string {
  switch (orbState) {
    case "listening":
      return "Recording — tap or esc to stop.";
    case "thinking":
      return "Generating reply — tap to cancel.";
    case "speaking":
      return "Tap the orb to interrupt.";
    case "error":
      return "Something failed — tap to reset.";
    default:
      return "Tap · hold space · esc to stop";
  }
}

function pickRunModel(prefs: ReturnType<typeof useDeckSettings>["prefs"]): string {
  if (prefs.routeMode === "cloud") return prefs.cloudModel || prefs.model;
  if (prefs.routeMode === "free") return prefs.remoteModel || prefs.model;
  return prefs.localModel || prefs.model;
}

interface SuggestedItem {
  id: string;
  title: string;
  meta: string;
  badge: string;
  tone: "ok" | "warn" | "err";
}

function buildSuggested(jobs: VoiceJob[], health: HealthSnapshot | null): SuggestedItem[] {
  const items: SuggestedItem[] = [];

  const justFinished = jobs
    .filter((j) => j.status === "succeeded" && j.endedAt && Date.now() - new Date(j.endedAt).getTime() < 10 * 60_000)
    .slice(0, 1);
  for (const j of justFinished) {
    items.push({
      id: `job-${j.id}`,
      title: `${j.engineId ?? j.providerId ?? "voice"} · ${j.jobType} finished`,
      meta: `${minutesAgo(j.endedAt!)}m ago — audition →`,
      badge: "new",
      tone: "ok",
    });
  }

  if (health?.summary.unreachable.length) {
    items.push({
      id: `health-${health.summary.unreachable[0]}`,
      title: `${health.summary.unreachable[0]} unreachable`,
      meta: "fell back to next configured provider",
      badge: "info",
      tone: "warn",
    });
  }

  return items;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenths}`;
}

function exportTurns(turns: VoiceSessionApi["turns"]): void {
  if (typeof window === "undefined") return;
  const md = turns
    .map((t) => `**${t.role}**\n\n${t.content}\n`)
    .join("\n---\n");
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `conductor-${new Date().toISOString().slice(0, 19)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
