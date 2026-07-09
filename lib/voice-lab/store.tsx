"use client";

/**
 * s2s Voice Lab store.
 *
 * The browser talks only to `/api/voice/lab/*`; that proxy forwards to the
 * local speech-to-speech Voice Lab supervisor. Config keys mirror the
 * supervisor LaunchConfig field names so apply stays validate -> restart.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";

import type { ProbeReport } from "@/lib/voice/test-harness/latency-probe";

import {
  CONFIG_FIELDS,
  DEFAULT_DIRECT_LLM_BASE_URL,
  DEFAULT_LAUNCH_CONFIG,
  LAUNCH_CONFIG_KEYS,
  type LaunchConfigField,
  type LaunchConfigKey,
  type VoiceLabConfig,
} from "./config-schema";

export {
  CONFIG_FIELDS,
  CONFIG_GROUPS,
  DEFAULT_DIRECT_LLM_BASE_URL,
  DEFAULT_LAUNCH_CONFIG,
  LAUNCH_CONFIG_KEYS,
  LLM_BACKENDS,
  LOG_LEVELS,
  LOCAL_VOICE_PROMPT,
  NULLABLE_CONFIG_KEYS,
  QWEN3_TTS_BACKENDS,
  STT_BACKENDS,
  TTS_BACKENDS,
  isFieldVisible,
  isNullableConfigKey,
} from "./config-schema";
export type {
  ConfigGroupId,
  ConfigInput,
  LaunchConfigField,
  LaunchConfigKey,
  LlmBackend,
  LogLevel,
  Qwen3TtsBackend,
  ShowWhenCondition,
  SttBackend,
  TtsBackend,
  VoiceLabConfig,
} from "./config-schema";

export const LAB_STATUS_POLL_MS = 4_000;
export const AGENT_LLM_BASE_URL = "http://localhost:3333/api/voice/agent-bridge/default/v1";
export const REDACTED_SECRET = "********";

export type LlmPreset = "agent" | "direct";
export type PipelineState = "stopped" | "starting" | "running" | "error";
export type SecretConfigKey = "responses_api_api_key";
export type SecretFlags = Record<SecretConfigKey, boolean>;

export type LabKnobs = VoiceLabConfig;
export type VoiceLabLaunchConfig = VoiceLabConfig;
export type VoiceLabLaunchPayload = Omit<VoiceLabLaunchConfig, SecretConfigKey> &
  Partial<Pick<VoiceLabLaunchConfig, SecretConfigKey>>;

export const DEFAULT_KNOBS: LabKnobs = DEFAULT_LAUNCH_CONFIG;

const SECRET_KEYS = ["responses_api_api_key"] as const satisfies readonly SecretConfigKey[];

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
  active_config: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null;
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
  activeConfig: LabKnobs;
  activeRedactions: SecretFlags;
  editedSecrets: SecretFlags;
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
}

type Action =
  | { type: "SET_KNOB"; key: LaunchConfigKey; value: VoiceLabConfig[LaunchConfigKey] }
  | { type: "SET_LLM_PRESET"; preset: LlmPreset }
  | { type: "RESET_TO_ACTIVE" }
  | { type: "RESET_TO_DEFAULTS" }
  | { type: "LOAD_KNOBS"; knobs: LabKnobs }
  | { type: "LOAD_STATUS_START"; silent: boolean }
  | { type: "LOAD_STATUS_SUCCESS"; status: VoiceLabStatus }
  | { type: "LOAD_STATUS_ERROR"; error: string }
  | { type: "APPLY_START" }
  | { type: "APPLY_VALIDATION"; validation: VoiceLabValidationResult }
  | { type: "APPLY_SUCCESS"; status: VoiceLabStatus; appliedConfig: VoiceLabLaunchPayload }
  | { type: "APPLY_ERROR"; error: string; validation?: VoiceLabValidationResult | null }
  | { type: "PUSH_EVENT"; event: LabTimingEvent }
  | { type: "CLEAR_LIVE" }
  | { type: "ADD_RUN"; run: LabRun }
  | { type: "CLEAR_RUNS" };

const INITIAL_STATE: State = {
  knobs: cloneConfig(DEFAULT_KNOBS),
  activeConfig: cloneConfig(DEFAULT_KNOBS),
  activeRedactions: emptySecretFlags(),
  editedSecrets: emptySecretFlags(),
  llmPreset: "direct",
  directBaseUrl: DEFAULT_DIRECT_LLM_BASE_URL,
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
      const knobs = { ...state.knobs, [action.key]: action.value } as LabKnobs;
      const directBaseUrl =
        action.key === "responses_api_base_url" && state.llmPreset === "direct"
          ? stringOr(action.value, state.directBaseUrl)
          : state.directBaseUrl;
      const editedSecrets = markSecretEdited(state.editedSecrets, action.key);
      return withDirty({
        ...state,
        knobs,
        directBaseUrl,
        editedSecrets,
        validation: null,
        error: null,
      });
    }
    case "SET_LLM_PRESET": {
      const directBaseUrl =
        state.llmPreset === "direct"
          ? state.knobs.responses_api_base_url || state.directBaseUrl
          : state.directBaseUrl;
      const knobs = {
        ...state.knobs,
        responses_api_base_url:
          action.preset === "agent" ? AGENT_LLM_BASE_URL : directBaseUrl || DEFAULT_DIRECT_LLM_BASE_URL,
      } as LabKnobs;
      return withDirty({
        ...state,
        knobs,
        llmPreset: action.preset,
        directBaseUrl,
        validation: null,
        error: null,
      });
    }
    case "RESET_TO_ACTIVE": {
      const mapped = knobsFromLaunchConfig(state.activeConfig, DEFAULT_KNOBS, state.directBaseUrl);
      return {
        ...state,
        knobs: mapped.knobs,
        llmPreset: mapped.llmPreset,
        directBaseUrl: mapped.directBaseUrl,
        editedSecrets: emptySecretFlags(),
        dirty: false,
        validation: null,
        error: null,
      };
    }
    case "RESET_TO_DEFAULTS": {
      const mapped = knobsFromLaunchConfig(DEFAULT_KNOBS, DEFAULT_KNOBS, state.directBaseUrl);
      return withDirty({
        ...state,
        knobs: mapped.knobs,
        llmPreset: mapped.llmPreset,
        directBaseUrl: mapped.directBaseUrl,
        editedSecrets: emptySecretFlags(),
        validation: null,
        error: null,
      });
    }
    case "LOAD_KNOBS": {
      const mapped = knobsFromLaunchConfig(action.knobs, state.knobs, state.directBaseUrl);
      return withDirty({
        ...state,
        knobs: mapped.knobs,
        llmPreset: mapped.llmPreset,
        directBaseUrl: mapped.directBaseUrl,
        validation: null,
        error: null,
      });
    }
    case "LOAD_STATUS_START":
      return action.silent ? state : { ...state, loading: true, error: null };
    case "LOAD_STATUS_SUCCESS": {
      const activeResult = activeConfigFromStatus(action.status.active_config, state.activeConfig);
      let next: State = {
        ...state,
        status: action.status,
        usage: action.status.usage ?? null,
        activeConfig: activeResult.config,
        activeRedactions: activeResult.redactions,
        pipelineState: mapPipelineState(action.status.state),
        loading: false,
        error: null,
      };
      if (!state.dirty && activeResult.hadActiveConfig) {
        const mapped = knobsFromLaunchConfig(activeResult.config, state.knobs, state.directBaseUrl);
        next = {
          ...next,
          knobs: mapped.knobs,
          llmPreset: mapped.llmPreset,
          directBaseUrl: mapped.directBaseUrl,
          editedSecrets: emptySecretFlags(),
        };
      }
      return withDirty(next);
    }
    case "LOAD_STATUS_ERROR":
      return { ...state, loading: false, pipelineState: "error", error: action.error };
    case "APPLY_START":
      return { ...state, applying: true, error: null, validation: null };
    case "APPLY_VALIDATION":
      return { ...state, validation: action.validation };
    case "APPLY_SUCCESS": {
      const activeResult = activeConfigFromStatus(action.status.active_config ?? action.appliedConfig, DEFAULT_KNOBS);
      const mapped = knobsFromLaunchConfig(activeResult.config, DEFAULT_KNOBS, state.directBaseUrl);
      return {
        ...state,
        knobs: mapped.knobs,
        activeConfig: activeResult.config,
        activeRedactions: activeResult.redactions,
        editedSecrets: emptySecretFlags(),
        llmPreset: mapped.llmPreset,
        directBaseUrl: mapped.directBaseUrl,
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
  activeConfig: LabKnobs;
  activeRedactions: SecretFlags;
  editedSecrets: SecretFlags;
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
  setKnob(key: LaunchConfigKey, value: VoiceLabConfig[LaunchConfigKey]): void;
  setLlmPreset(preset: LlmPreset): void;
  loadKnobs(knobs: LabKnobs): void;
  resetKnobs(): void;
  resetToActive(): void;
  resetToDefaults(): void;
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
    const includeApiKey =
      snapshot.editedSecrets.responses_api_api_key || !snapshot.activeRedactions.responses_api_api_key;
    const config = buildLaunchConfig(snapshot.knobs, snapshot.activeConfig, { includeApiKey });
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
      dispatch({ type: "APPLY_SUCCESS", status, appliedConfig: config });
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

  const setKnob = useCallback((key: LaunchConfigKey, value: VoiceLabConfig[LaunchConfigKey]) => {
    dispatch({ type: "SET_KNOB", key, value });
  }, []);

  const setLlmPreset = useCallback((preset: LlmPreset) => {
    dispatch({ type: "SET_LLM_PRESET", preset });
  }, []);

  const loadKnobs = useCallback((knobs: LabKnobs) => {
    dispatch({ type: "LOAD_KNOBS", knobs });
  }, []);

  const resetToActive = useCallback(() => dispatch({ type: "RESET_TO_ACTIVE" }), []);
  const resetToDefaults = useCallback(() => dispatch({ type: "RESET_TO_DEFAULTS" }), []);
  const resetKnobs = resetToActive;
  const pushEvent = useCallback((event: LabTimingEvent) => dispatch({ type: "PUSH_EVENT", event }), []);
  const clearLive = useCallback(() => dispatch({ type: "CLEAR_LIVE" }), []);
  const addRun = useCallback((run: LabRun) => dispatch({ type: "ADD_RUN", run }), []);
  const clearRuns = useCallback(() => dispatch({ type: "CLEAR_RUNS" }), []);

  const api = useMemo<LabStoreApi>(
    () => ({
      knobs: state.knobs,
      activeConfig: state.activeConfig,
      activeRedactions: state.activeRedactions,
      editedSecrets: state.editedSecrets,
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
      resetToActive,
      resetToDefaults,
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
      resetToActive,
      resetToDefaults,
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

export interface BuildLaunchConfigOptions {
  includeApiKey?: boolean;
}

export function buildLaunchConfig(
  knobs: LabKnobs,
  baseConfig: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null = null,
  options: BuildLaunchConfigOptions = {},
): VoiceLabLaunchPayload {
  const config = {
    ...coerceLaunchConfig(baseConfig, DEFAULT_KNOBS),
    ...knobs,
  } as VoiceLabLaunchConfig;
  const payload = { ...config } as VoiceLabLaunchPayload;
  if (options.includeApiKey === false || payload.responses_api_api_key === REDACTED_SECRET) {
    delete payload.responses_api_api_key;
  }
  return payload;
}

export function knobsFromLaunchConfig(
  config: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null | undefined,
  fallback: LabKnobs = DEFAULT_KNOBS,
  previousDirectBaseUrl = DEFAULT_DIRECT_LLM_BASE_URL,
): { knobs: LabKnobs; llmPreset: LlmPreset; directBaseUrl: string } {
  const merged = coerceLaunchConfig(config, fallback);
  return withLlmPreset(merged, previousDirectBaseUrl);
}

export function sanitizeLaunchConfig(
  config: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null | undefined,
): Partial<VoiceLabLaunchConfig> {
  if (!config || typeof config !== "object") return {};
  const source = config as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of LAUNCH_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (isSecretKey(key) && source[key] === REDACTED_SECRET) continue;
    out[key] = source[key];
  }
  return out as Partial<VoiceLabLaunchConfig>;
}

export function coerceLaunchConfig(
  config: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null | undefined,
  fallback: LabKnobs = DEFAULT_KNOBS,
): LabKnobs {
  const source = sanitizeLaunchConfig(config) as Record<string, unknown>;
  const out = { ...fallback } as LabKnobs;
  const writable = out as unknown as Record<string, VoiceLabConfig[LaunchConfigKey]>;
  for (const fieldConfig of CONFIG_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, fieldConfig.key)) continue;
    writable[fieldConfig.key] = coerceFieldValue(fieldConfig, source[fieldConfig.key], fallback[fieldConfig.key]);
  }
  return out;
}

export interface DirtyOptions {
  redactedSecrets?: Partial<SecretFlags>;
  editedSecrets?: Partial<SecretFlags>;
}

export function isLaunchConfigDirty(
  config: LabKnobs,
  activeConfig: LabKnobs,
  options: DirtyOptions = {},
): boolean {
  for (const key of LAUNCH_CONFIG_KEYS) {
    if (shouldIgnoreSecretForDirty(key, options)) continue;
    if (!Object.is(config[key], activeConfig[key])) return true;
  }
  return false;
}

export function secretRedactionsFromLaunchConfig(
  config: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null | undefined,
): SecretFlags {
  const redactions = emptySecretFlags();
  if (!config || typeof config !== "object") return redactions;
  const source = config as Record<string, unknown>;
  for (const key of SECRET_KEYS) {
    redactions[key] = source[key] === REDACTED_SECRET;
  }
  return redactions;
}

function activeConfigFromStatus(
  config: Partial<VoiceLabLaunchConfig> | Record<string, unknown> | null | undefined,
  fallback: LabKnobs,
): { config: LabKnobs; redactions: SecretFlags; hadActiveConfig: boolean } {
  const hadActiveConfig = !!config && typeof config === "object";
  return {
    config: hadActiveConfig ? coerceLaunchConfig(config, DEFAULT_KNOBS) : fallback,
    redactions: hadActiveConfig ? secretRedactionsFromLaunchConfig(config) : emptySecretFlags(),
    hadActiveConfig,
  };
}

function withDirty(state: State): State {
  return {
    ...state,
    dirty: isLaunchConfigDirty(state.knobs, state.activeConfig, {
      redactedSecrets: state.activeRedactions,
      editedSecrets: state.editedSecrets,
    }),
  };
}

function withLlmPreset(config: LabKnobs, previousDirectBaseUrl: string): {
  knobs: LabKnobs;
  llmPreset: LlmPreset;
  directBaseUrl: string;
} {
  const configuredBaseUrl = config.responses_api_base_url;
  const llmPreset: LlmPreset = configuredBaseUrl === AGENT_LLM_BASE_URL ? "agent" : "direct";
  const directBaseUrl =
    llmPreset === "direct"
      ? configuredBaseUrl || previousDirectBaseUrl || DEFAULT_DIRECT_LLM_BASE_URL
      : previousDirectBaseUrl || DEFAULT_DIRECT_LLM_BASE_URL;
  return {
    llmPreset,
    directBaseUrl,
    knobs: {
      ...config,
      responses_api_base_url: llmPreset === "agent" ? AGENT_LLM_BASE_URL : configuredBaseUrl,
    },
  };
}

function coerceFieldValue(
  fieldConfig: LaunchConfigField,
  value: unknown,
  fallback: VoiceLabConfig[LaunchConfigKey],
): VoiceLabConfig[LaunchConfigKey] {
  if (value === null) return fieldConfig.nullable ? null : fallback;

  switch (fieldConfig.input) {
    case "select":
      return typeof value === "string" && (fieldConfig.options as readonly string[]).includes(value)
        ? value
        : fallback;
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return fallback;
    }
    case "toggle":
      return typeof value === "boolean" ? value : fallback;
    case "text":
    case "textarea":
      return typeof value === "string" ? value : fallback;
    default:
      return fallback;
  }
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

function cloneConfig(config: LabKnobs): LabKnobs {
  return { ...config };
}

function emptySecretFlags(): SecretFlags {
  return { responses_api_api_key: false };
}

function markSecretEdited(current: SecretFlags, key: LaunchConfigKey): SecretFlags {
  if (!isSecretKey(key)) return current;
  return { ...current, [key]: true };
}

function isSecretKey(key: LaunchConfigKey): key is SecretConfigKey {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

function shouldIgnoreSecretForDirty(key: LaunchConfigKey, options: DirtyOptions): boolean {
  if (!isSecretKey(key)) return false;
  return options.redactedSecrets?.[key] === true && options.editedSecrets?.[key] !== true;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
