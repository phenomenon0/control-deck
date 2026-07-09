"use client";

/**
 * s2s Voice Lab store.
 *
 * The browser talks only to `/api/voice/lab/*`; that proxy forwards to the
 * local speech-to-speech Voice Lab supervisor. Knobs intentionally mirror the
 * supervisor's LaunchConfig field names so the apply path is a strict
 * validate -> restart with no voice-core compatibility layer.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";

import type { ProbeReport } from "@/lib/voice/test-harness/latency-probe";

export const LAB_STATUS_POLL_MS = 4_000;
export const AGENT_LLM_BASE_URL = "http://localhost:3333/api/voice/agent-bridge/default/v1";
export const DEFAULT_DIRECT_LLM_BASE_URL = "http://127.0.0.1:11434/v1";

export const STT_BACKENDS = [
  "whisper",
  "whisper-mlx",
  "mlx-audio-whisper",
  "faster-whisper",
  "parakeet-tdt",
  "paraformer",
] as const;
export type SttBackend = (typeof STT_BACKENDS)[number];

export const LLM_BACKENDS = ["transformers", "mlx-lm", "responses-api", "chat-completions"] as const;
export type LlmBackend = (typeof LLM_BACKENDS)[number];

export const TTS_BACKENDS = ["chatTTS", "facebookMMS", "pocket", "kokoro", "qwen3"] as const;
export type TtsBackend = (typeof TTS_BACKENDS)[number];

export const LOG_LEVELS = ["debug", "info", "warning", "error", "critical"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const QWEN3_TTS_BACKENDS = ["ggml", "torch"] as const;
export type Qwen3TtsBackend = (typeof QWEN3_TTS_BACKENDS)[number];

export type LlmPreset = "agent" | "direct";
export type PipelineState = "stopped" | "starting" | "running" | "error";

export interface LabKnobs {
  worker_host: string;
  worker_port: number;
  device: string | null;
  log_level: LogLevel;

  stt: SttBackend;
  llm_backend: LlmBackend;
  tts: TtsBackend;

  enable_live_transcription: boolean;
  live_transcription_update_interval: number;

  init_chat_prompt: string;
  chat_size: number;
  stream_batch_sentences: number;
  compact_history: boolean;

  model_name: string;
  responses_api_base_url: string;
  responses_api_api_key: string;
  responses_api_stream: boolean;
  responses_api_disable_thinking: boolean;
  llm_gen_max_new_tokens: number;
  llm_gen_temperature: number;
  llm_gen_do_sample: boolean;

  stt_language: string | null;
  parakeet_tdt_model_name: string | null;
  parakeet_tdt_device: string;

  qwen3_tts_backend: Qwen3TtsBackend;
  qwen3_tts_speaker: string | null;
  qwen3_tts_language: string;
  qwen3_tts_streaming_chunk_size: number | null;
  qwen3_tts_non_streaming_mode: boolean | null;
  qwen3_tts_mlx_quantization: string | null;

  kokoro_voice: string;
  kokoro_speed: number;
  tts_language: string;
}

const LOCAL_VOICE_PROMPT =
  "You are a fast local voice assistant. Answer naturally in one or two short sentences. " +
  "Avoid lists unless asked.";

export const DEFAULT_KNOBS: LabKnobs = {
  worker_host: "127.0.0.1",
  worker_port: 8765,
  device: "cuda",
  log_level: "info",

  stt: "parakeet-tdt",
  llm_backend: "chat-completions",
  tts: "qwen3",

  enable_live_transcription: true,
  live_transcription_update_interval: 0.5,

  init_chat_prompt: LOCAL_VOICE_PROMPT,
  chat_size: 16,
  stream_batch_sentences: 1,
  compact_history: false,

  model_name: "qwen3.5:latest",
  responses_api_base_url: DEFAULT_DIRECT_LLM_BASE_URL,
  responses_api_api_key: "local-not-needed",
  responses_api_stream: true,
  responses_api_disable_thinking: true,
  llm_gen_max_new_tokens: 96,
  llm_gen_temperature: 0,
  llm_gen_do_sample: false,

  stt_language: null,
  parakeet_tdt_model_name: "nvidia/parakeet-tdt-0.6b-v3",
  parakeet_tdt_device: "auto",

  qwen3_tts_backend: "ggml",
  qwen3_tts_speaker: "Aiden",
  qwen3_tts_language: "auto",
  qwen3_tts_streaming_chunk_size: 8,
  qwen3_tts_non_streaming_mode: true,
  qwen3_tts_mlx_quantization: "6bit",

  kokoro_voice: "bm_fable",
  kokoro_speed: 1,
  tts_language: "en",
};

type LaunchConfigKey =
  | "mode"
  | "worker_host"
  | "worker_port"
  | "device"
  | "num_pipelines"
  | "log_level"
  | "stt"
  | "llm_backend"
  | "tts"
  | "enable_live_transcription"
  | "live_transcription_update_interval"
  | "init_chat_prompt"
  | "chat_size"
  | "stream_batch_sentences"
  | "compact_history"
  | "model_name"
  | "responses_api_base_url"
  | "responses_api_api_key"
  | "responses_api_stream"
  | "responses_api_disable_thinking"
  | "llm_device"
  | "llm_torch_dtype"
  | "llm_gen_max_new_tokens"
  | "llm_gen_temperature"
  | "llm_gen_do_sample"
  | "stt_model_name"
  | "stt_device"
  | "stt_language"
  | "faster_whisper_stt_model_name"
  | "faster_whisper_stt_device"
  | "mlx_audio_whisper_model_name"
  | "paraformer_stt_model_name"
  | "paraformer_stt_device"
  | "parakeet_tdt_model_name"
  | "parakeet_tdt_device"
  | "parakeet_tdt_language"
  | "qwen3_tts_model_name"
  | "qwen3_tts_device"
  | "qwen3_tts_backend"
  | "qwen3_tts_speaker"
  | "qwen3_tts_language"
  | "qwen3_tts_streaming_chunk_size"
  | "qwen3_tts_non_streaming_mode"
  | "qwen3_tts_mlx_quantization"
  | "kokoro_model_name"
  | "kokoro_device"
  | "kokoro_voice"
  | "kokoro_lang_code"
  | "kokoro_speed"
  | "pocket_tts_device"
  | "pocket_tts_voice"
  | "facebook_mms_model_name"
  | "facebook_mms_device"
  | "tts_language"
  | "chat_tts_device";

const LAUNCH_CONFIG_KEYS: readonly LaunchConfigKey[] = [
  "mode",
  "worker_host",
  "worker_port",
  "device",
  "num_pipelines",
  "log_level",
  "stt",
  "llm_backend",
  "tts",
  "enable_live_transcription",
  "live_transcription_update_interval",
  "init_chat_prompt",
  "chat_size",
  "stream_batch_sentences",
  "compact_history",
  "model_name",
  "responses_api_base_url",
  "responses_api_api_key",
  "responses_api_stream",
  "responses_api_disable_thinking",
  "llm_device",
  "llm_torch_dtype",
  "llm_gen_max_new_tokens",
  "llm_gen_temperature",
  "llm_gen_do_sample",
  "stt_model_name",
  "stt_device",
  "stt_language",
  "faster_whisper_stt_model_name",
  "faster_whisper_stt_device",
  "mlx_audio_whisper_model_name",
  "paraformer_stt_model_name",
  "paraformer_stt_device",
  "parakeet_tdt_model_name",
  "parakeet_tdt_device",
  "parakeet_tdt_language",
  "qwen3_tts_model_name",
  "qwen3_tts_device",
  "qwen3_tts_backend",
  "qwen3_tts_speaker",
  "qwen3_tts_language",
  "qwen3_tts_streaming_chunk_size",
  "qwen3_tts_non_streaming_mode",
  "qwen3_tts_mlx_quantization",
  "kokoro_model_name",
  "kokoro_device",
  "kokoro_voice",
  "kokoro_lang_code",
  "kokoro_speed",
  "pocket_tts_device",
  "pocket_tts_voice",
  "facebook_mms_model_name",
  "facebook_mms_device",
  "tts_language",
  "chat_tts_device",
];

export type VoiceLabLaunchConfig = Record<LaunchConfigKey, unknown> & {
  mode: "realtime";
  worker_host: string;
  worker_port: number;
  num_pipelines: 1;
  stt: SttBackend;
  llm_backend: LlmBackend;
  tts: TtsBackend;
  responses_api_base_url: string;
};

const DEFAULT_LAUNCH_CONFIG: VoiceLabLaunchConfig = {
  mode: "realtime",
  worker_host: DEFAULT_KNOBS.worker_host,
  worker_port: DEFAULT_KNOBS.worker_port,
  device: DEFAULT_KNOBS.device,
  num_pipelines: 1,
  log_level: DEFAULT_KNOBS.log_level,
  stt: DEFAULT_KNOBS.stt,
  llm_backend: DEFAULT_KNOBS.llm_backend,
  tts: DEFAULT_KNOBS.tts,
  enable_live_transcription: DEFAULT_KNOBS.enable_live_transcription,
  live_transcription_update_interval: DEFAULT_KNOBS.live_transcription_update_interval,
  init_chat_prompt: DEFAULT_KNOBS.init_chat_prompt,
  chat_size: DEFAULT_KNOBS.chat_size,
  stream_batch_sentences: DEFAULT_KNOBS.stream_batch_sentences,
  compact_history: DEFAULT_KNOBS.compact_history,
  model_name: DEFAULT_KNOBS.model_name,
  responses_api_base_url: DEFAULT_KNOBS.responses_api_base_url,
  responses_api_api_key: DEFAULT_KNOBS.responses_api_api_key,
  responses_api_stream: DEFAULT_KNOBS.responses_api_stream,
  responses_api_disable_thinking: DEFAULT_KNOBS.responses_api_disable_thinking,
  llm_device: null,
  llm_torch_dtype: "bfloat16",
  llm_gen_max_new_tokens: DEFAULT_KNOBS.llm_gen_max_new_tokens,
  llm_gen_temperature: DEFAULT_KNOBS.llm_gen_temperature,
  llm_gen_do_sample: DEFAULT_KNOBS.llm_gen_do_sample,
  stt_model_name: null,
  stt_device: null,
  stt_language: DEFAULT_KNOBS.stt_language,
  faster_whisper_stt_model_name: null,
  faster_whisper_stt_device: null,
  mlx_audio_whisper_model_name: null,
  paraformer_stt_model_name: null,
  paraformer_stt_device: null,
  parakeet_tdt_model_name: DEFAULT_KNOBS.parakeet_tdt_model_name,
  parakeet_tdt_device: DEFAULT_KNOBS.parakeet_tdt_device,
  parakeet_tdt_language: null,
  qwen3_tts_model_name: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
  qwen3_tts_device: null,
  qwen3_tts_backend: DEFAULT_KNOBS.qwen3_tts_backend,
  qwen3_tts_speaker: DEFAULT_KNOBS.qwen3_tts_speaker,
  qwen3_tts_language: DEFAULT_KNOBS.qwen3_tts_language,
  qwen3_tts_streaming_chunk_size: DEFAULT_KNOBS.qwen3_tts_streaming_chunk_size,
  qwen3_tts_non_streaming_mode: DEFAULT_KNOBS.qwen3_tts_non_streaming_mode,
  qwen3_tts_mlx_quantization: DEFAULT_KNOBS.qwen3_tts_mlx_quantization,
  kokoro_model_name: null,
  kokoro_device: "auto",
  kokoro_voice: DEFAULT_KNOBS.kokoro_voice,
  kokoro_lang_code: "b",
  kokoro_speed: DEFAULT_KNOBS.kokoro_speed,
  pocket_tts_device: "cpu",
  pocket_tts_voice: "jean",
  facebook_mms_model_name: "facebook/mms-tts-eng",
  facebook_mms_device: "cuda",
  tts_language: DEFAULT_KNOBS.tts_language,
  chat_tts_device: "cuda",
};

export interface VoiceLabValidationIssue {
  level: "error" | "warning" | "info";
  field: string;
  message: string;
}

export interface VoiceLabValidationResult {
  ok: boolean;
  issues: VoiceLabValidationIssue[];
  restart_required: boolean;
}

export interface VoiceLabStatus {
  state: "stopped" | "starting" | "running" | "external" | "stopping" | "failed";
  pid: number | null;
  owned_by_voice_lab: boolean;
  uptime_s: number | null;
  worker_url: string;
  realtime_url: string;
  active_config: Partial<VoiceLabLaunchConfig> | null;
  last_error: string | null;
  last_start_duration_ms: number | null;
  logs: string[];
  pool: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
}

export interface LabTimingEvent {
  source: "client" | "stt" | "tts";
  name: string;
  t: number;
  meta?: Record<string, unknown>;
}

export interface LabRun {
  id: string;
  startedAt: number;
  knobs: LabKnobs;
  source: string;
  report: ProbeReport;
  events: LabTimingEvent[];
}

interface State {
  knobs: LabKnobs;
  llmPreset: LlmPreset;
  directBaseUrl: string;
  baseConfig: Partial<VoiceLabLaunchConfig>;
  status: VoiceLabStatus | null;
  usage: Record<string, unknown> | null;
  pipelineState: PipelineState;
  loading: boolean;
  applying: boolean;
  dirty: boolean;
  error: string | null;
  validation: VoiceLabValidationResult | null;
  runs: LabRun[];
  liveEvents: LabTimingEvent[];
}

type Action =
  | { type: "SET_KNOB"; key: keyof LabKnobs; value: LabKnobs[keyof LabKnobs] }
  | { type: "SET_LLM_PRESET"; preset: LlmPreset }
  | { type: "RESET_KNOBS" }
  | { type: "LOAD_KNOBS"; knobs: LabKnobs }
  | { type: "LOAD_STATUS_START"; silent: boolean }
  | { type: "LOAD_STATUS_SUCCESS"; status: VoiceLabStatus }
  | { type: "LOAD_STATUS_ERROR"; error: string }
  | { type: "APPLY_START" }
  | { type: "APPLY_VALIDATION"; validation: VoiceLabValidationResult }
  | { type: "APPLY_SUCCESS"; status: VoiceLabStatus }
  | { type: "APPLY_ERROR"; error: string; validation?: VoiceLabValidationResult | null }
  | { type: "PUSH_EVENT"; event: LabTimingEvent }
  | { type: "CLEAR_LIVE" }
  | { type: "ADD_RUN"; run: LabRun }
  | { type: "CLEAR_RUNS" };

const INITIAL_STATE: State = {
  knobs: { ...DEFAULT_KNOBS },
  llmPreset: "direct",
  directBaseUrl: DEFAULT_DIRECT_LLM_BASE_URL,
  baseConfig: { ...DEFAULT_LAUNCH_CONFIG },
  status: null,
  usage: null,
  pipelineState: "stopped",
  loading: false,
  applying: false,
  dirty: false,
  error: null,
  validation: null,
  runs: [],
  liveEvents: [],
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_KNOB": {
      const knobs = { ...state.knobs, [action.key]: action.value };
      const directBaseUrl =
        action.key === "responses_api_base_url" && state.llmPreset === "direct"
          ? stringOr(action.value, state.directBaseUrl)
          : state.directBaseUrl;
      return { ...state, knobs, directBaseUrl, dirty: true, validation: null, error: null };
    }
    case "SET_LLM_PRESET": {
      const directBaseUrl =
        state.llmPreset === "direct" ? state.knobs.responses_api_base_url : state.directBaseUrl;
      return {
        ...state,
        llmPreset: action.preset,
        directBaseUrl,
        dirty: true,
        validation: null,
        error: null,
        knobs: {
          ...state.knobs,
          responses_api_base_url:
            action.preset === "agent" ? AGENT_LLM_BASE_URL : directBaseUrl || DEFAULT_DIRECT_LLM_BASE_URL,
        },
      };
    }
    case "RESET_KNOBS": {
      const mapped = knobsFromLaunchConfig(state.baseConfig, DEFAULT_KNOBS, state.directBaseUrl);
      return {
        ...state,
        knobs: mapped.knobs,
        llmPreset: mapped.llmPreset,
        directBaseUrl: mapped.directBaseUrl,
        dirty: false,
        validation: null,
        error: null,
      };
    }
    case "LOAD_KNOBS": {
      const llmPreset = action.knobs.responses_api_base_url === AGENT_LLM_BASE_URL ? "agent" : "direct";
      return {
        ...state,
        knobs: action.knobs,
        llmPreset,
        directBaseUrl: llmPreset === "direct" ? action.knobs.responses_api_base_url : state.directBaseUrl,
        dirty: true,
        validation: null,
        error: null,
      };
    }
    case "LOAD_STATUS_START":
      return action.silent ? state : { ...state, loading: true, error: null };
    case "LOAD_STATUS_SUCCESS": {
      const baseConfig = sanitizeLaunchConfig(action.status.active_config);
      const next: State = {
        ...state,
        status: action.status,
        usage: action.status.usage ?? null,
        baseConfig: Object.keys(baseConfig).length ? baseConfig : state.baseConfig,
        pipelineState: mapPipelineState(action.status.state),
        loading: false,
        error: null,
      };
      if (!state.dirty && Object.keys(baseConfig).length) {
        const mapped = knobsFromLaunchConfig(baseConfig, state.knobs, state.directBaseUrl);
        next.knobs = mapped.knobs;
        next.llmPreset = mapped.llmPreset;
        next.directBaseUrl = mapped.directBaseUrl;
      }
      return next;
    }
    case "LOAD_STATUS_ERROR":
      return { ...state, loading: false, pipelineState: "error", error: action.error };
    case "APPLY_START":
      return { ...state, applying: true, error: null, validation: null };
    case "APPLY_VALIDATION":
      return { ...state, validation: action.validation };
    case "APPLY_SUCCESS": {
      const baseConfig = sanitizeLaunchConfig(action.status.active_config);
      const mapped = knobsFromLaunchConfig(baseConfig, state.knobs, state.directBaseUrl);
      return {
        ...state,
        knobs: mapped.knobs,
        llmPreset: mapped.llmPreset,
        directBaseUrl: mapped.directBaseUrl,
        baseConfig: Object.keys(baseConfig).length ? baseConfig : state.baseConfig,
        status: action.status,
        usage: action.status.usage ?? null,
        pipelineState: mapPipelineState(action.status.state),
        applying: false,
        dirty: false,
        error: null,
      };
    }
    case "APPLY_ERROR":
      return {
        ...state,
        applying: false,
        pipelineState: state.pipelineState === "starting" ? "error" : state.pipelineState,
        error: action.error,
        validation: action.validation ?? state.validation,
      };
    case "PUSH_EVENT":
      return { ...state, liveEvents: [...state.liveEvents.slice(-499), action.event] };
    case "CLEAR_LIVE":
      return { ...state, liveEvents: [] };
    case "ADD_RUN":
      return { ...state, runs: [action.run, ...state.runs].slice(0, 50) };
    case "CLEAR_RUNS":
      return { ...state, runs: [] };
    default:
      return state;
  }
}

export interface LabStoreApi {
  knobs: LabKnobs;
  llmPreset: LlmPreset;
  directBaseUrl: string;
  status: VoiceLabStatus | null;
  usage: Record<string, unknown> | null;
  pipelineState: PipelineState;
  loading: boolean;
  applying: boolean;
  dirty: boolean;
  error: string | null;
  validation: VoiceLabValidationResult | null;
  runs: LabRun[];
  liveEvents: LabTimingEvent[];
  setKnob<K extends keyof LabKnobs>(key: K, value: LabKnobs[K]): void;
  setLlmPreset(preset: LlmPreset): void;
  loadKnobs(knobs: LabKnobs): void;
  resetKnobs(): void;
  loadStatus(): Promise<void>;
  applyConfig(): Promise<void>;
  pushEvent(event: LabTimingEvent): void;
  clearLive(): void;
  addRun(run: LabRun): void;
  clearRuns(): void;
}

const LabStoreContext = createContext<LabStoreApi | null>(null);

export function LabStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadStatusInternal = useCallback(async (opts: { silent?: boolean } = {}) => {
    dispatch({ type: "LOAD_STATUS_START", silent: opts.silent === true });
    try {
      const status = await labFetch<VoiceLabStatus>("status");
      dispatch({ type: "LOAD_STATUS_SUCCESS", status });
    } catch (err) {
      dispatch({ type: "LOAD_STATUS_ERROR", error: errorMessage(err) });
    }
  }, []);

  const loadStatus = useCallback(async () => {
    await loadStatusInternal({ silent: false });
  }, [loadStatusInternal]);

  const applyConfig = useCallback(async () => {
    const snapshot = stateRef.current;
    const config = buildLaunchConfig(snapshot.knobs, snapshot.baseConfig);
    dispatch({ type: "APPLY_START" });
    try {
      const validation = await labFetch<VoiceLabValidationResult>("validate", {
        method: "POST",
        body: JSON.stringify(config),
      });
      dispatch({ type: "APPLY_VALIDATION", validation });
      if (!validation.ok) {
        const message =
          validation.issues.find((issue) => issue.level === "error")?.message ??
          "Voice Lab config validation failed.";
        dispatch({ type: "APPLY_ERROR", error: message, validation });
        return;
      }
      const status = await labFetch<VoiceLabStatus>("restart", {
        method: "POST",
        body: JSON.stringify(config),
      });
      dispatch({ type: "APPLY_SUCCESS", status });
    } catch (err) {
      dispatch({ type: "APPLY_ERROR", error: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    void loadStatusInternal({ silent: true });
    const id = window.setInterval(() => {
      void loadStatusInternal({ silent: true });
    }, LAB_STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadStatusInternal]);

  const setKnob = useCallback(
    <K extends keyof LabKnobs>(key: K, value: LabKnobs[K]) => {
      dispatch({ type: "SET_KNOB", key, value });
    },
    [],
  );

  const setLlmPreset = useCallback((preset: LlmPreset) => {
    dispatch({ type: "SET_LLM_PRESET", preset });
  }, []);

  const loadKnobs = useCallback((knobs: LabKnobs) => {
    dispatch({ type: "LOAD_KNOBS", knobs });
  }, []);

  const resetKnobs = useCallback(() => dispatch({ type: "RESET_KNOBS" }), []);
  const pushEvent = useCallback((event: LabTimingEvent) => dispatch({ type: "PUSH_EVENT", event }), []);
  const clearLive = useCallback(() => dispatch({ type: "CLEAR_LIVE" }), []);
  const addRun = useCallback((run: LabRun) => dispatch({ type: "ADD_RUN", run }), []);
  const clearRuns = useCallback(() => dispatch({ type: "CLEAR_RUNS" }), []);

  const api = useMemo<LabStoreApi>(
    () => ({
      knobs: state.knobs,
      llmPreset: state.llmPreset,
      directBaseUrl: state.directBaseUrl,
      status: state.status,
      usage: state.usage,
      pipelineState: state.pipelineState,
      loading: state.loading,
      applying: state.applying,
      dirty: state.dirty,
      error: state.error,
      validation: state.validation,
      runs: state.runs,
      liveEvents: state.liveEvents,
      setKnob,
      setLlmPreset,
      loadKnobs,
      resetKnobs,
      loadStatus,
      applyConfig,
      pushEvent,
      clearLive,
      addRun,
      clearRuns,
    }),
    [
      state,
      setKnob,
      setLlmPreset,
      loadKnobs,
      resetKnobs,
      loadStatus,
      applyConfig,
      pushEvent,
      clearLive,
      addRun,
      clearRuns,
    ],
  );

  return <LabStoreContext.Provider value={api}>{children}</LabStoreContext.Provider>;
}

export function useLabStore(): LabStoreApi {
  const ctx = useContext(LabStoreContext);
  if (!ctx) throw new Error("useLabStore must be used inside LabStoreProvider");
  return ctx;
}

export function buildLaunchConfig(
  knobs: LabKnobs,
  baseConfig: Partial<VoiceLabLaunchConfig> | null = null,
): VoiceLabLaunchConfig {
  return {
    ...DEFAULT_LAUNCH_CONFIG,
    ...sanitizeLaunchConfig(baseConfig),
    ...knobsToLaunchConfig(knobs),
    mode: "realtime",
    num_pipelines: 1,
  };
}

export function knobsFromLaunchConfig(
  config: Partial<VoiceLabLaunchConfig> | null | undefined,
  fallback: LabKnobs = DEFAULT_KNOBS,
  previousDirectBaseUrl = DEFAULT_DIRECT_LLM_BASE_URL,
): { knobs: LabKnobs; llmPreset: LlmPreset; directBaseUrl: string } {
  const source = sanitizeLaunchConfig(config);
  const configuredBaseUrl = stringField(source, "responses_api_base_url", fallback.responses_api_base_url);
  const llmPreset: LlmPreset = configuredBaseUrl === AGENT_LLM_BASE_URL ? "agent" : "direct";
  const directBaseUrl =
    llmPreset === "direct"
      ? configuredBaseUrl
      : previousDirectBaseUrl || DEFAULT_DIRECT_LLM_BASE_URL;
  const apiKey = stringField(source, "responses_api_api_key", fallback.responses_api_api_key);

  return {
    llmPreset,
    directBaseUrl,
    knobs: {
      worker_host: stringField(source, "worker_host", fallback.worker_host),
      worker_port: numberField(source, "worker_port", fallback.worker_port),
      device: nullableStringField(source, "device", fallback.device),
      log_level: unionField(LOG_LEVELS, source.log_level, fallback.log_level),

      stt: unionField(STT_BACKENDS, source.stt, fallback.stt),
      llm_backend: unionField(LLM_BACKENDS, source.llm_backend, fallback.llm_backend),
      tts: unionField(TTS_BACKENDS, source.tts, fallback.tts),

      enable_live_transcription: booleanField(
        source,
        "enable_live_transcription",
        fallback.enable_live_transcription,
      ),
      live_transcription_update_interval: numberField(
        source,
        "live_transcription_update_interval",
        fallback.live_transcription_update_interval,
      ),

      init_chat_prompt: stringField(source, "init_chat_prompt", fallback.init_chat_prompt),
      chat_size: numberField(source, "chat_size", fallback.chat_size),
      stream_batch_sentences: numberField(source, "stream_batch_sentences", fallback.stream_batch_sentences),
      compact_history: booleanField(source, "compact_history", fallback.compact_history),

      model_name: stringField(source, "model_name", fallback.model_name),
      responses_api_base_url: llmPreset === "agent" ? AGENT_LLM_BASE_URL : directBaseUrl,
      responses_api_api_key: apiKey === "********" ? fallback.responses_api_api_key : apiKey,
      responses_api_stream: booleanField(source, "responses_api_stream", fallback.responses_api_stream),
      responses_api_disable_thinking: booleanField(
        source,
        "responses_api_disable_thinking",
        fallback.responses_api_disable_thinking,
      ),
      llm_gen_max_new_tokens: numberField(
        source,
        "llm_gen_max_new_tokens",
        fallback.llm_gen_max_new_tokens,
      ),
      llm_gen_temperature: numberField(source, "llm_gen_temperature", fallback.llm_gen_temperature),
      llm_gen_do_sample: booleanField(source, "llm_gen_do_sample", fallback.llm_gen_do_sample),

      stt_language: nullableStringField(source, "stt_language", fallback.stt_language),
      parakeet_tdt_model_name: nullableStringField(
        source,
        "parakeet_tdt_model_name",
        fallback.parakeet_tdt_model_name,
      ),
      parakeet_tdt_device: stringField(source, "parakeet_tdt_device", fallback.parakeet_tdt_device),

      qwen3_tts_backend: unionField(QWEN3_TTS_BACKENDS, source.qwen3_tts_backend, fallback.qwen3_tts_backend),
      qwen3_tts_speaker: nullableStringField(source, "qwen3_tts_speaker", fallback.qwen3_tts_speaker),
      qwen3_tts_language: stringField(source, "qwen3_tts_language", fallback.qwen3_tts_language),
      qwen3_tts_streaming_chunk_size: nullableNumberField(
        source,
        "qwen3_tts_streaming_chunk_size",
        fallback.qwen3_tts_streaming_chunk_size,
      ),
      qwen3_tts_non_streaming_mode: nullableBooleanField(
        source,
        "qwen3_tts_non_streaming_mode",
        fallback.qwen3_tts_non_streaming_mode,
      ),
      qwen3_tts_mlx_quantization: nullableStringField(
        source,
        "qwen3_tts_mlx_quantization",
        fallback.qwen3_tts_mlx_quantization,
      ),

      kokoro_voice: stringField(source, "kokoro_voice", fallback.kokoro_voice),
      kokoro_speed: numberField(source, "kokoro_speed", fallback.kokoro_speed),
      tts_language: stringField(source, "tts_language", fallback.tts_language),
    },
  };
}

export function sanitizeLaunchConfig(
  config: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null | undefined,
): Partial<VoiceLabLaunchConfig> {
  if (!config || typeof config !== "object") return {};
  const source = config as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of LAUNCH_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (key === "responses_api_api_key" && source[key] === "********") continue;
    out[key] = source[key];
  }
  return out as Partial<VoiceLabLaunchConfig>;
}

function knobsToLaunchConfig(knobs: LabKnobs): Partial<VoiceLabLaunchConfig> {
  return {
    worker_host: knobs.worker_host,
    worker_port: knobs.worker_port,
    device: knobs.device,
    log_level: knobs.log_level,
    stt: knobs.stt,
    llm_backend: knobs.llm_backend,
    tts: knobs.tts,
    enable_live_transcription: knobs.enable_live_transcription,
    live_transcription_update_interval: knobs.live_transcription_update_interval,
    init_chat_prompt: knobs.init_chat_prompt,
    chat_size: knobs.chat_size,
    stream_batch_sentences: knobs.stream_batch_sentences,
    compact_history: knobs.compact_history,
    model_name: knobs.model_name,
    responses_api_base_url: knobs.responses_api_base_url,
    responses_api_api_key: knobs.responses_api_api_key,
    responses_api_stream: knobs.responses_api_stream,
    responses_api_disable_thinking: knobs.responses_api_disable_thinking,
    llm_gen_max_new_tokens: knobs.llm_gen_max_new_tokens,
    llm_gen_temperature: knobs.llm_gen_temperature,
    llm_gen_do_sample: knobs.llm_gen_do_sample,
    stt_language: knobs.stt_language,
    parakeet_tdt_model_name: knobs.parakeet_tdt_model_name,
    parakeet_tdt_device: knobs.parakeet_tdt_device,
    qwen3_tts_backend: knobs.qwen3_tts_backend,
    qwen3_tts_speaker: knobs.qwen3_tts_speaker,
    qwen3_tts_language: knobs.qwen3_tts_language,
    qwen3_tts_streaming_chunk_size: knobs.qwen3_tts_streaming_chunk_size,
    qwen3_tts_non_streaming_mode: knobs.qwen3_tts_non_streaming_mode,
    qwen3_tts_mlx_quantization: knobs.qwen3_tts_mlx_quantization,
    kokoro_voice: knobs.kokoro_voice,
    kokoro_speed: knobs.kokoro_speed,
    tts_language: knobs.tts_language,
  };
}

function mapPipelineState(state: VoiceLabStatus["state"]): PipelineState {
  if (state === "running" || state === "external") return "running";
  if (state === "starting" || state === "stopping") return "starting";
  if (state === "failed") return "error";
  return "stopped";
}

async function labFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/voice/lab/${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : null),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as T | { detail?: string; error?: string } | null;
  if (!res.ok) {
    const maybeError = data as { detail?: string; error?: string } | null;
    throw new Error(maybeError?.detail ?? maybeError?.error ?? `Voice Lab request failed: ${res.status}`);
  }
  return data as T;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stringField(source: Record<string, unknown>, key: string, fallback: string): string {
  return stringOr(source[key], fallback);
}

function nullableStringField(
  source: Record<string, unknown>,
  key: string,
  fallback: string | null,
): string | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value === "string") return value;
  return fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberField(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableNumberField(
  source: Record<string, unknown>,
  key: string,
  fallback: number | null,
): number | null {
  if (source[key] === null) return null;
  return numberField(source, key, fallback ?? 0);
}

function booleanField(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof source[key] === "boolean" ? source[key] : fallback;
}

function nullableBooleanField(
  source: Record<string, unknown>,
  key: string,
  fallback: boolean | null,
): boolean | null {
  if (source[key] === null) return null;
  return typeof source[key] === "boolean" ? source[key] : fallback;
}

function unionField<T extends readonly string[]>(
  options: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value : fallback;
}
