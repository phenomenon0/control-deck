"use client";

/**
 * Voice session hook — the canonical runtime the UI talks to.
 *
 * Composes the existing `useVoiceChat` primitive (mic, WebSocket, playback)
 * with the session state machine (`session-machine.ts`) and a route/latency
 * overlay that fetches `/api/voice/runtime`. The chat conversation lives in
 * ChatSurface via `agentRun.send` — this hook only owns the mic FSM, STT,
 * route/runtime snapshot, and exposes `markAgentRun{Started,Finished}` so
 * the FSM stays in sync with the chat's streaming lifecycle. Tool/artifact
 * events from the agentic SSE stream are also consumed here so the
 * Newsroom surface can read `tools.artifacts`.
 *
 * Every voice surface should consume this hook instead of calling
 * `useVoiceChat` directly. Sharing a single session means a single
 * WebSocket, one transcript, one FSM.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useVoiceChat, type UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import { useDeckSettings, type VoicePrefs } from "@/components/settings/DeckSettingsProvider";
import { SSEParser } from "@/lib/agui/sse";
import {
  isArtifactCreated,
  isInterruptRequested,
  isInterruptResolved,
  isRunError,
  isRunFinished,
  isRunStarted,
  isToolCallResult,
  isToolCallStart,
  type AGUIEvent,
} from "@/lib/agui/events";
import { useRunController, type RunController } from "@/lib/hooks/useRunController";
import {
  initialContext,
  reduceVoiceSession,
  labelForState,
  isInterruptible as stateIsInterruptible,
  isListening as stateIsListening,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "@/lib/voice/session-machine";
import { SpeechHandle } from "@/lib/voice/speech-handle";
import { AgentOutput } from "@/lib/voice/audio-output";
import { AgentInput } from "@/lib/voice/audio-input";
import { VoiceAgentClient } from "@/lib/voice/voice-agent-session";
import { decideSpeakingBridge } from "@/lib/voice/speaking-bridge";
import {
  createVoiceOwnerId,
  subscribeVoiceActivity,
} from "@/lib/voice/activity-bus";
import type { VoiceRoutePreset } from "@/lib/voice/resolve-voice-route";
import type { Artifact } from "@/lib/types/chat";
import type { VoiceApprovalChallenge } from "@/lib/voice/voice-approval";

export interface VoiceRuntimeSnapshot {
  route: {
    preset: VoiceRoutePreset;
    rationale: string;
    stt: { providerId: string; providerName: string; model: string | null } | null;
    tts: {
      providerId: string;
      providerName: string;
      model: string | null;
      engine: string | null;
    } | null;
  };
  transport: {
    mode: "app-gateway" | "realtime";
    sidecar: "ok" | "unreachable" | "unknown";
    wsUrl: string | null;
    token: string | null;
  };
}

export interface VoiceTurnLatency {
  sttMs?: number;
  replyMs?: number;
  firstAudioMs?: number;
}

export interface VoiceToolState {
  isRunning: boolean;
  currentToolName: string | null;
  artifacts: Artifact[];
}

/**
 * Per-turn handle reserved for transports that can accept incremental
 * assistant text. The current app-gateway path returns null and ChatSurface
 * queues phrase WAVs instead.
 */
export interface StreamingReplyHandle {
  speak(text: string, utteranceId?: string): void;
  finish(): Promise<void>;
  interrupt(): void;
}

/**
 * Server-emitted timing frame surfaced to the lab so client + server
 * marks can be merged onto a single timeline.
 */
export interface VoiceTimingFrame {
  source: "stt" | "tts";
  phase: string;
  ms: number;
  meta?: Record<string, unknown>;
  /** Client-side `performance.now()` of receipt, for joining with __voiceProbe marks. */
  receivedAt: number;
}

export interface VoiceLabOverrides {
  /** Lab-only override retained for compatibility with older panels. */
  sttEngine?: string | null;
  /** Lab-only override retained for compatibility with older panels. */
  correctionEngine?: string | null;
  /** Lab-only override retained for compatibility with older panels. */
  ttsEngine?: string | null;
  /** Lab-only flag retained for compatibility with older panels. */
  debug?: boolean;
}

export interface VoiceSessionApi {
  state: VoiceSessionState;
  stateLabel: string;
  transcriptPartial: string;
  transcriptFinal: string;
  audioLevel: number;
  isListening: boolean;
  isSpeaking: boolean;
  isInterruptible: boolean;
  error: string | null;

  runtime: VoiceRuntimeSnapshot | null;
  runtimeLoading: boolean;
  currentRoutePreset: VoiceRoutePreset;
  latency: VoiceTurnLatency;

  currentVoiceId: string | null;
  currentDevices: { inputId: string | null; outputId: string | null };

  /** Tool/artifact state from the agentic SSE stream. */
  tools: VoiceToolState;

  /**
   * Active voice-approval challenge — populated when the agent emits an
   * approval-shaped InterruptRequested for this session's thread.
   * `confirmApproval` resolves it via /api/chat/{approve,reject}.
   */
  pendingApproval: VoiceApprovalChallenge | null;
  confirmApproval(decision: "approved" | "rejected", reason?: string): Promise<void>;

