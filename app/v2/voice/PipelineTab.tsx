"use client";

/* Pipeline tab — the whole speech-to-speech pipeline as ONE dense settings
   card (design-lab .srow idiom: title+desc left, control inline right). Every
   dropdown is populated with what actually exists: STT/TTS engine sets from the
   schema, LLM models live from the engine (/api/voice/llm-models), synthesis
   voices enumerated per active TTS engine plus the user's saved library voices.
   A pipeline strip up top renders the ACTIVE running config; its status dot
   opens a diagnostics drawer (the old Timing/Health tabs, folded in). Apply
   keeps the store's two-phase validate -> restart flow. A collapsible mic-check
   strip at the bottom is a test probe wired to the real voice session. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAudioDevices } from "@/lib/audio/use-audio-devices";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import {
  AGENT_LLM_BASE_URL,
  DEFAULT_LAUNCH_CONFIG,
  LLM_ENDPOINT_OPTIONS,
  REDACTED_SECRET,
  STT_BACKENDS,
  TTS_BACKENDS,
  deriveLlmEndpoint,
  useLabStore,
  type LaunchConfigKey,
  type LlmPreset,
  type TtsBackend,
  type VoiceLabConfig,
} from "@/lib/voice-lab/store";

import { Ico, MIC, MIC_OFF, PLAY, REFRESH, ROTATE, CHEVRON, ARROW } from "./icons";

const XMARK = '<path d="M18 6L6 18M6 6l12 12"/>';

/* ── engine-known voice sets ─────────────────────────────────────────────────
   qwen3 CustomVoice speaker presets are discovered from the model at runtime
   (get_supported_speakers); this is the documented default set. kokoro + pocket
   ids are the real enumerated voice packs from the s2s handlers. */
const QWEN3_SPEAKERS = ["Aiden", "Chelsie", "Ethan", "Serena"] as const;
const KOKORO_VOICES = [
  "bm_fable", "bm_george", "bm_daniel", "bm_lewis",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_nova", "af_aoede", "af_kore",
  "am_adam", "am_michael", "am_eric", "am_liam", "am_onyx", "am_echo", "am_fenrir", "am_puck",
] as const;
const POCKET_VOICES = ["jean", "alba", "marius", "javert", "fantine", "cosette", "eponine", "azelma"] as const;

/** Which LaunchConfig key holds the selectable voice for a given TTS engine. */
const VOICE_KEY_BY_TTS: Partial<Record<TtsBackend, LaunchConfigKey>> = {
  qwen3: "qwen3_tts_speaker",
  kokoro: "kokoro_voice",
  pocket: "pocket_tts_voice",
};

function engineVoices(tts: TtsBackend): readonly string[] {
  if (tts === "qwen3") return QWEN3_SPEAKERS;
  if (tts === "kokoro") return KOKORO_VOICES;
  if (tts === "pocket") return POCKET_VOICES;
  return [];
}

interface LibraryVoice { id: string; label: string; kind: string; providerId: string | null }
interface LocalRef { name: string; path: string; refText: string; size: number; createdAt: string }

interface RuntimeDiag {
  transport: { mode: string; sidecar: "ok" | "unreachable" | "unknown"; wsUrl: string | null };
  providers: Array<{ id: string; name: string; role: string; configured: boolean; reachable: boolean }>;
}

type Dot = "positive" | "caution" | "danger" | "idle";
function stateDot(state: string): Dot {
  if (state === "running") return "positive";
  if (state === "starting") return "caution";
  if (state === "error") return "danger";
  return "idle";
}

