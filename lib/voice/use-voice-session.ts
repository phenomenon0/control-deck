"use client";

/**
 * Voice session hook — the canonical runtime the UI talks to.
 *
 * Composes the existing `useVoiceChat` primitive (mic, WebSocket, playback)
 * with the session state machine (`session-machine.ts`) and a route/latency
 * overlay that fetches `/api/voice/runtime`. Phase 3 added the
 * **conductor** layer: `runTurn(text)` orchestrates a full assistant turn —
 * POST `/api/chat`, stream the response, split into phrases, queue TTS,
 * await drain. Tool/artifact events from the agentic SSE stream are also
 * consumed here so any voice surface can read `tools` and `turns`.
 *
 * Every voice surface (Live tab, fullscreen VoiceModeSheet, inline chat
 * mic) should consume this hook instead of calling `useVoiceChat` directly.
 * Sharing a single session means a single WebSocket, one transcript, one
 * state, one turn-buffer.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useVoiceChat, type UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import {
  initialContext,
  reduceVoiceSession,
  labelForState,
  isInterruptible as stateIsInterruptible,
  isListening as stateIsListening,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "@/lib/voice/session-machine";
import {
  cleanResponseForDisplay,
  getToolStartMessage,
} from "@/lib/voice/conductor";
import { PhraseConductor } from "@/lib/voice/phrase-conductor";
import { SpeechHandle } from "@/lib/voice/speech-handle";
import { StreamingTtsClient } from "@/lib/voice/streaming-tts";
import { StreamingSttClient } from "@/lib/voice/streaming-stt";
import { AgentOutput } from "@/lib/voice/audio-output";
import {
  claimVoiceActivity,
  createVoiceOwnerId,
  subscribeVoiceActivity,
} from "@/lib/voice/activity-bus";
import { shouldRouteToVoiceCore } from "@/lib/inference/voice-core/sidecar-url";
import { isNoiseTranscript } from "@/lib/voice/noise-filter";
import type { VoiceRoutePreset } from "@/lib/voice/resolve-voice-route";
import type { Artifact } from "@/lib/types/chat";
import { newVoiceTurn, type VoiceTurn, type VoiceTurnSource, type AudioSurface } from "@/lib/voice/turn";
import type { VoiceApprovalChallenge } from "@/lib/voice/voice-approval";
import type { AudioMode } from "@/lib/audio/audio-modes";

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
    mode: "local-sidecar" | "app-gateway" | "realtime";
    sidecar: "ok" | "unreachable" | "unknown";
    wsUrl: string | null;
  };
}

export interface VoiceTurnLatency {
  sttMs?: number;
  replyMs?: number;
  firstAudioMs?: number;
}

export type VoiceTurnRole = "user" | "assistant" | "system";

export interface VoiceTurnEntry {
  id: string;
  role: VoiceTurnRole;
  content: string;
  isStreaming?: boolean;
  artifacts?: Artifact[];
}

export interface VoiceToolState {
  isRunning: boolean;
  currentToolName: string | null;
  artifacts: Artifact[];
}

export interface RunTurnOptions {
  threadId: string;
  model: string;
  /** Called once the assistant turn finishes streaming. */
  onComplete?: (userText: string, assistantText: string) => void;
  /**
   * Voice provenance for this turn. When present, /api/chat receives a
   * `voice` block stamped with the turn id; the dock and the run ledger
   * can correlate spoken vs. typed turns later.
   */
  voice?: {
    routeId: string;
    mode: AudioMode;
    surface: AudioSurface;
    source: VoiceTurnSource;
  };
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

  /** Conductor turn buffer + tool state. */
  turns: VoiceTurnEntry[];
  tools: VoiceToolState;

  /** Last/current first-class voice turn — set when runTurn is invoked with `voice`. */
  currentTurn: VoiceTurn | null;

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
   * Run one assistant turn end-to-end: POST /api/chat → stream → phrase-split
   * → queue TTS → await speech drain. Calling `interrupt()` mid-flight
   * aborts the fetch and drains the TTS queue.
   */
  runTurn(text: string, opts: RunTurnOptions): Promise<void>;

  /** Subscribe to agentic tool events on a thread. Returns an unsubscribe. */
  attachThread(threadId: string): () => void;

  clearTurns(): void;

  /** Escape hatch for read-aloud and speak-on-submit paths. */
  speak(text: string): Promise<void>;
  queueSpeech(text: string): void;
  stopSpeaking(): void;

  /** Underlying `useVoiceChat` handle — needed until T3 finishes the split. */
  voiceChat: UseVoiceChatReturn;
}