  setRoute(preset: VoiceRoutePreset): void;
  setVoice(voiceId: string | null): void;
  setDevices(opts: { inputId?: string | null; outputId?: string | null }): void;

  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  interrupt(): Promise<void>;
  reset(): void;

  /**
   * Eagerly create and resume the output AudioContext. MUST be called from a
   * real user-gesture handler (click/keydown). Without this the browser leaves
   * the AudioContext suspended and TTS chunks play into silence.
   */
  unlockOutput(): Promise<void>;

  /**
   * Bridge for surfaces that own the chat stream themselves. ChatSurface
   * calls these so the shared voice FSM moves submitting -> thinking ->
   * speaking even though the chat runs through `agentRun.send` instead of
   * the voice hook.
   */
  markAgentRunStarted(runId?: string): void;
  markAgentRunFinished(): void;

  /**
   * Open an incremental TTS lane for the next assistant turn. Currently
   * returns null so callers use the per-phrase WAV path via `queueSpeech`.
   */
  beginStreamingReply(): StreamingReplyHandle | null;

  /** Subscribe to agentic tool events on a thread. Returns an unsubscribe. */
  attachThread(threadId: string): () => void;

  /** Escape hatch for read-aloud and speak-on-submit paths. */
  speak(text: string): Promise<void>;
  queueSpeech(text: string): boolean;
  stopSpeaking(): void;

  /**
   * Voice-lab compatibility surface. Realtime timing is captured by
   * `lib/voice-lab/useTimingFrames`; these hooks are no-ops for app-gateway.
   */
  setLabOverrides(overrides: VoiceLabOverrides): void;
  subscribeTiming(listener: (frame: VoiceTimingFrame) => void): () => void;

  /** Underlying `useVoiceChat` handle — needed until T3 finishes the split. */
  voiceChat: UseVoiceChatReturn;
}

interface UseVoiceSessionOptions {
  enabled?: boolean;
  onTranscriptFinal?: (text: string) => void;
  preset?: VoiceRoutePreset;
  /**
   * Shared run controller (from `useRunController`). When provided,
   * `interrupt()` routes the server-side cancel through it — one cancel POST
   * per run even when chat's `stop()` races the voice interrupt. Defaults to
   * a private controller.
   */
  controller?: RunController;
}

const TRANSCRIBING_WATCHDOG_MS = 12_000;
// Thinking has no audio yet — if it's still ours after this long, the LLM/TTS
// path likely failed silently. Bail to idle so the orb doesn't freeze.
const THINKING_WATCHDOG_MS = 20_000;
// Reconnect delay for the /api/agui/stream subscription (mirrors EventSource's
// built-in retry now that the stream is consumed via fetch + SSEParser).
const AGUI_STREAM_RETRY_MS = 2_000;