export function PipelineTab() {
  const store = useLabStore();
  const {
    activeConfig,
    activeRedactions,
    applying,
    availableModels,
    dirty,
    editedSecrets,
    error,
    knobs,
    llmPreset,
    loadStatus,
    modelsLoading,
    modelsReachable,
    pipelineState,
    refreshModels,
    resetToActive,
    resetToDefaults,
    setKnob,
    setLlmPreset,
    status,
    applyConfig,
  } = store;

  const [diagOpen, setDiagOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [micOpen, setMicOpen] = useState(false);
  const [supStarting, setSupStarting] = useState(false);
  const [supErr, setSupErr] = useState<string | null>(null);

  const dot = stateDot(pipelineState);

  // supervisor down: the status poll itself couldn't reach the supervisor
  // (proxy 502 -> LOAD_STATUS_ERROR sets pipelineState "error" and never a
  // fresh status). A reachable supervisor reporting a failed pipeline sets
  // pipelineState "error" too, but with status.state === "failed" from a
  // successful poll — that case wants start_pipeline, not start_supervisor.
  const supervisorOffline = pipelineState === "error" && status?.state !== "failed";
  const pipelineStopped = !!status && (status.state === "stopped" || status.state === "failed");

  // Start the supervisor process, then poll its status for up to 60s. Once it
  // answers, the store's own 4s poll surfaces the (stopped) pipeline and the
  // start_pipeline bar appears; loadStatus() forces that refresh immediately.
  const startSupervisor = useCallback(async () => {
    setSupErr(null);
    setSupStarting(true);
    try {
      const res = await fetch("/api/voice/lab-start", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `start failed: ${res.status}`);
      const deadline = Date.now() + 60_000;
      let up = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3_000));
        try {
          const probe = await fetch("/api/voice/lab/status", { cache: "no-store" });
          if (probe.ok) {
            up = true;
            break;
          }
        } catch {
          /* keep polling until the deadline */
        }
      }
      await loadStatus();
      if (!up) {
        setSupErr("Supervisor did not come online within 60s. Check the s2s repo logs, then retry.");
      }
    } catch (e) {
      setSupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSupStarting(false);
    }
  }, [loadStatus]);

  const startPipeline = useCallback(() => void applyConfig(), [applyConfig]);

  return (
    <div className="pipe">
      <PipelineStrip
        activeConfig={activeConfig}
        dot={dot}
        pipelineState={pipelineState}
        open={diagOpen}
        onToggle={() => setDiagOpen((o) => !o)}
      />
      {diagOpen ? (
        <Diagnostics
          status={status}
          supervisorOffline={supervisorOffline}
          pipelineStopped={pipelineStopped}
          supStarting={supStarting}
          applying={applying}
          onStartSupervisor={() => void startSupervisor()}
          onStartPipeline={startPipeline}
        />
      ) : null}

      <div className="group">
        <div className="glabel">Engine</div>
        <div className="card panel">
          {/* STT */}
          <SelectRow
            title="Transcription (STT)"
            desc="Speech-to-text engine that runs before every turn."
            value={knobs.stt}
            options={STT_BACKENDS}
            onChange={(v) => setKnob("stt", v)}
          />

          {/* LLM endpoint */}
          <SelectRow
            title="LLM endpoint"
            desc="Where assistant turns are generated. Populated with the engines the deck knows."
            value={llmPreset}
            options={LLM_ENDPOINT_OPTIONS.map((o) => o.id)}
            labels={Object.fromEntries(LLM_ENDPOINT_OPTIONS.map((o) => [o.id, o.label]))}
            onChange={(v) => setLlmPreset(v as LlmPreset)}
          />

          {/* served model */}
          <ModelRow
            preset={llmPreset}
            modelName={typeof knobs.model_name === "string" ? knobs.model_name : ""}
            models={availableModels}
            modelsLoading={modelsLoading}
            modelsReachable={modelsReachable}
            onModelChange={(m) => setKnob("model_name", m)}
            onRefresh={refreshModels}
          />

          {/* custom endpoint URL + api key — only when the endpoint needs them */}
          {llmPreset === "custom" ? (
            <>
              <TextRow
                title="Endpoint URL"
                desc="OpenAI-compatible /v1 base URL for the custom endpoint."
                value={strOf(knobs.responses_api_base_url)}
                placeholder="http://host:port/v1"
                onChange={(v) => setKnob("responses_api_base_url", v)}
              />
              <ApiKeyRow
                value={strOf(knobs.responses_api_api_key)}
                activeRedacted={activeRedactions.responses_api_api_key}
                editedSecret={editedSecrets.responses_api_api_key}
                onChange={(v) => setKnob("responses_api_api_key", v)}
              />
            </>
          ) : null}

          {/* TTS engine */}
          <SelectRow
            title="Synthesis (TTS)"
            desc="Text-to-speech engine for the assistant's spoken reply."
            value={knobs.tts}
            options={TTS_BACKENDS}
            onChange={(v) => setKnob("tts", v as TtsBackend)}
          />

          {/* Voice */}
          <VoiceRow
            tts={knobs.tts}
            value={voiceValue(knobs)}
            onChange={(v) => setVoice(setKnob, knobs.tts, v)}
            refAudio={strOf(knobs.qwen3_tts_ref_audio)}
            onStageRef={(ref) => {
              setKnob("qwen3_tts_ref_audio", ref.path);
              setKnob("qwen3_tts_ref_text", ref.refText);
            }}
            onClearRef={() => {
              setKnob("qwen3_tts_ref_audio", null);
              setKnob("qwen3_tts_ref_text", null);
            }}
          />

          {/* Temperature */}
          <RangeRow
            title="Temperature"
            desc="Sampling spread. 0 is deterministic; higher is more varied."
            value={numOf(knobs.llm_gen_temperature, 0)}
            min={0}
            max={2}
            step={0.05}
            format={(n) => n.toFixed(2)}
            onChange={(n) => setKnob("llm_gen_temperature", n)}
          />

          {/* Response length */}
          <RangeRow
            title="Response length"
            desc="Max new tokens per turn — trades answer length against speech delay."
            value={numOf(knobs.llm_gen_max_new_tokens, 96)}
            min={1}
            max={8192}
            step={1}
            format={(n) => `${Math.round(n)} tok`}
            onChange={(n) => setKnob("llm_gen_max_new_tokens", Math.round(n))}
          />

          {/* Sentence batching */}
          <StepperRow
            title="Sentence batching"
            desc="Sentences buffered before speech starts. Lower = the voice begins sooner."
            value={numOf(knobs.stream_batch_sentences, 1)}
            min={1}
            max={20}
            onChange={(n) => setKnob("stream_batch_sentences", n)}
          />

          {/* Live transcription */}
          <div className="srow">
            <span className="st">
              <b>Live transcription</b>
              <small>
                {knobs.enable_live_transcription
                  ? `Streams partial text every ${numOf(knobs.live_transcription_update_interval, 0.5)}s while you speak.`
                  : "Partial transcripts are hidden until the turn completes."}
              </small>
            </span>
            <div className="ctlwrap">
              <label className="ctl">
                <input
                  type="checkbox"
                  checked={knobs.enable_live_transcription === true}
                  onChange={(e) => setKnob("enable_live_transcription", e.target.checked)}
                />
                <span className="ctl__track" />
              </label>
            </div>
          </div>

          {/* Voice prompt — expands into a textarea */}
          <div className="srow srow--stack">
            <button
              type="button"
              className="promptrow"
              aria-expanded={promptOpen}
              onClick={() => setPromptOpen((o) => !o)}
            >
              <span className="st">
                <b>Voice prompt</b>
                <small>{summarize(strOf(knobs.init_chat_prompt))}</small>
              </span>
              <span className="ctlwrap">
                <span className="meta">{strOf(knobs.init_chat_prompt).length} chars</span>
                <Ico d={CHEVRON} cls={`ic chev-toggle${promptOpen ? " is-open" : ""}`} />
              </span>
            </button>
            {promptOpen ? (
              <textarea
                className="field__input promptarea"
                aria-label="Initial chat prompt"
                value={strOf(knobs.init_chat_prompt)}
                onChange={(e) => setKnob("init_chat_prompt", e.target.value)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* supervisor-down errors get an actionable bar below, not a bare chip */}
      {error && !supervisorOffline ? <div className="err-chip">{error}</div> : null}

      {/* one sticky bar, chosen by state: start supervisor > apply edits >
          start a reachable-but-stopped pipeline. */}
      {supervisorOffline ? (
        <div className="applybar">
          <span className="applybar-left">
            <span className="sdot sdot--danger" />
            <span className="meta">
              {supErr ?? "Voice Lab supervisor is offline — nothing is listening for turns."}
            </span>
          </span>
          <span className="applybar-right">
            <button className="btn btn--primary" type="button" disabled={supStarting} onClick={() => void startSupervisor()}>
              {supStarting ? "starting…" : "start_supervisor"}
            </button>
          </span>
        </div>
      ) : dirty ? (
        <div className="applybar">
          <span className="applybar-left">
            <span className="sdot sdot--caution" />
            <span className="meta">Differs from the active pipeline config.</span>
          </span>
          <span className="applybar-right">
            <button className="btn btn--sm" type="button" disabled={applying} onClick={resetToActive}>
              reset active
            </button>
            <button className="btn btn--sm" type="button" disabled={applying} onClick={resetToDefaults}>
              reset defaults
            </button>
            <button
              className="btn btn--primary"
              type="button"
              disabled={applying}
              onClick={() => void applyConfig()}
            >
              {applying ? `applying (${pipelineState})` : "Validate & Apply"}
            </button>
          </span>
        </div>
      ) : pipelineStopped ? (
        <div className="applybar">
          <span className="applybar-left">
            <span className={`sdot${status?.state === "failed" ? " sdot--danger" : ""}`} />
            <span className="meta">
              {status?.state === "failed" ? "Pipeline failed — restart to recover." : "Pipeline stopped."}
            </span>
          </span>
          <span className="applybar-right">
            <button className="btn btn--primary" type="button" disabled={applying} onClick={startPipeline}>
              {applying ? `starting (${pipelineState})` : "start_pipeline"}
            </button>
          </span>
        </div>
      ) : null}

      {/* mic check — hidden behind a toggle; a probe, not a hero */}
      <div className="miccheck">
        <button
          type="button"
          className="miccheck-toggle"
          aria-expanded={micOpen}
          onClick={() => setMicOpen((o) => !o)}
        >
          <Ico d={CHEVRON} cls={`ic chev-toggle${micOpen ? " is-open" : ""}`} />
          Mic check <span className="meta">quick sanity call on the active engines</span>
        </button>
        {micOpen ? <MicCheck /> : null}
      </div>
    </div>
  );
}

/* ── pipeline strip ─────────────────────────────────────────────────────────── */
function PipelineStrip({
  activeConfig,
  dot,
  pipelineState,
  open,
  onToggle,
}: {
  activeConfig: VoiceLabConfig;
  dot: Dot;
  pipelineState: string;
  open: boolean;
  onToggle: () => void;
}) {
  const endpoint = deriveLlmEndpoint(activeConfig.responses_api_base_url, AGENT_LLM_BASE_URL);
  const endpointLabel = LLM_ENDPOINT_OPTIONS.find((o) => o.id === endpoint)?.label ?? endpoint;
  const voice = voiceValue(activeConfig) || "default";
  return (
    <div className="strip">
      <div className="strip-chips">
        <span className="pchip"><i>stt</i><b>{activeConfig.stt}</b></span>
        <Ico d={ARROW} cls="ic strip-arrow" />
        <span className="pchip"><i>llm</i><b>{activeConfig.model_name}</b><em>@ {endpointLabel}</em></span>
        <Ico d={ARROW} cls="ic strip-arrow" />
        <span className="pchip"><i>tts</i><b>{activeConfig.tts}</b><em>· {voice}</em></span>
      </div>
      <button
        type="button"
        className={`stripdot stripdot--${dot}${open ? " is-open" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
        title="Pipeline diagnostics"
      >
        <span className="sdot" />
        <span className="mono">{pipelineState}</span>
      </button>
    </div>
  );
}

/* ── diagnostics drawer (replaces Timing + Health tabs) ───────────────────────── */
function Diagnostics({
  status,
  supervisorOffline,
  pipelineStopped,
  supStarting,
  applying,
  onStartSupervisor,
  onStartPipeline,
}: {
  status: ReturnType<typeof useLabStore>["status"];
  supervisorOffline: boolean;
  pipelineStopped: boolean;
  supStarting: boolean;
  applying: boolean;
  onStartSupervisor: () => void;
  onStartPipeline: () => void;
}) {
  const [diag, setDiag] = useState<RuntimeDiag | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const session = useVoiceSession({ enabled: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/voice/runtime", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `runtime request failed: ${res.status}`);
      setDiag(data as RuntimeDiag);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sidecarTone: Dot =
    diag?.transport.sidecar === "ok" ? "positive" : diag?.transport.sidecar === "unreachable" ? "danger" : "idle";
  const firstAudio = session.latency.firstAudioMs;
  const sidecarBroken = supervisorOffline || pipelineStopped || diag?.transport.sidecar === "unreachable";

  // sidecar recovery: bring the supervisor up first, else (re)start the pipeline.
  const sidecarAction = supervisorOffline ? (
    <button className="btn btn--sm btn--primary" type="button" disabled={supStarting} onClick={onStartSupervisor}>
      {supStarting ? "starting…" : "start_supervisor"}
    </button>
  ) : sidecarBroken ? (
    <button className="btn btn--sm btn--primary" type="button" disabled={applying} onClick={onStartPipeline}>
      {applying ? "starting…" : "start_pipeline"}
    </button>
  ) : null;

  return (
    <div className="card panel diag">
      <div className="diag-head">
        <span className="mono-up">diagnostics</span>
        <button className="btn btn--sm" type="button" onClick={() => void load()} disabled={loading}>
          <Ico d={REFRESH} cls={`ic${loading ? " spin" : ""}`} />refresh
        </button>
      </div>

      {err ? <div className="err-chip">{err}</div> : null}

      <div className="diag-rows">
        <DiagRow
          label="sidecar"
          tone={supervisorOffline ? "danger" : sidecarTone}
          value={
            supervisorOffline
              ? "supervisor offline"
              : diag
                ? `${diag.transport.sidecar} · ${diag.transport.mode}`
                : loading
                  ? "probing…"
                  : "—"
          }
          action={sidecarAction}
        />
        {(diag?.providers ?? [])
          .filter((p) => p.role === "stt" || p.role === "tts")
          .map((p) => (
            <DiagRow
              key={`${p.role}-${p.id}`}
              label={p.role}
              tone={p.reachable ? "positive" : p.configured ? "danger" : "idle"}
              value={`${p.name} · ${p.reachable ? "reachable" : p.configured ? "unreachable" : "unconfigured"}`}
              action={
                p.reachable ? null : (
                  <a className="diag-link" href="/v2/models">
                    bind →
                  </a>
                )
              }
            />
          ))}
        <DiagRow
          label="pipeline"
          tone={stateDot(status ? status.state : "stopped")}
          value={status ? `${status.state}${status.pid ? ` · pid ${status.pid}` : ""}` : "—"}
        />
        <DiagRow
          label="last turn"
          tone="idle"
          value={typeof firstAudio === "number" ? `first audio ${Math.round(firstAudio)} ms` : "no session run yet"}
        />
      </div>
    </div>
  );
}

function DiagRow({
  label,
  tone,
  value,
  action,
}: {
  label: string;
  tone: Dot;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="diag-row">
      <span className={`tag tag--dot tag--${tone}`}><span className="tdot" />{label}</span>
      <span className="mono diag-val">{value}</span>
      {action ? <span className="diag-act">{action}</span> : null}
    </div>
  );
}

/* ── mic check probe ──────────────────────────────────────────────────────────── */
function MicCheck() {
  const session = useVoiceSession({ enabled: true });
  const devices = useAudioDevices();
  const phase = session.isSpeaking ? "speaking" : session.isListening ? "listening" : "idle";
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty("--vlevel", phase === "idle" ? "0" : session.audioLevel.toFixed(3));
  }, [session.audioLevel, phase]);

  const onMic = useCallback(() => {
    void session.unlockOutput();
    if (session.isInterruptible) { void session.interrupt(); return; }
    if (session.isListening) { void session.stopListening(); return; }
    void session.startListening();
  }, [session]);

  const label = session.isInterruptible ? "interrupt" : session.isListening ? "stop" : "talk";

  return (
    <div className="miccheck-body">
      <div className="mc-stage" data-phase={phase} ref={stageRef}>
        <button type="button" className="mc-ring" onClick={onMic} aria-label={label}>
          <Ico d={session.isListening ? MIC : MIC_OFF} cls="ic" />
        </button>
        <span className="mc-state">{session.stateLabel}</span>
      </div>
      <div className="mc-controls">
        {session.error ? <div className="err-chip">{session.error}</div> : null}
        {devices.permission !== "granted" ? (
          <button className="btn btn--sm" type="button" onClick={() => void devices.requestPermission()}>
            grant mic
          </button>
        ) : (
          <>
            <div className="selectwrap mc-dev">
              <select
                aria-label="Microphone"
                className="field__input"
                value={devices.selectedInputId ?? ""}
                onChange={(e) => devices.setInput(e.target.value || null)}
              >
                <option value="">default mic</option>
                {devices.inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `mic ${d.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
              <Ico d={CHEVRON} cls="ic chev" />
            </div>
            {devices.outputSelectionAvailable && devices.outputs.length > 0 ? (
              <div className="selectwrap mc-dev">
                <select
                  aria-label="Speaker"
                  className="field__input"
                  value={devices.selectedOutputId ?? ""}
                  onChange={(e) => devices.setOutput(e.target.value || null)}
                >
                  <option value="">default out</option>
                  {devices.outputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `out ${d.deviceId.slice(0, 6)}`}</option>
                  ))}
                </select>
                <Ico d={CHEVRON} cls="ic chev" />
              </div>
            ) : null}
          </>
        )}
        <button className="btn btn--sm" type="button" onClick={onMic}>
          <Ico d={session.isListening ? MIC : MIC_OFF} />{label}
        </button>
      </div>
    </div>
  );
}