interface UseVoiceSessionOptions {
  enabled?: boolean;
  onTranscriptFinal?: (text: string) => void;
  preset?: VoiceRoutePreset;
}

const TRANSCRIBING_WATCHDOG_MS = 12_000;
// Thinking has no audio yet — if it's still ours after this long, the LLM/TTS
// path likely failed silently. Bail to idle so the orb doesn't freeze.
const THINKING_WATCHDOG_MS = 20_000;

function waitForAgentOutputEnd(
  output: AgentOutput,
  handle: SpeechHandle,
  timeoutMs = 30000,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let offEnd: (() => void) | null = null;
    let offDrained: (() => void) | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      offEnd?.();
      offDrained?.();
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    offEnd = output.on("speechEnd", ({ handle: ended }) => {
      if (ended === handle) finish();
    });
    offDrained = output.on("drained", finish);
  });
}

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

  // Voice id stays in-memory until Task 8 wires it to the library; device IDs
  // are persisted via DeckSettings so they survive reloads and are shared
  // across every voice surface.
  const [currentVoiceId, setCurrentVoiceIdState] = useState<string | null>(null);
  const currentDevices = useMemo(
    () => ({ inputId: inputDeviceId, outputId: outputDeviceId }),
    [inputDeviceId, outputDeviceId],
  );

  const setVoice = useCallback((id: string | null) => setCurrentVoiceIdState(id), []);
  const setDevices = useCallback(
    (opts: { inputId?: string | null; outputId?: string | null }) => {
      const next: Partial<typeof prefs.voice> = {};
      if (opts.inputId !== undefined) next.audioInputId = opts.inputId;
      if (opts.outputId !== undefined) next.audioOutputId = opts.outputId;
      if (Object.keys(next).length > 0) updateVoicePrefs(next);
    },
    [updateVoicePrefs],
  );

  // Streaming STT lifecycle — one client per listening session, replaced
  // on engine change. Constructed lazily inside the mic-frame callback so
  // we don't open a WS until the user actually starts speaking.
  const streamingSttRef = useRef<StreamingSttClient | null>(null);
  const sttModelRef = useRef<string | null>(null);
  const useStreamingSttRef = useRef(false);
  const [useStreamingStt, setUseStreamingStt] = useState(false);
  const sttFinalTimeoutRef = useRef<number | null>(null);

  const clearSttFinalTimeout = useCallback(() => {
    if (sttFinalTimeoutRef.current === null) return;
    window.clearTimeout(sttFinalTimeoutRef.current);
    sttFinalTimeoutRef.current = null;
  }, []);

  // Latest-ref so the cached StreamingSttClient's `onFinal` callback always
  // dispatches the most recent `onTranscriptFinal` rather than the one from
  // the render where the client was first constructed.
  const onTranscriptFinalRef = useRef(onTranscriptFinal);
  onTranscriptFinalRef.current = onTranscriptFinal;

  const ensureStreamingSttClient = useCallback((): StreamingSttClient | null => {
    if (!useStreamingSttRef.current) return null;
    const model = sttModelRef.current;
    if (!model) return null;
    let client = streamingSttRef.current;
    if (client) return client;
    // Two-stage correction: when the streaming engine is the lightweight
    // sherpa Zipformer, run buffered audio through whisper.cpp large-v3-turbo
    // on Mac for the strongest possible finals. ~1.6 GB on disk, RTF ~0.4 with
    // Metal (no CoreML in pywhispercpp pip wheel), so a 6 s utterance takes
    // ~2.5 s to correct — slower than base.en but more robust on noisy mic
    // audio, accents, jargon, and proper nouns. The sherpa partials still
    // give the live-feel; turbo lands the cleanup beat after end of speech.
    // On T2_CUDA we'd want faster-whisper here instead.
    const correctionEngine = model === "sherpa-onnx-streaming"
      ? "whisper-large-v3-turbo-cpp"
      : undefined;
    client = new StreamingSttClient({
      engine: model,
      correctionEngine,
      onPartial: (text) => {
        if (text) dispatchCtx({ type: "TRANSCRIPT_PARTIAL", text });
      },
      onFinal: (text) => {
        clearSttFinalTimeout();
        const trimmed = (text ?? "").trim();
        if (!trimmed) {
          dispatchCtx({ type: "TRANSCRIPT_EMPTY" });
          return;
        }
        dispatchCtx({ type: "TRANSCRIPT_FINAL", text: trimmed });
        onTranscriptFinalRef.current?.(trimmed);
      },
      onError: (err) => {
        console.warn("[useVoiceSession] streaming stt error:", err);
        clearSttFinalTimeout();
        dispatchCtx({ type: "FAIL", error: err });
      },
    });
    streamingSttRef.current = client;
    void client.connect();
    return client;
  }, [clearSttFinalTimeout]);

  const handleMicFrame = useCallback((frame: Float32Array, sampleRate: number) => {
    const client = ensureStreamingSttClient();
    if (!client) return;
    client.pushFloat32(frame, sampleRate);
  }, [ensureStreamingSttClient]);

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

  const voiceChat = useVoiceChat({
    enabled,
    onTranscript: (text) => {
      dispatchCtx({ type: "TRANSCRIPT_PARTIAL", text });
    },
    onAutoSend: (text) => {
      dispatchCtx({ type: "TRANSCRIPT_FINAL", text });
      onTranscriptFinal?.(text);
    },
    inputDeviceId,
    outputDeviceId,
    onMicFrame: handleMicFrame,
    // Pass the ref (not the React state) so the blob-vs-streaming decision
    // inside mediaRecorder.onstop reads the freshest value. The state lags
    // one render and produced a double-TRANSCRIPT_FINAL race when STT mode
    // flipped between mic-down and mic-up.
    suppressBlobStt: useStreamingSttRef,
    transcribeAudio: transcribeViaVoiceRoute,
    synthesizeSpeech: synthesizeViaVoiceRoute,
    voiceOwnerId: voiceOwnerIdRef.current,
  });

  // Bridge useVoiceChat booleans into state-machine events. Treat its booleans
  // as the source of truth for mic/playback lifecycle until T3 replaces them.
  const prevIsListening = useRef(false);
  const prevIsSpeaking = useRef(false);
  const prevError = useRef<string | null>(null);
  const stateRef = useRef(ctx.state);
  const continuousArmedRef = useRef(false);
  const [continuousArmed, setContinuousArmed] = useState(false);
  useEffect(() => {
    stateRef.current = ctx.state;
  }, [ctx.state]);

  const armContinuous = useCallback(() => {
    continuousArmedRef.current = true;
    setContinuousArmed(true);
  }, []);

  const disarmContinuous = useCallback(() => {
    continuousArmedRef.current = false;
    setContinuousArmed(false);
  }, []);

  useEffect(() => {
    if (voiceChat.isListening && !prevIsListening.current) {
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
        streamingTtsRef.current?.close();
        streamingTtsRef.current = null;
        agentOutputRef.current?.interrupt(handle, "user-barge-in");
      }
      // New utterance — reset the streaming STT buffer so partials don't
      // bleed across turns.
      clearSttFinalTimeout();
      streamingSttRef.current?.reset();
      dispatchCtx({ type: "MIC_REQUESTED" });
      dispatchCtx({ type: "MIC_GRANTED" });
    } else if (!voiceChat.isListening && prevIsListening.current) {
      // End of utterance — ask the streaming STT to emit its final transcript.
      // The blob-STT path is suppressed when streaming is active, so this is
      // the only thing that produces TRANSCRIPT_FINAL.
      dispatchCtx({ type: "VOICE_ENDED" });
      if (useStreamingSttRef.current) {
        streamingSttRef.current?.final();
        clearSttFinalTimeout();
        sttFinalTimeoutRef.current = window.setTimeout(() => {
          sttFinalTimeoutRef.current = null;
          if (stateRef.current === "transcribing") {
            dispatchCtx({ type: "TRANSCRIPT_EMPTY" });
          }
        }, 15000);
      }
    }
    prevIsListening.current = voiceChat.isListening;
  }, [clearSttFinalTimeout, voiceChat.isListening]);

  useEffect(() => {
    if (!enabled || ctx.state !== "transcribing") return;
    const enteredAt = ctx.enteredAt;
    const timer = window.setTimeout(() => {
      if (stateRef.current === "transcribing" && ctx.enteredAt === enteredAt) {
        dispatchCtx({ type: "TRANSCRIPT_EMPTY" });
      }
    }, TRANSCRIBING_WATCHDOG_MS);
    return () => window.clearTimeout(timer);
  }, [ctx.enteredAt, ctx.state, enabled]);

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
    if (streamingTtsRef.current) {
      prevIsSpeaking.current = false;
      return;
    }
    if (voiceChat.isSpeaking && !prevIsSpeaking.current) {
      dispatchCtx({ type: "AUDIO_STARTED" });
    } else if (!voiceChat.isSpeaking && prevIsSpeaking.current) {
      dispatchCtx({ type: "AUDIO_STOPPED" });
    }
    prevIsSpeaking.current = voiceChat.isSpeaking;
  }, [voiceChat.isSpeaking]);

  useEffect(() => {
    if (voiceChat.error && voiceChat.error !== prevError.current) {
      dispatchCtx({ type: "FAIL", error: voiceChat.error });
    }
    prevError.current = voiceChat.error;
  }, [voiceChat.error]);

  // Treat WS disconnect as a reconnect prompt.
  useEffect(() => {
    if (voiceChat.voiceApiStatus === "disconnected") {
      dispatchCtx({ type: "NETWORK_LOST" });
    } else if (voiceChat.voiceApiStatus === "connected") {
      dispatchCtx({ type: "NETWORK_RESTORED" });
    }
  }, [voiceChat.voiceApiStatus]);

  // Route + transport snapshot
  const [runtime, setRuntime] = useState<VoiceRuntimeSnapshot | null>(null);

  // Sync streaming-STT activation with the resolved runtime — voice-core
  // engines (moonshine/sherpa-streaming/etc) get the WS partial path. There
  // is no legacy fallback path now that voice-core is the only local backend.
  useEffect(() => {
    const model = runtime?.route?.stt?.model ?? null;
    const next = shouldRouteToVoiceCore(model);
    sttModelRef.current = model;
    useStreamingSttRef.current = next;
    setUseStreamingStt(next);
    if (!next && streamingSttRef.current) {
      clearSttFinalTimeout();
      streamingSttRef.current.close();
      streamingSttRef.current = null;
    }
  }, [clearSttFinalTimeout, runtime]);

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

  // ------- Conductor: turn buffer + tool state + runTurn orchestrator -------

  const [turns, setTurns] = useState<VoiceTurnEntry[]>([]);
  const [currentTurn, setCurrentTurn] = useState<VoiceTurn | null>(null);
  const [pendingApproval, setPendingApproval] = useState<VoiceApprovalChallenge | null>(null);
  const [tools, setTools] = useState<VoiceToolState>({
    isRunning: false,
    currentToolName: null,
    artifacts: [],
  });
  const conversationRef = useRef<Array<{ role: string; content: string }>>([]);
  const speechHandleRef = useRef<SpeechHandle | null>(null);
  const turnSeqRef = useRef(0);
  // Latest runId of the in-flight turn — captured via ref so interrupt()
  // stays a stable callback while still able to fire a server-side cancel.
  const activeRunIdRef = useRef<string | null>(null);
  const pendingApprovalRef = useRef<VoiceApprovalChallenge | null>(null);

  // Streaming TTS path — constructed when the active TTS model is served by
  // voice-core (port 4245). voiceChat.queueSpeech remains as the per-phrase
  // fallback for any provider that doesn't speak the WS streaming protocol.
  const agentOutputRef = useRef<AgentOutput | null>(null);
  const streamingTtsRef = useRef<StreamingTtsClient | null>(null);

  const createAgentOutput = useCallback(() => {
    const output = new AgentOutput({ outputDeviceId });
    output.on("speechStart", ({ handle }) => {
      if (speechHandleRef.current === handle) {
        dispatchCtx({ type: "AUDIO_STARTED" });
      }
    });
    output.on("speechEnd", ({ handle }) => {
      if (speechHandleRef.current === handle || handle.state === "done") {
        dispatchCtx({ type: "AUDIO_STOPPED" });
      }
    });
    return output;
  }, [outputDeviceId]);

  // Tear down streaming TTS / STT resources when the output device or the
  // active engine changes (or on unmount).
  useEffect(() => {
    return () => {
      streamingTtsRef.current?.close();
      streamingTtsRef.current = null;
      agentOutputRef.current?.stopAll();
      agentOutputRef.current = null;
      clearSttFinalTimeout();
      streamingSttRef.current?.close();
      streamingSttRef.current = null;
    };
  }, [clearSttFinalTimeout]);

  useEffect(() => {
    // Reroute the speaker when the user changes audio output.
    void agentOutputRef.current?.setOutputDevice(outputDeviceId);
  }, [outputDeviceId]);

  const clearTurns = useCallback(() => {
    setTurns([]);
    setTools({ isRunning: false, currentToolName: null, artifacts: [] });
    conversationRef.current = [];
  }, []);

  const attachThread = useCallback((threadId: string) => {
    if (typeof window === "undefined" || !threadId) return () => {};

    // Hydrate conversation history so voice turns share context with typed
    // turns. Without this, voice runs are blind to prior typed messages in
    // the same thread, manifesting as the LLM "forgetting" the conversation.
    let cancelled = false;
    void fetch(`/api/threads?id=${encodeURIComponent(threadId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { messages?: Array<{ role: string; content: string }> } | null) => {
        if (cancelled || !data?.messages) return;
        // Only seed if no live turn has appended yet — avoids clobbering an
        // in-flight conversation that started before the fetch returned.
        if (conversationRef.current.length === 0) {
          conversationRef.current = data.messages
            .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
            .map((m) => ({ role: m.role, content: m.content }));
        }
      })
      .catch(() => {
        /* non-fatal: voice turn just runs with no prior context */
      });

    const eventSource = new EventSource(`/api/agui/stream?threadId=${threadId}`);
    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "ToolCallStart") {
          setTools((prev) => ({
            ...prev,
            isRunning: true,
            currentToolName: event.toolName,
          }));
          const toolMsg = getToolStartMessage(event.toolName);
          if (toolMsg) {
            setTurns((prev) => [
              ...prev,
              { id: `tool-${event.toolCallId}`, role: "system", content: toolMsg },
            ]);
          }
        }
        if (event.type === "ToolCallResult") {
          setTools((prev) => ({ ...prev, isRunning: false, currentToolName: null }));
        }
        if (event.type === "ArtifactCreated") {
          const artifact: Artifact = {
            id: event.artifactId,
            url: event.url,
            name: event.name,
            mimeType: event.mimeType,
          };
          setTools((prev) => ({ ...prev, artifacts: [...prev.artifacts, artifact] }));
        }
        if (event.type === "InterruptRequested") {
          // Both lib/approvals/gate.ts and apps/agent-ts/loop.ts shape this
          // payload differently. Pull approval-specific fields from either.
          const data =
            (event.data && typeof event.data === "object" ? event.data : null) ?? null;
          const argsData =
            event.args && typeof event.args === "object"
              ? (event.args as { data?: unknown; format?: string }).data ?? event.args
              : null;
          const payload = (data ?? argsData) as Record<string, unknown> | null;
          const kind = payload && typeof payload.kind === "string" ? payload.kind : null;
          if (kind === "approval" || kind === null) {
            const approvalId =
              (payload && typeof payload.approvalId === "string" && payload.approvalId) ||
              event.toolCallId ||
              `appr-${Date.now()}`;
            const toolName =
              (payload && typeof payload.toolName === "string" && payload.toolName) ||
              event.toolName ||
              "tool";
            const risk =
              payload && typeof payload.riskLevel === "string"
                ? (payload.riskLevel as VoiceApprovalChallenge["risk"])
                : "medium";
            const requiredPhrase = `confirm ${toolName.replace(/[^a-z0-9]+/gi, " ").trim()}`;
            const challenge: VoiceApprovalChallenge = {
              approvalId,
              toolName,
              risk,
              summary: `${toolName} needs your approval before it runs.`,
              requiredPhrase,
              expiresAt: Date.now() + 60_000,
            };
            setPendingApproval(challenge);
            dispatchCtx({ type: "APPROVAL_CHALLENGE" });
          }
        }
        if (event.type === "InterruptResolved") {
          setPendingApproval(null);
        }
      } catch (err) {
        console.warn("[useVoiceSession] Failed to parse SSE event:", err);
      }
    };
    eventSource.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };
    return () => {
      cancelled = true;
      eventSource.close();
    };
  }, []);

  const runTurn = useCallback(
    async (text: string, opts: RunTurnOptions) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Filter noise transcripts (filler words, single tokens, repeated
      // characters) before they reach the LLM. Sherpa-streaming and other
      // VAD-fronted engines hallucinate fillers like "you", "uh", "the"
      // on background noise — submitting those wastes tokens and confuses
      // the model.
      if (isNoiseTranscript(trimmed)) {
        console.log("[useVoiceSession] dropping noise transcript:", trimmed);
        return;
      }
      claimVoiceActivity(voiceOwnerIdRef.current, "turn");

      // Drop any in-flight turn before starting a new one.
      speechHandleRef.current?.interrupt("new-turn");
      dispatchCtx({ type: "RUN_STARTED" });

      const handle = new SpeechHandle(turnSeqRef.current++);
      speechHandleRef.current = handle;

      // First-class VoiceTurn — stamps /api/chat + future AG-UI events.
      // Pre-allocate a runId on the client so interrupt() can target the
      // exact run via /api/chat/runs/:runId/cancel without waiting for
      // the server to round-trip its own id back.
      const turnRunId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const voiceTurn = opts.voice
        ? newVoiceTurn({
            threadId: opts.threadId,
            mode: opts.voice.mode,
            routeId: opts.voice.routeId,
            surface: opts.voice.surface,
            source: opts.voice.source,
            runId: turnRunId,
          })
        : null;
      if (voiceTurn) {
        voiceTurn.marks.llm.submittedAt = Date.now();
        setCurrentTurn(voiceTurn);
      }
      activeRunIdRef.current = turnRunId;

      // Decide TTS lane for this turn. voice-core streams Int16 PCM so we
      // can play the first chunk as soon as synthesis begins; non-voice-core
      // providers go through the per-phrase WAV fallback.
      const ttsModel = runtime?.route?.tts?.model ?? null;
      const useStreamingTts = shouldRouteToVoiceCore(ttsModel);
      let ttsClient: StreamingTtsClient | null = null;
      if (useStreamingTts) {
        // Lazily build (or rebuild) the AgentOutput so the post-processing
        // graph + speaker-routing live across turns.
        if (!agentOutputRef.current) {
          agentOutputRef.current = createAgentOutput();
        }
        const output = agentOutputRef.current;
        // One client per turn keeps utteranceId scoping clean and gives us a
        // simple `close()` on interrupt.
        ttsClient = new StreamingTtsClient({
          engine: ttsModel ?? undefined,
          voice: currentVoiceId ?? undefined,
          onChunk: ({ pcm, sampleRate }) => {
            void output.playPcm16Chunk(handle, pcm, sampleRate);
          },
          onError: (err) => {
            console.warn("[useVoiceSession] streaming tts error:", err);
          },
        });
        streamingTtsRef.current?.close();
        streamingTtsRef.current = ttsClient;
      }

      voiceChat.playFiller();

      const userId = `user-${Date.now()}`;
      const assistantId = `assistant-${Date.now()}`;
      setTurns((prev) => [
        ...prev,
        { id: userId, role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);
      // Drop a trailing user message left over from a turn that was
      // interrupted before its assistant push could land. Without this,
      // rapid utterances accumulate `[user, user, ...]` runs in
      // conversationRef and the LLM gets a malformed transcript.
      const lastEntry = conversationRef.current[conversationRef.current.length - 1];
      if (lastEntry?.role === "user") {
        conversationRef.current.pop();
      }
      conversationRef.current.push({ role: "user", content: trimmed });

      let fullResponse = "";
      const streamingTtsJobs: Promise<void>[] = [];
      const conductor = new PhraseConductor({
        runId: voiceTurn?.runId,
        turnId: voiceTurn?.turnId,
      });
      const speakPhrase = (candidate: { text: string; id: string }) => {
        if (!candidate.text) return;
        if (ttsClient) {
          const job = ttsClient.speak({
            text: candidate.text,
            utteranceId: `${handle.id}-${candidate.id}`,
          }).catch((err) => {
            console.warn("[useVoiceSession] streaming tts speak failed:", err);
          });
          streamingTtsJobs.push(job);
        } else {
          voiceChat.queueSpeech(candidate.text);
        }
      };
      const flushQueued = (chunk: string) => {
        for (const candidate of conductor.pushTextDelta(chunk)) {
          speakPhrase(candidate);
        }
      };

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: conversationRef.current,
            model: opts.model,
            threadId: opts.threadId,
            voice: voiceTurn
              ? {
                  turnId: voiceTurn.turnId,
                  runId: voiceTurn.runId,
                  routeId: voiceTurn.routeId,
                  mode: voiceTurn.mode,
                  surface: voiceTurn.surface,
                  source: voiceTurn.source,
                  modality: "voice" as const,
                }
              : undefined,
          }),
          signal: handle.chatAbort.signal,
        });
        if (!response.ok) {
          throw new Error(`Chat API error: ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (handle.state === "interrupted") {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          fullResponse += chunk;
          flushQueued(chunk);
          setTurns((prev) =>
            prev.map((entry) =>
              entry.id === assistantId
                ? { ...entry, content: cleanResponseForDisplay(fullResponse) }
                : entry,
            ),
          );
        }

        for (const candidate of conductor.flush()) {
          speakPhrase(candidate);
        }

        setTurns((prev) =>
          prev.map((entry) =>
            entry.id === assistantId
              ? {
                  ...entry,
                  content: cleanResponseForDisplay(fullResponse),
                  isStreaming: false,
                }
              : entry,
          ),
        );
        conversationRef.current.push({ role: "assistant", content: fullResponse });
        if (voiceTurn) {
          voiceTurn.marks.llm.completedAt = Date.now();
          voiceTurn.endedAt = Date.now();
          voiceTurn.finalTranscript = trimmed;
        }
        opts.onComplete?.(trimmed, fullResponse);

        if (ttsClient) {
          const output = agentOutputRef.current;
          await Promise.allSettled(streamingTtsJobs);
          if (output) {
            const outputDone = waitForAgentOutputEnd(output, handle);
            await output.finish(handle);
            await outputDone;
          } else {
            handle.markDone();
          }
          ttsClient.close();
          if (streamingTtsRef.current === ttsClient) streamingTtsRef.current = null;
        } else {
          await voiceChat.waitForSpeechEnd();
          handle.markDone();
        }
      } catch (err) {
        if ((err as Error).name === "AbortError" || handle.state === "interrupted") {
          // Mark assistant entry final with whatever we collected.
          setTurns((prev) =>
            prev.map((entry) =>
              entry.id === assistantId
                ? {
                    ...entry,
                    content: cleanResponseForDisplay(fullResponse),
                    isStreaming: false,
                  }
                : entry,
            ),
          );
          return;
        }
        const msg = err instanceof Error ? err.message : "voice turn failed";
        console.error("[useVoiceSession] runTurn error:", err);
        dispatchCtx({ type: "FAIL", error: msg });
        setTurns((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "system",
            content: "Sorry, there was an error. Please try again.",
          },
        ]);
        handle.markDone();
      } finally {
        const activeTtsClient = streamingTtsRef.current;
        if (activeTtsClient && activeTtsClient === ttsClient) {
          activeTtsClient.close();
          streamingTtsRef.current = null;
        }
        if (speechHandleRef.current === handle) speechHandleRef.current = null;
        if (activeRunIdRef.current === turnRunId) activeRunIdRef.current = null;
      }
    },
    [createAgentOutput, currentVoiceId, runtime, voiceChat],
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

  const startListening = useCallback(async () => {
    if (!enabled) return;
    // Take advantage of the gesture that triggered startListening to unlock
    // the output context too — most surfaces wire mic + speak to the same orb.
    void unlockOutput();
    if (prefs.voice.mode === "vad") armContinuous();
    await voiceChat.startListening();
  }, [armContinuous, enabled, prefs.voice.mode, unlockOutput, voiceChat]);

  const stopListening = useCallback(async () => {
    disarmContinuous();
    await voiceChat.stopListening();
  }, [disarmContinuous, voiceChat]);

  useEffect(() => {
    if (!enabled) return;
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
  ]);

  const confirmApproval = useCallback(
    async (decision: "approved" | "rejected", reason?: string) => {
      const challenge = pendingApprovalRef.current;
      if (!challenge) return;
      const runId = activeRunIdRef.current;
      // Clear local state + FSM eagerly so the UI snaps even if the network
      // call is slow.
      setPendingApproval(null);
      dispatchCtx({
        type: decision === "approved" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      });
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
    [],
  );

  const interrupt = useCallback(async () => {
    const handle = speechHandleRef.current;
    handle?.interrupt("user-interrupt");
    speechHandleRef.current = null;
    dispatchCtx({ type: "INTERRUPT" });
    // Tear down both lanes — only one is active per turn but harmless to do both.
    streamingTtsRef.current?.close();
    streamingTtsRef.current = null;
    if (handle) agentOutputRef.current?.interrupt(handle, "user-interrupt");
    else agentOutputRef.current?.stopAll();
    voiceChat.stopSpeaking();
    voiceChat.clearQueue();
    // Tell the server to actually stop the run. Fire-and-forget — the
    // local fetch is already aborted; this just keeps agent-ts from
    // continuing to step after the deck disconnected.
    const runId = activeRunIdRef.current;
    if (runId) {
      activeRunIdRef.current = null;
      void fetch(`/api/chat/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {
        /* best-effort */
      });
    }
  }, [voiceChat]);

  // Latest-ref so the subscription captures the most recent callbacks without
  // re-subscribing on every render (which used to stack listeners and tear
  // down in-flight turns from a stale closure).
  const voiceActivityHandlerRef = useRef<() => void>(() => {});
  voiceActivityHandlerRef.current = () => {
    disarmContinuous();
    clearSttFinalTimeout();
    streamingSttRef.current?.close();
    streamingSttRef.current = null;
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
    speechHandleRef.current?.interrupt("reset");
    speechHandleRef.current = null;
    dispatchCtx({ type: "RESET" });
    voiceChat.clearTranscript();
    voiceChat.clearError();
    setTurns([]);
    setTools({ isRunning: false, currentToolName: null, artifacts: [] });
    setCurrentTurn(null);
    setPendingApproval(null);
    conversationRef.current = [];
  }, [disarmContinuous, voiceChat]);

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
      audioLevel: voiceChat.audioLevel,
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

      turns,
      tools,
      currentTurn,

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

      runTurn,
      attachThread,
      clearTurns,

      speak: voiceChat.speak,
      queueSpeech: voiceChat.queueSpeech,
      stopSpeaking: voiceChat.stopSpeaking,

      voiceChat,
    }),
    [
      ctx.state,
      ctx.transcriptPartial,
      ctx.transcriptFinal,
      ctx.error,
      voiceChat,
      runtime,
      runtimeLoading,
      preset,
      latency,
      currentVoiceId,
      currentDevices,
      turns,
      tools,
      currentTurn,
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
      runTurn,
      attachThread,
      clearTurns,
    ],
  );
}