export function useVoiceSession(options: UseVoiceSessionOptions = {}): VoiceSessionApi {
  const { enabled = true, onTranscriptFinal, preset: initialPreset } = options;

  const [ctx, dispatchCtx] = useReducer(
    (state: ReturnType<typeof initialContext>, event: VoiceSessionEvent) =>
      reduceVoiceSession(state, event).context,
    undefined,
    initialContext,
  );

  const { prefs, updateVoicePrefs } = useDeckSettings();
  const inputDeviceId = prefs.voice.audioInputId ?? null;
  const outputDeviceId = prefs.voice.audioOutputId ?? null;
  const voiceOwnerIdRef = useRef<string>(createVoiceOwnerId("voice-session"));

  // Voice id is persisted via DeckSettings (alongside device IDs) so it
  // survives reloads and is shared across every voice surface — chat composer
  // picker, voice mode sheet, models pane, etc.
  const currentVoiceId = prefs.voice.voiceId ?? null;
  const currentDevices = useMemo(
    () => ({ inputId: inputDeviceId, outputId: outputDeviceId }),
    [inputDeviceId, outputDeviceId],
  );

  const setVoice = useCallback(
    (id: string | null) => updateVoicePrefs({ voiceId: id }),
    [updateVoicePrefs],
  );
  const setDevices = useCallback(
    (opts: { inputId?: string | null; outputId?: string | null }) => {
      const next: Partial<VoicePrefs> = {};
      if (opts.inputId !== undefined) next.audioInputId = opts.inputId;
      if (opts.outputId !== undefined) next.audioOutputId = opts.outputId;
      if (Object.keys(next).length > 0) updateVoicePrefs(next);
    },
    [updateVoicePrefs],
  );

  const stateRef = useRef(ctx.state);
  // Forward-ref so `startListening` (defined before `interrupt`) can call
  // it for the speaking-state barge-in gate without forcing reorder.
  const interruptRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    stateRef.current = ctx.state;
  }, [ctx.state]);

  const subscribeTiming = useCallback((_listener: (frame: VoiceTimingFrame) => void) => {
    return () => {};
  }, []);

  const transcribeViaVoiceRoute = useCallback(async (audio: Blob) => {
    const form = new FormData();
    form.append("audio", audio, "speech.webm");
    form.append("mimeType", audio.type || "audio/webm");

    const res = await fetch("/api/voice/stt", {
      method: "POST",
      body: form,
    });
    const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
    if (!res.ok) {
      throw new Error(data?.error ?? `STT failed: ${res.status}`);
    }
    return data?.text ?? "";
  }, []);

  const synthesizeViaVoiceRoute = useCallback(async (text: string) => {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: currentVoiceId ?? undefined,
        format: "wav",
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `TTS failed: ${res.status}`);
    }
    return res.arrayBuffer();
  }, [currentVoiceId]);

  // Route + transport snapshot. This is declared before useVoiceChat so the
  // legacy hook can be disabled when the server-side realtime transport wins.
  const [runtime, setRuntime] = useState<VoiceRuntimeSnapshot | null>(null);
  const isRealtime = runtime?.transport.mode === "realtime";
  const isRealtimeRef = useRef(false);
  useEffect(() => {
    isRealtimeRef.current = isRealtime;
  }, [isRealtime]);

  const voiceChat = useVoiceChat({
    enabled: enabled && !isRealtime,
    onTranscript: (text) => {
      dispatchCtx({ type: "TRANSCRIPT_PARTIAL", text });
    },
    onAutoSend: (text) => {
      const trimmed = (text ?? "").trim();
      if (!trimmed) return;
      dispatchCtx({ type: "TRANSCRIPT_FINAL", text: trimmed });
      onTranscriptFinal?.(trimmed);
    },
    inputDeviceId,
    outputDeviceId,
    transcribeAudio: transcribeViaVoiceRoute,
    synthesizeSpeech: synthesizeViaVoiceRoute,
    voiceOwnerId: voiceOwnerIdRef.current,
  });

  // Bridge useVoiceChat booleans into state-machine events. Treat its booleans
  // as the source of truth for mic/playback lifecycle until T3 replaces them.
  const prevIsListening = useRef(false);
  const prevIsSpeaking = useRef(false);
  const prevError = useRef<string | null>(null);
  const continuousArmedRef = useRef(false);
  const [continuousArmed, setContinuousArmed] = useState(false);

  const armContinuous = useCallback(() => {
    continuousArmedRef.current = true;
    setContinuousArmed(true);
  }, []);

  const disarmContinuous = useCallback(() => {
    continuousArmedRef.current = false;
    setContinuousArmed(false);
  }, []);

  const isVoiceChatListening = voiceChat.isListening;
  const stopVoiceSpeaking = voiceChat.stopSpeaking;

  useEffect(() => {
    if (isRealtime) return;
    if (isVoiceChatListening && !prevIsListening.current) {
      // Barge-in: mic activating mid-turn — abort the in-flight LLM fetch
      // *before* we change state so the server-side stream is cut off, not
      // just the audio. The state machine then transitions
      // speaking/thinking → arming via MIC_REQUESTED.
      const interruptible =
        stateRef.current === "speaking" ||
        stateRef.current === "thinking" ||
        stateRef.current === "submitting";
      if (interruptible && speechHandleRef.current) {
        const handle = speechHandleRef.current;
        handle.interrupt("user-barge-in");
        speechHandleRef.current = null;
        agentOutputRef.current?.interrupt(handle, "user-barge-in");
        // Stop the non-streaming lane too — fillers + WAV queue live on
        // voiceChat's own AudioContext and would keep playing through a
        // barge-in otherwise.
        stopVoiceSpeaking();
      }
      dispatchCtx({ type: "MIC_REQUESTED" });
      dispatchCtx({ type: "MIC_GRANTED" });
    } else if (!isVoiceChatListening && prevIsListening.current) {
      dispatchCtx({ type: "VOICE_ENDED" });
    }
    prevIsListening.current = isVoiceChatListening;
  }, [isRealtime, isVoiceChatListening, stopVoiceSpeaking]);

  useEffect(() => {
    if (!enabled || isRealtime || ctx.state !== "transcribing") return;
    const enteredAt = ctx.enteredAt;
    const timer = window.setTimeout(() => {
      if (stateRef.current === "transcribing" && ctx.enteredAt === enteredAt) {
        dispatchCtx({ type: "TRANSCRIPT_EMPTY" });
      }
    }, TRANSCRIBING_WATCHDOG_MS);
    return () => window.clearTimeout(timer);
  }, [ctx.enteredAt, ctx.state, enabled, isRealtime]);

  // Thinking watchdog — if AUDIO_STARTED never arrives, fall back to idle
  // instead of leaving the orb frozen. Mirrors the transcribing watchdog.
  useEffect(() => {
    if (!enabled || ctx.state !== "thinking") return;
    const enteredAt = ctx.enteredAt;
    const timer = window.setTimeout(() => {
      if (stateRef.current === "thinking" && ctx.enteredAt === enteredAt) {
        dispatchCtx({ type: "AUDIO_STOPPED" });
      }
    }, THINKING_WATCHDOG_MS);
    return () => window.clearTimeout(timer);
  }, [ctx.enteredAt, ctx.state, enabled]);

  useEffect(() => {
    if (isRealtime) return;
    const decision = decideSpeakingBridge(
      prevIsSpeaking.current,
      voiceChat.isSpeaking,
      replyInFlightRef.current,
      false,
    );
    if (decision.event) dispatchCtx({ type: decision.event });
    prevIsSpeaking.current = decision.nextPrev;
  }, [isRealtime, voiceChat.isSpeaking]);

  useEffect(() => {
    if (isRealtime) return;
    if (voiceChat.error && voiceChat.error !== prevError.current) {
      dispatchCtx({ type: "FAIL", error: voiceChat.error });
    }
    prevError.current = voiceChat.error;
  }, [isRealtime, voiceChat.error]);

  // Treat WS disconnect as a reconnect prompt.
  useEffect(() => {
    if (isRealtime) return;
    if (voiceChat.voiceApiStatus === "disconnected") {
      dispatchCtx({ type: "NETWORK_LOST" });
    } else if (voiceChat.voiceApiStatus === "connected") {
      dispatchCtx({ type: "NETWORK_RESTORED" });
    }
  }, [isRealtime, voiceChat.voiceApiStatus]);

  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [preset, setPresetState] = useState<VoiceRoutePreset>(initialPreset ?? "local");

  const loadRuntime = useCallback(async (p: VoiceRoutePreset) => {
    setRuntimeLoading(true);
    try {
      const res = await fetch(`/api/voice/runtime?preset=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (res.ok) setRuntime({ route: data.route, transport: data.transport });
    } catch {
      // Non-fatal: Health tab surfaces the problem.
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadRuntime(preset);
  }, [enabled, preset, loadRuntime]);

  const setRoute = useCallback((next: VoiceRoutePreset) => {
    setPresetState(next);
  }, []);

  // Latency — hook observes state transitions to derive per-turn timing.
  const [latency, setLatency] = useState<VoiceTurnLatency>({});
  const turnStartRef = useRef<number | null>(null);
  const speechEndRef = useRef<number | null>(null);
  const runStartRef = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    switch (ctx.state) {
      case "listening":
        turnStartRef.current = now;
        speechEndRef.current = null;
        runStartRef.current = null;
        setLatency({});
        break;
      case "transcribing":
        speechEndRef.current = now;
        break;
      case "submitting":
        if (speechEndRef.current) {
          setLatency((prev) => ({ ...prev, sttMs: now - speechEndRef.current! }));
        }
        runStartRef.current = now;
        break;
      case "thinking":
        if (!runStartRef.current) runStartRef.current = now;
        break;
      case "speaking":
        if (runStartRef.current) {
          setLatency((prev) => ({
            ...prev,
            firstAudioMs: now - runStartRef.current!,
            replyMs: prev.replyMs ?? now - runStartRef.current!,
          }));
        }
        break;
      default:
        break;
    }
  }, [ctx.state]);

  // ------- Tool/artifact stream + output -------

  const [pendingApproval, setPendingApproval] = useState<VoiceApprovalChallenge | null>(null);
  const [tools, setTools] = useState<VoiceToolState>({
    isRunning: false,
    currentToolName: null,
    artifacts: [],
  });
  const speechHandleRef = useRef<SpeechHandle | null>(null);
  // Active run id + cancellation are owned by the shared RunController
  // (lib/hooks/useRunController.ts) — chat's useAgentRun and this hook cancel
  // through the same ledger, so a run gets exactly one cancel POST.
  const internalRunController = useRunController();
  const runController = options.controller ?? internalRunController;
  const pendingApprovalRef = useRef<VoiceApprovalChallenge | null>(null);
  // True while ChatSurface's agentRun is streaming a reply. Bridges the
  // inter-phrase gap in the per-phrase TTS lane: `voiceChat.isSpeaking`
  // briefly flips false between queued phrases (pending=0), and without this
  // flag `decideSpeakingBridge` would fire AUDIO_STOPPED, idle the FSM, and
  // re-arm the mic mid-reply. Set/cleared by markAgentRun{Started,Finished}.
  const replyInFlightRef = useRef(false);

  const agentOutputRef = useRef<AgentOutput | null>(null);
  const streamingHandleSeqRef = useRef(0);
  const realtimeClientRef = useRef<VoiceAgentClient | null>(null);
  const realtimeInputRef = useRef<AgentInput | null>(null);
  const realtimeFirstAudioMarkedRef = useRef(false);
  const [realtimeAudioLevel, setRealtimeAudioLevel] = useState(0);

  const createAgentOutput = useCallback(() => {
    const output = new AgentOutput({ outputDeviceId });
    output.on("speechStart", ({ handle }) => {
      if (speechHandleRef.current === handle) {
        dispatchCtx({ type: "AUDIO_STARTED" });
      }
    });
    output.on("speechEnd", ({ handle }) => {
      // PhraseConductor emits one handle per phrase; firing AUDIO_STOPPED on
      // every phrase end idled the FSM, the continuous-mode effect re-opened
      // the mic 250 ms later, and the next phrase played into an open mic
      // → self-barge-in → echo loop. The full-reply terminal transition is
      // owned by `markAgentRunFinished` (called when ChatSurface's agentRun
      // completes). Per-handle ends are decorative here.
      if (replyInFlightRef.current) return;
      if (speechHandleRef.current === handle || handle.state === "done") {
        dispatchCtx({ type: "AUDIO_STOPPED" });
      }
    });
    return output;
  }, [outputDeviceId]);

  useEffect(() => {
    const wsUrl = runtime?.transport.wsUrl;
    const token = runtime?.transport.token;
    if (!enabled || !isRealtime || !wsUrl || !token) return;

    const ensureRealtimeHandle = () => {
      if (!agentOutputRef.current) agentOutputRef.current = createAgentOutput();
      let handle = speechHandleRef.current;
      if (!handle || handle.state === "interrupted" || handle.state === "done") {
        handle = new SpeechHandle(streamingHandleSeqRef.current++);
        speechHandleRef.current = handle;
      }
      return handle;
    };

    const client = new VoiceAgentClient({
      wsUrl,
      token,
      callbacks: {
        onStatus: () => {},
        onSpeechStarted: () => {
          globalThis.__voiceProbe?.mark("realtime_speech_started");
          void (async () => {
            const state = stateRef.current;
            if (state === "speaking" || state === "thinking" || state === "submitting") {
              await interruptRef.current?.();
            }
            dispatchCtx({ type: "MIC_REQUESTED" });
            dispatchCtx({ type: "MIC_GRANTED" });
          })();
        },
        onSpeechStopped: () => {
          globalThis.__voiceProbe?.mark("realtime_speech_stopped");
          dispatchCtx({ type: "VOICE_ENDED" });
        },
        onTranscriptionDelta: (text) => {
          globalThis.__voiceProbe?.mark("realtime_transcript_delta", { text });
          if (text) dispatchCtx({ type: "TRANSCRIPT_PARTIAL", text });
        },
        onTranscriptionCompleted: (text) => {
          const trimmed = text.trim();
          globalThis.__voiceProbe?.mark("realtime_transcript_final", { text: trimmed });
          dispatchCtx({ type: "TRANSCRIPT_FINAL", text: trimmed });
        },
        onResponseCreated: () => {
          realtimeFirstAudioMarkedRef.current = false;
          globalThis.__voiceProbe?.mark("realtime_response_created");
          if (!agentOutputRef.current) agentOutputRef.current = createAgentOutput();
          const prevHandle = speechHandleRef.current;
          if (prevHandle && prevHandle.state !== "done" && prevHandle.state !== "interrupted") {
            prevHandle.interrupt("new-realtime-response");
            agentOutputRef.current.interrupt(prevHandle, "new-realtime-response");
          }
          speechHandleRef.current = new SpeechHandle(streamingHandleSeqRef.current++);
          replyInFlightRef.current = true;
          dispatchCtx({ type: "RUN_STARTED" });
        },
        onAudioDelta: (pcm, sampleRate) => {
          if (!realtimeFirstAudioMarkedRef.current) {
            realtimeFirstAudioMarkedRef.current = true;
            globalThis.__voiceProbe?.mark("realtime_first_audio", { sampleRate, bytes: pcm.byteLength });
          }
          const output = agentOutputRef.current ?? createAgentOutput();
          agentOutputRef.current = output;
          const handle = ensureRealtimeHandle();
          void output.playPcm16Chunk(handle, pcm, sampleRate);
        },
        onAssistantTranscript: () => {},
        onResponseDone: (status, turnId) => {
          globalThis.__voiceProbe?.mark("realtime_response_done", { status });
          const handle = speechHandleRef.current;
          replyInFlightRef.current = false;
          if (!handle) return;
          if (status === "cancelled") {
            if (speechHandleRef.current === handle) speechHandleRef.current = null;
            return;
          }
          const output = agentOutputRef.current;
          if (!output) return;
          if (turnId !== undefined) {
            // Mac agent holds the next turn until playback is acked — ack at
            // real drain, not at finish(), or its VAD reopens over our speaker.
            const off = output.on("speechEnd", ({ handle: ended }) => {
              if (ended !== handle) return;
              off();
              client.ackPlayback(turnId);
            });
          }
          void output.finish(handle).finally(() => {
            if (speechHandleRef.current === handle && handle.state === "done") {
              speechHandleRef.current = null;
            }
          });
        },
        onError: (message) => {
          dispatchCtx({ type: "FAIL", error: message });
        },
      },
    });
    client.setMicPaused(true);

    const input = new AgentInput({
      inputDeviceId,
      audioFrameMode: "continuous",
      forceVadBackend: "energy",
    });
    const offFrame = input.on("audioFrame", ({ samples, sampleRate }) => {
      client.appendAudio(samples, sampleRate);
    });
    const offLevel = input.on("level", ({ rms }) => {
      setRealtimeAudioLevel(rms);
    });
    const offError = input.on("error", ({ message }) => {
      dispatchCtx({ type: "FAIL", error: message });
    });

    realtimeClientRef.current = client;
    realtimeInputRef.current = input;

    return () => {
      offFrame();
      offLevel();
      offError();
      if (realtimeClientRef.current === client) realtimeClientRef.current = null;
      if (realtimeInputRef.current === input) realtimeInputRef.current = null;
      client.close();
      void input.stop();
      setRealtimeAudioLevel(0);
    };
  }, [createAgentOutput, enabled, inputDeviceId, isRealtime, runtime?.transport.token, runtime?.transport.wsUrl]);

  // Tear down output resources on unmount.
  useEffect(() => {
    return () => {
      agentOutputRef.current?.stopAll();
      agentOutputRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Reroute the speaker when the user changes audio output.
    void agentOutputRef.current?.setOutputDevice(outputDeviceId);
  }, [outputDeviceId]);

  /**
   * Single fold for every AG-UI event arriving on the thread stream. The
   * decode is shared with chat (SSEParser + normalizeEvent upstream, the
   * lib/agui/events guards here); only the reactions are voice-specific:
   * tool state for the Newsroom surface, approval challenges, run tracking
   * for interrupt().
   */
  const handleAguiStreamEvent = useCallback(
    (event: AGUIEvent) => {
      if (isRunStarted(event)) {
        if (typeof event.runId === "string") {
          runController.begin(event.runId, "sse");
          replyInFlightRef.current = true;
        }
        return;
      }
      if (isRunFinished(event) || isRunError(event)) {
        // The stream may only finish runs it announced; chat-owned runs are
        // finished by markAgentRunFinished.
        if (
          typeof event.runId === "string" &&
          runController.finish(event.runId, { onlySource: "sse" })
        ) {
          replyInFlightRef.current = false;
        }
        return;
      }
      if (isToolCallStart(event)) {
        setTools((prev) => ({
          ...prev,
          isRunning: true,
          currentToolName: event.toolName,
        }));
        return;
      }
      if (isToolCallResult(event)) {
        setTools((prev) => ({ ...prev, isRunning: false, currentToolName: null }));
        return;
      }
      if (isArtifactCreated(event)) {
        const artifact: Artifact = {
          id: event.artifactId,
          url: event.url,
          name: event.name,
          mimeType: event.mimeType,
        };
        setTools((prev) => ({ ...prev, artifacts: [...prev.artifacts, artifact] }));
        return;
      }
      if (isInterruptRequested(event)) {
        // Canonical emitters carry the approval envelope in the typed
        // `data` field (InterruptApprovalData). DeckPayload-wrapped `args`
        // and top-level fields remain as defensive fallbacks.
        const data = event.data;
        const argsData =
          event.args && typeof event.args === "object"
            ? (((event.args as { data?: unknown }).data ?? event.args) as Record<string, unknown> | null)
            : null;
        const argsApproval =
          argsData && argsData.kind === "approval" ? argsData : null;
        if (data?.kind === "approval" || argsApproval || (!data && !argsApproval)) {
          const approvalId =
            data?.approvalId ??
            (argsApproval?.approvalId as string | undefined) ??
            event.toolCallId ??
            `appr-${Date.now()}`;
          const toolName =
            data?.toolName ??
            (argsApproval?.toolName as string | undefined) ??
            event.toolName ??
            "tool";
          const riskRaw =
            data?.riskLevel ?? (argsApproval?.riskLevel as string | undefined);
          const risk = (riskRaw ?? "medium") as VoiceApprovalChallenge["risk"];
          const requiredPhrase = `confirm ${toolName.replace(/[^a-z0-9]+/gi, " ").trim()}`;
          const challenge: VoiceApprovalChallenge = {
            approvalId,
            toolName,
            risk,
            summary: `${toolName} needs your approval before it runs.`,
            requiredPhrase,
            expiresAt: Date.now() + 60_000,
          };
          realtimeClientRef.current?.setInterruptEnabled(false);
          setPendingApproval(challenge);
          dispatchCtx({ type: "APPROVAL_CHALLENGE" });
        }
        return;
      }
      if (isInterruptResolved(event)) {
        realtimeClientRef.current?.setInterruptEnabled(true);
        setPendingApproval(null);
      }
    },
    [runController],
  );

  const attachThread = useCallback(
    (threadId: string) => {
      if (typeof window === "undefined" || !threadId) return () => {};

      // fetch + SSEParser (not EventSource) so the thread stream goes through
      // the one shared codec. Reconnect mirrors EventSource's auto-retry with
      // a fixed-delay re-connect loop.
      let closed = false;
      let retryTimer: number | null = null;
      let abort: AbortController | null = null;

      const connect = async () => {
        const ctrl = new AbortController();
        abort = ctrl;
        const parser = new SSEParser();
        try {
          const res = await fetch(
            `/api/agui/stream?threadId=${encodeURIComponent(threadId)}`,
            { signal: ctrl.signal, cache: "no-store" },
          );
          if (!res.ok || !res.body) throw new Error(`agui stream HTTP ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
              handleAguiStreamEvent(event);
            }
          }
          for (const event of parser.feed(decoder.decode())) {
            handleAguiStreamEvent(event);
          }
          for (const event of parser.flush()) {
            handleAguiStreamEvent(event);
          }
        } catch {
          // Aborted during teardown or a transient failure — retry unless closed.
        }
        if (!closed) retryTimer = window.setTimeout(connect, AGUI_STREAM_RETRY_MS);
      };

      void connect();
      return () => {
        closed = true;
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        abort?.abort();
      };
    },
    [handleAguiStreamEvent],
  );


  // ------- Lifecycle controls -------

  // Synchronous gesture unlock — lazy-creates the AgentOutput and resumes its
  // AudioContext from inside a real click handler. Without this, the first TTS
  // chunk plays into a suspended context and the user hears nothing.
  const unlockOutput = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!agentOutputRef.current) {
      agentOutputRef.current = createAgentOutput();
    }
    try {
      await agentOutputRef.current.ensureReady();
    } catch (err) {
      console.warn("[useVoiceSession] unlockOutput failed:", err);
    }
  }, [createAgentOutput]);

  const markAgentRunStarted = useCallback((runId?: string) => {
    // No id of our own: retag the current run as chat-surface-owned so the
    // agui stream can't finish it out from under the chat turn.
    runController.begin(runId ?? null, "chat-surface");
    replyInFlightRef.current = true;
    dispatchCtx({ type: "RUN_STARTED" });
  }, [runController]);

  const markAgentRunFinished = useCallback(() => {
    runController.finish();
    replyInFlightRef.current = false;
    const state = stateRef.current;
    if (state === "thinking" || state === "speaking") {
      dispatchCtx({ type: "AUDIO_STOPPED" });
    } else if (state === "submitting") {
      dispatchCtx({ type: "RESET" });
    }
  }, [runController]);

  const beginStreamingReply = useCallback((): StreamingReplyHandle | null => {
    return null;
  }, []);

  const setLabOverrides = useCallback((_overrides: VoiceLabOverrides) => {}, []);

  const startListening = useCallback(async () => {
    if (!enabled) return;
    if (isRealtimeRef.current) {
      await unlockOutput();
      if (prefs.voice.mode === "vad") armContinuous();
      if (stateRef.current === "speaking" && interruptRef.current) {
        await interruptRef.current();
      }
      const client = realtimeClientRef.current;
      const input = realtimeInputRef.current;
      if (!client || !input) {
        dispatchCtx({ type: "FAIL", error: "Realtime voice transport is not ready" });
        return;
      }
      dispatchCtx({ type: "MIC_REQUESTED" });
      client.setMicPaused(true);
      try {
        await Promise.all([input.start(), client.connect()]);
        client.setMicPaused(false);
        dispatchCtx({ type: "MIC_GRANTED" });
      } catch (err) {
        client.setMicPaused(true);
        await input.stop().catch(() => undefined);
        const message = err instanceof Error ? err.message : "Could not start realtime voice";
        dispatchCtx({ type: "MIC_DENIED", error: message });
      }
      return;
    }
    // Take advantage of the gesture that triggered startListening to unlock
    // the output context too — most surfaces wire mic + speak to the same orb.
    void unlockOutput();
    if (prefs.voice.mode === "vad") armContinuous();
    // Speaking-state gate: an opener arriving while the assistant is talking
    // is an implicit barge-in. Run the full interrupt() path so INTERRUPT
    // dispatches, server-side run is cancelled, and TTS/output is torn down
    // BEFORE we open the mic — otherwise Silero VAD picks up the assistant's
    // own audio bleeding through speakers and submits empty turns.
    // `interrupt` is defined later in this hook so we route through a ref
    // populated by a useEffect at the bottom.
    if (stateRef.current === "speaking" && interruptRef.current) {
      await interruptRef.current();
    }
    // Eagerly dispatch MIC_REQUESTED so the FSM enters `arming` in the same
    // render as the gesture, collapsing the 1-render window where
    // `voiceChat.isListening` is true but FSM still says `idle`. The bridge
    // effect's redundant re-dispatch is ignored by the reducer in `arming`.
    dispatchCtx({ type: "MIC_REQUESTED" });
    await voiceChat.startListening();
  }, [armContinuous, enabled, prefs.voice.mode, unlockOutput, voiceChat]);

  const stopListening = useCallback(async () => {
    disarmContinuous();
    if (isRealtimeRef.current) {
      realtimeClientRef.current?.setMicPaused(true);
      setRealtimeAudioLevel(0);
      return;
    }
    await voiceChat.stopListening();
  }, [disarmContinuous, voiceChat]);

  useEffect(() => {
    if (!enabled) return;
    if (isRealtime) return;
    if (!continuousArmed) return;
    if (prefs.voice.mode !== "vad") return;
    if (voiceChat.voiceApiStatus !== "connected") return;
    if (voiceChat.isListening || voiceChat.isSpeaking || voiceChat.isProcessingSTT || voiceChat.isProcessingTTS) return;
    if (ctx.state !== "idle" && ctx.state !== "interrupted") return;

    const timer = window.setTimeout(() => {
      if (!continuousArmedRef.current) return;
      if (voiceChat.isListening || voiceChat.isSpeaking || voiceChat.isProcessingSTT || voiceChat.isProcessingTTS) return;
      void voiceChat.startListening();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    continuousArmed,
    ctx.state,
    enabled,
    prefs.voice.mode,
    voiceChat,
    voiceChat.isListening,
    voiceChat.isProcessingSTT,
    voiceChat.isProcessingTTS,
    voiceChat.isSpeaking,
    voiceChat.voiceApiStatus,
    isRealtime,
  ]);

  const confirmApproval = useCallback(
    async (decision: "approved" | "rejected", reason?: string) => {
      const challenge = pendingApprovalRef.current;
      if (!challenge) return;
      const runId = runController.peekRunId();
      // Clear local state + FSM eagerly so the UI snaps even if the network
      // call is slow.
      setPendingApproval(null);
      dispatchCtx({
        type: decision === "approved" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      });
      realtimeClientRef.current?.setInterruptEnabled(true);
      try {
        const url = decision === "approved" ? "/api/chat/approve" : "/api/chat/reject";
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId,
            approvalId: challenge.approvalId,
            reason,
          }),
          keepalive: true,
        });
      } catch (err) {
        console.warn("[useVoiceSession] confirmApproval network error:", err);
      }
    },
    [runController],
  );

  const interrupt = useCallback(async () => {
    if (isRealtimeRef.current) {
      realtimeClientRef.current?.cancelResponse();
    }
    replyInFlightRef.current = false;
    const handle = speechHandleRef.current;
    handle?.interrupt("user-interrupt");
    speechHandleRef.current = null;
    dispatchCtx({ type: "INTERRUPT" });
    if (handle) agentOutputRef.current?.interrupt(handle, "user-interrupt");
    else agentOutputRef.current?.stopAll();
    if (!isRealtimeRef.current) {
      voiceChat.stopSpeaking();
      voiceChat.clearQueue();
    }
    // Tell the server to actually stop the run. The controller owns the
    // cancel POST and dedupes it client-wide, so a chat-side stop() racing
    // this interrupt still produces exactly one request per run.
    runController.cancel();
  }, [voiceChat, runController]);

  // Wire the forward-ref so `startListening`'s speaking-state barge-in gate
  // can reach `interrupt` even though it's declared later in this hook.
  interruptRef.current = interrupt;

  // Latest-ref so the subscription captures the most recent callbacks without
  // re-subscribing on every render (which used to stack listeners and tear
  // down in-flight turns from a stale closure).
  const voiceActivityHandlerRef = useRef<() => void>(() => {});
  voiceActivityHandlerRef.current = () => {
    disarmContinuous();
    void interrupt();
  };
  useEffect(() => {
    if (!enabled) return;
    return subscribeVoiceActivity(voiceOwnerIdRef.current, () => {
      voiceActivityHandlerRef.current();
    });
  }, [enabled]);

  const reset = useCallback(() => {
    disarmContinuous();
    if (isRealtimeRef.current) {
      realtimeClientRef.current?.setMicPaused(true);
      realtimeClientRef.current?.cancelResponse();
      setRealtimeAudioLevel(0);
    }
    replyInFlightRef.current = false;
    // Clear run ownership without posting a cancel — reset tears the session
    // down but is not an interrupt. (The old code only cleared the source
    // ref, leaking a stale run id that a later interrupt would cancel.)
    runController.finish();
    speechHandleRef.current?.interrupt("reset");
    speechHandleRef.current = null;
    dispatchCtx({ type: "RESET" });
    voiceChat.clearTranscript();
    voiceChat.clearError();
    setTools({ isRunning: false, currentToolName: null, artifacts: [] });
    setPendingApproval(null);
  }, [disarmContinuous, voiceChat, runController]);

  // Mirror pendingApproval into a ref so confirmApproval stays a stable callback.
  useEffect(() => {
    pendingApprovalRef.current = pendingApproval;
  }, [pendingApproval]);

  return useMemo<VoiceSessionApi>(
    () => ({
      state: ctx.state,
      stateLabel: labelForState(ctx.state),
      transcriptPartial: ctx.transcriptPartial,
      transcriptFinal: ctx.transcriptFinal,
      audioLevel: isRealtime ? realtimeAudioLevel : voiceChat.audioLevel,
      isListening: stateIsListening(ctx.state),
      isSpeaking: ctx.state === "speaking",
      isInterruptible: stateIsInterruptible(ctx.state),
      error: ctx.error,

      runtime,
      runtimeLoading,
      currentRoutePreset: preset,
      latency,

      currentVoiceId,
      currentDevices,

      tools,

      pendingApproval,
      confirmApproval,

      setRoute,
      setVoice,
      setDevices,

      startListening,
      stopListening,
      interrupt,
      reset,
      unlockOutput,
      markAgentRunStarted,
      markAgentRunFinished,
      beginStreamingReply,

      attachThread,

      speak: voiceChat.speak,
      queueSpeech: voiceChat.queueSpeech,
      stopSpeaking: voiceChat.stopSpeaking,

      setLabOverrides,
      subscribeTiming,

      voiceChat,
    }),
    [
      ctx.state,
      ctx.transcriptPartial,
      ctx.transcriptFinal,
      ctx.error,
      voiceChat,
      runtime,
      isRealtime,
      realtimeAudioLevel,
      runtimeLoading,
      preset,
      latency,
      currentVoiceId,
      currentDevices,
      tools,
      pendingApproval,
      confirmApproval,
      setRoute,
      setVoice,
      setDevices,
      startListening,
      stopListening,
      interrupt,
      reset,
      unlockOutput,
      markAgentRunStarted,
      markAgentRunFinished,
      beginStreamingReply,
      attachThread,
      setLabOverrides,
      subscribeTiming,
    ],
  );
}