/* ── reusable rows ───────────────────────────────────────────────────────────── */
function SelectRow({
  title,
  desc,
  value,
  options,
  labels,
  onChange,
}: {
  title: string;
  desc: string;
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="srow">
      <span className="st"><b>{title}</b><small>{desc}</small></span>
      <div className="ctlwrap">
        <div className="selectwrap">
          <select className="field__input" value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>{labels?.[o] ?? o}</option>
            ))}
          </select>
          <Ico d={CHEVRON} cls="ic chev" />
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  preset,
  modelName,
  models,
  modelsLoading,
  modelsReachable,
  onModelChange,
  onRefresh,
}: {
  preset: LlmPreset;
  modelName: string;
  models: string[];
  modelsLoading: boolean;
  modelsReachable: boolean | null;
  onModelChange: (m: string) => void;
  onRefresh: () => void;
}) {
  const option = LLM_ENDPOINT_OPTIONS.find((o) => o.id === preset);
  const isEngine = Boolean(option?.provider);
  const modelInList = models.includes(modelName);
  const unreachable = isEngine && modelsReachable === false && !modelsLoading;

  return (
    <div className="srow">
      <span className="st">
        <b>Served model</b>
        <small>
          {preset === "agent"
            ? "The deck's router picks the model for agent turns."
            : isEngine
              ? unreachable
                ? "Engine unreachable — start it, then refresh, or type a model id."
                : "Models served right now by the selected engine."
              : "Model id sent to the custom endpoint."}
        </small>
      </span>
      <div className="ctlwrap">
        {preset === "agent" ? (
          <span className="tag">router-managed</span>
        ) : isEngine && !unreachable ? (
          <>
            <div className="selectwrap">
              <select
                className="field__input"
                aria-label="Served model"
                value={modelInList ? modelName : ""}
                onChange={(e) => { if (e.target.value) onModelChange(e.target.value); }}
              >
                {!modelInList ? (
                  <option value="" disabled>
                    {modelsLoading ? "loading…" : modelName ? `${modelName} (not served)` : "pick a model"}
                  </option>
                ) : null}
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Ico d={CHEVRON} cls="ic chev" />
            </div>
            <button className="btn btn--icon btn--sm" type="button" title="Refresh model list" onClick={onRefresh}>
              <Ico d={REFRESH} cls={`ic${modelsLoading ? " spin" : ""}`} />
            </button>
          </>
        ) : (
          <>
            {unreachable ? <span className="tag tag--danger">unreachable</span> : null}
            <input
              className="field__input model-in"
              aria-label="Model id"
              placeholder="model id"
              value={modelName}
              onChange={(e) => onModelChange(e.target.value)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function VoiceRow({
  tts,
  value,
  onChange,
  refAudio,
  onStageRef,
  onClearRef,
}: {
  tts: TtsBackend;
  value: string;
  onChange: (v: string) => void;
  refAudio: string;
  onStageRef: (ref: LocalRef) => void;
  onClearRef: () => void;
}) {
  const engineSet = engineVoices(tts);
  const [lib, setLib] = useState<LibraryVoice[]>([]);
  const [refs, setRefs] = useState<LocalRef[]>([]);
  const [configured, setConfigured] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [playErrBind, setPlayErrBind] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/voice/library", { cache: "no-store" });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const assets = Array.isArray(data?.assets) ? data.assets : [];
        setLib(
          assets
            .filter((a: { status?: string }) => a.status !== "archived")
            .map(
              (a: {
                defaultVoiceId?: string | null;
                slug?: string;
                name: string;
                kind?: string;
                providerId?: string | null;
              }) => ({
                id: a.defaultVoiceId || a.slug || a.name,
                label: a.name,
                kind: a.kind ?? "cloned",
                providerId: a.providerId ?? null,
              }),
            ),
        );
      } catch {
        /* library is optional — no saved voices is a valid empty state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Usability oracle for cloud voices: runtime provider matrix (role tts, configured).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/voice/runtime", { cache: "no-store" });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const matrix: Array<{ id: string; role: string; configured: boolean }> = Array.isArray(data?.providers)
          ? data.providers
          : [];
        setConfigured(new Set(matrix.filter((p) => p.role === "tts" && p.configured).map((p) => p.id)));
      } catch {
        /* unknown usability — cloud voices stay hidden (local-first) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Local Qwen3 refs — only relevant when qwen3 is the active engine.
  useEffect(() => {
    if (tts !== "qwen3") {
      setRefs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/voice/refs", { cache: "no-store" });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setRefs(Array.isArray(data?.refs) ? data.refs : []);
      } catch {
        /* refs optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tts, refAudio]);

  // Cloud voices are shown only when their provider key is bound.
  const cloudLib = lib.filter((v) => !v.providerId || configured.has(v.providerId));

  const play = useCallback(async () => {
    setPlayErr(null);
    setPlayErrBind(false);
    setPlaying(true);
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "This is how the selected voice sounds.", engine: tts, voice: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // 503 = no cloud TTS provider bound; the preview path needs one.
        if (res.status === 503) setPlayErrBind(true);
        throw new Error(data?.error || `play failed: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      await audioRef.current.play();
    } catch (e) {
      setPlayErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaying(false);
    }
  }, [tts, value]);

  // Qwen3 with a staged reference clip — show the clone, offer a revert.
  if (tts === "qwen3" && refAudio) {
    const clonedName = refs.find((r) => r.path === refAudio)?.name ?? refAudio.split("/").pop() ?? "reference";
    return (
      <div className="srow">
        <span className="st">
          <b>Voice</b>
          <small>Cloning from a local reference clip — preset speakers are bypassed.</small>
        </span>
        <div className="ctlwrap">
          <span className="tag tag--positive">cloned · {clonedName}</span>
          <button
            className="btn btn--icon btn--sm"
            type="button"
            title="revert to preset speakers"
            aria-label="revert to preset speakers"
            onClick={onClearRef}
          >
            <Ico d={XMARK} />
          </button>
        </div>
      </div>
    );
  }

  const hasVoiceControl = engineSet.length > 0 || refs.length > 0 || cloudLib.length > 0;
  const inEngineSet = (engineSet as readonly string[]).includes(value);
  const inLib = cloudLib.some((v) => v.id === value);

  const onSelect = (v: string) => {
    if (v.startsWith("ref:")) {
      const ref = refs.find((r) => r.path === v.slice(4));
      if (ref) onStageRef(ref);
      return;
    }
    onChange(v);
  };

  return (
    <div className="srow">
      <span className="st">
        <b>Voice</b>
        <small>
          {hasVoiceControl
            ? "Local speakers and reference clones first; saved cloud voices below."
            : `${tts} has no selectable voice — it uses its built-in output.`}
        </small>
        {hasVoiceControl ? (
          <small className="mono voice-hint">preview via cloud voice — actual engine may differ</small>
        ) : null}
        {playErr ? (
          <small className="danger-text">
            {playErr}
            {playErrBind ? (
              <>
                {" "}
                <a className="diag-link" href="/v2/models">bind tts provider →</a>
              </>
            ) : null}
          </small>
        ) : null}
      </span>
      <div className="ctlwrap">
        {hasVoiceControl ? (
          <>
            <div className="selectwrap">
              <select className="field__input" aria-label="Voice" value={value} onChange={(e) => onSelect(e.target.value)}>
                {!inEngineSet && !inLib && value ? <option value={value}>{value}</option> : null}
                {engineSet.length ? (
                  <optgroup label="engine speakers">
                    {engineSet.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </optgroup>
                ) : null}
                {refs.length ? (
                  <optgroup label="local refs">
                    {refs.map((r) => (
                      <option key={r.path} value={`ref:${r.path}`}>{r.name}</option>
                    ))}
                  </optgroup>
                ) : null}
                {cloudLib.length ? (
                  <optgroup label="saved cloud voices">
                    {cloudLib.map((v) => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <Ico d={CHEVRON} cls="ic chev" />
            </div>
            <button
              className="btn btn--icon btn--sm"
              type="button"
              title="preview via cloud voice — actual engine may differ"
              disabled={playing || !value}
              onClick={() => void play()}
            >
              <Ico d={PLAY} cls={`ic${playing ? " spin" : ""}`} />
            </button>
          </>
        ) : (
          <span className="tag">engine default</span>
        )}
      </div>
    </div>
  );
}

function TextRow({
  title,
  desc,
  value,
  placeholder,
  onChange,
}: {
  title: string;
  desc: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="srow">
      <span className="st"><b>{title}</b><small>{desc}</small></span>
      <div className="ctlwrap">
        <input className="field__input text-in" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function ApiKeyRow({
  value,
  activeRedacted,
  editedSecret,
  onChange,
}: {
  value: string;
  activeRedacted: boolean;
  editedSecret: boolean;
  onChange: (v: string) => void;
}) {
  const showRedacted = activeRedacted && !editedSecret;
  const display = value === REDACTED_SECRET ? "" : value;
  return (
    <div className="srow">
      <span className="st">
        <b>API key</b>
        <small>{showRedacted ? "Active key is redacted — leave blank to keep it." : "Key for the custom endpoint."}</small>
      </span>
      <div className="ctlwrap">
        <input
          className="field__input text-in"
          type="password"
          autoComplete="off"
          placeholder={showRedacted ? "unchanged redacted key" : ""}
          value={showRedacted ? "" : display}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function RangeRow({
  title,
  desc,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  title: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="srow">
      <span className="st"><b>{title}</b><small>{desc}</small></span>
      <div className="ctlwrap rng">
        <input
          className="rng__in"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="rng__val">{format(value)}</span>
      </div>
    </div>
  );
}

function StepperRow({
  title,
  desc,
  value,
  min,
  max,
  onChange,
}: {
  title: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="srow">
      <span className="st"><b>{title}</b><small>{desc}</small></span>
      <div className="ctlwrap">
        <div className="stepper">
          <button className="btn btn--sm" type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>−</button>
          <input
            className="field__input"
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(clamp(n)); }}
          />
          <button className="btn btn--sm" type="button" onClick={() => onChange(clamp(value + 1))} disabled={value >= max}>+</button>
        </div>
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────────── */
function strOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function numOf(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function voiceValue(config: VoiceLabConfig): string {
  const key = VOICE_KEY_BY_TTS[config.tts];
  if (!key) return "";
  return strOf(config[key]);
}
function setVoice(
  setKnob: (key: LaunchConfigKey, value: VoiceLabConfig[LaunchConfigKey]) => void,
  tts: TtsBackend,
  v: string,
) {
  const key = VOICE_KEY_BY_TTS[tts];
  if (key) setKnob(key, v);
}
function summarize(prompt: string): string {
  const p = prompt.trim() || (DEFAULT_LAUNCH_CONFIG.init_chat_prompt as string);
  return p.length > 68 ? `${p.slice(0, 68)}…` : p;
}
