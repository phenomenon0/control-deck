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
import { SpeechHandle } from "@/lib/voice/speech-handle";
import { StreamingSttClient } from "@/lib/voice/streaming-stt";
import { StreamingTtsClient } from "@/lib/voice/streaming-tts";
import { AgentOutput } from "@/lib/voice/audio-output";
import { decideSpeakingBridge } from "@/lib/voice/speaking-bridge";
import {
  createVoiceOwnerId,
  subscribeVoiceActivity,
} from "@/lib/voice/activity-bus";
import { shouldRouteToVoiceCore } from "@/lib/inference/voice-core/sidecar-url";
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

export interface VoiceToolState {
  isRunning: boolean;
  currentToolName: string | null;
  artifacts: Artifact[];
}

/**
 * Per-turn handle for the streaming-TTS lane. Returned by
 * `beginStreamingReply()` when voice-core (port 4245) is the active TTS
 * route; null otherwise. ChatSurface routes `agentRun` text deltas
 * through a `PhraseConductor` and pushes each phrase here so the first
 * audio chunk plays as soon as synthesis begins, rather than waiting for
 * a complete WAV per phrase.
 */
export interface StreamingReplyHandle {
  speak(text: string, utteranceId?: string): void;
  finish(): Promise<void>;
  interrupt(): void;
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
  markAgentRunStarted(): void;
  markAgentRunFinished(): void;

  /**
   * Open a streaming-TTS lane for the next assistant turn. Returns null if
   * voice-core (port 4245) is not the active TTS route — caller falls back
   * to the per-phrase WAV path via `voiceChat.queueSpeech`. The handle's
   * lifecycle is bound to one assistant run: `speak` per phrase, `finish`
   * once the run completes, `interrupt` on barge-in.
   */
  beginStreamingReply(): StreamingReplyHandle | null;

  /** Subscribe to agentic tool events on a thread. Returns an unsubscribe. */
  attachThread(threadId: string): () => void;

  /** Escape hatch for read-aloud and speak-on-submit paths. */
  speak(text: string): Promise<void>;
  queueSpeech(text: string): boolean;
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
  const sttAttemptIdRef = useRef(0);
  const suppressedAudioRef = useRef<{ blob: Blob; attemptId: number } | null>(null);
  const fallbackInFlightAttemptRef = useRef<number | null>(null);
  const fallbackRecordedBlobRef = useRef<(reason: string) => void>(() => {});

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
  const stateRef = useRef(ctx.state);
  useEffect(() => {
    stateRef.current = ctx.state;
  }, [ctx.state]);

  const ensureStreamingSttClient = useCallback((): StreamingSttClient | null => {
    if (!useStreamingSttRef.current) return null;
    const model = sttModelRef.current;
    if (!model) return null;
    let client = streamingSttRef.current;
    if (client) return client;
    // Keep live chat on the streaming engine's own final. The optional
    // whisper.cpp large-v3-turbo correction is installed, but on this CPU
    // host it takes ~18s per utterance and makes the UI appear to produce no
    // transcript. Quality correction belongs behind an explicit mode, not the
    // default conversational path.
    const correctionEngine = undefined;
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
          void fallbackRecordedBlobRef.current("stream-empty-final");
          return;
        }
        suppressedAudioRef.current = null;
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

  const waitForSuppressedAudio = useCallback(async (attemptId: number) => {
    for (let i = 0; i < 40; i++) {
      const entry = suppressedAudioRef.current;
      if (entry?.attemptId === attemptId) return entry.blob;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return null;
  }, []);

  const fallbackToRecordedBlob = useCallback(
    async (reason: string) => {
      const attemptId = sttAttemptIdRef.current;
      if (fallbackInFlightAttemptRef.current === attemptId) return;
      fallbackInFlightAttemptRef.current = attemptId;
      clearSttFinalTimeout();

      try {
        const audio = await waitForSuppressedAudio(attemptId);
        if (attemptId !== sttAttemptIdRef.current) return;
        if (!audio || audio.size < 1000) {
          console.warn("[useVoiceSession] no recorded audio for STT fallback:", reason);
          if (stateRef.current === "transcribing") dispatchCtx({ type: "TRANSCRIPT_EMPTY" });
          return;
        }

        console.info("[useVoiceSession] falling back to recorded STT:", reason);
        const text = await transcribeViaVoiceRoute(audio);
        if (attemptId !== sttAttemptIdRef.current) return;

        const trimmed = text.trim();
        if (!trimmed) {
          if (stateRef.current === "transcribing") dispatchCtx({ type: "TRANSCRIPT_EMPTY" });
          return;
        }

        suppressedAudioRef.current = null;
        dispatchCtx({ type: "TRANSCRIPT_FINAL", text: trimmed });
        onTranscriptFinalRef.current?.(trimmed);
      } catch (err) {
        const message = err instanceof Error ? err.message : "STT fallback failed";
        console.warn("[useVoiceSession] recorded STT fallback failed:", message);
        if (stateRef.current === "transcribing") dispatchCtx({ type: "FAIL", error: message });
      } finally {
        if (fallbackInFlightAttemptRef.current === attemptId) {
          fallbackInFlightAttemptRef.current = null;
        }
      }
    },
    [clearSttFinalTimeout, transcribeViaVoiceRoute, waitForSuppressedAudio],
  );

  useEffect(() => {
    fallbackRecordedBlobRef.current = fallbackToRecordedBlob;
  }, [fallbackToRecordedBlob]);

  const handleSuppressedAudio = useCallback((blob: Blob) => {
    suppressedAudioRef.current = { blob, attemptId: sttAttemptIdRef.current };
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
    onSuppressedAudio: handleSuppressedAudio,
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
        // Stop the non-streaming lane too — fillers + WAV queue live on
        // voiceChat's own AudioContext and would keep playing through a
        // barge-in otherwise.
        voiceChat.stopSpeaking();
      }
      // New utterance — reset the streaming STT buffer so partials don't
      // bleed across turns.
      sttAttemptIdRef.current += 1;
      suppressedAudioRef.current = null;
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
            void fallbackRecordedBlobRef.current("stream-final-timeout");
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
        void fallbackRecordedBlobRef.current("transcribing-watchdog");
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
    const decision = decideSpeakingBridge(
      prevIsSpeaking.current,
      voiceChat.isSpeaking,
      replyInFlightRef.current,
      streamingTtsRef.current !== null,
    );
    if (decision.event) dispatchCtx({ type: decision.event });
    prevIsSpeaking.current = decision.nextPrev;
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

  // ------- Tool/artifact stream + output -------

  const [pendingApproval, setPendingApproval] = useState<VoiceApprovalChallenge | null>(null);
  const [tools, setTools] = useState<VoiceToolState>({
    isRunning: false,
    currentToolName: null,
    artifacts: [],
  });
  const speechHandleRef = useRef<SpeechHandle | null>(null);
  // Latest runId of the in-flight turn — captured via ref so interrupt()
  // stays a stable callback while still able to fire a server-side cancel.
  const activeRunIdRef = useRef<string | null>(null);
  const pendingApprovalRef = useRef<VoiceApprovalChallenge | null>(null);
  // True while ChatSurface's agentRun is streaming a reply. Bridges the
  // inter-phrase gap in the per-phrase TTS lane: `voiceChat.isSpeaking`
  // briefly flips false between queued phrases (pending=0), and without this
  // flag `decideSpeakingBridge` would fire AUDIO_STOPPED, idle the FSM, and
  // re-arm the mic mid-reply. Set/cleared by markAgentRun{Started,Finished}.
  const replyInFlightRef = useRef(false);

  const agentOutputRef = useRef<AgentOutput | null>(null);
  // Streaming TTS lane — constructed per turn by beginStreamingReply. Held in
  // a ref so the speaking-bridge guard and `interrupt` can tear it down.
  const streamingTtsRef = useRef<StreamingTtsClient | null>(null);
  const streamingHandleSeqRef = useRef(0);

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

  // Tear down STT + output resources on unmount.
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

  const attachThread = useCallback((threadId: string) => {
    if (typeof window === "undefined" || !threadId) return () => {};

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
      eventSource.close();
    };
  }, []);


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

  const markAgentRunStarted = useCallback(() => {
    replyInFlightRef.current = true;
    dispatchCtx({ type: "RUN_STARTED" });
  }, []);

  const markAgentRunFinished = useCallback(() => {
    replyInFlightRef.current = false;
    const state = stateRef.current;
    if (state === "thinking" || state === "speaking") {
      dispatchCtx({ type: "AUDIO_STOPPED" });
    } else if (state === "submitting") {
      dispatchCtx({ type: "RESET" });
    }
  }, []);

  const beginStreamingReply = useCallback((): StreamingReplyHandle | null => {
    const ttsModel = runtime?.route?.tts?.model ?? null;
    if (!shouldRouteToVoiceCore(ttsModel)) return null;

    if (!agentOutputRef.current) agentOutputRef.current = createAgentOutput();
    const output = agentOutputRef.current;

    // Tear down any prior lane — barge-in or new turn before the previous
    // one fully drained.
    streamingTtsRef.current?.close();
    const prevHandle = speechHandleRef.current;
    if (prevHandle) {
      prevHandle.interrupt("new-turn");
      output.interrupt(prevHandle, "new-turn");
    }

    const handle = new SpeechHandle(streamingHandleSeqRef.current++);
    speechHandleRef.current = handle;

    const jobs: Promise<void>[] = [];
    const client = new StreamingTtsClient({
      engine: ttsModel ?? undefined,
      voice: currentVoiceId ?? undefined,
      onChunk: ({ pcm, sampleRate }) => {
        void output.playPcm16Chunk(handle, pcm, sampleRate);
      },
      onError: (err) => {
        console.warn("[useVoiceSession] streaming tts error:", err);
      },
    });
    streamingTtsRef.current = client;

    const detach = () => {
      if (streamingTtsRef.current === client) streamingTtsRef.current = null;
      if (speechHandleRef.current === handle) speechHandleRef.current = null;
    };

    return {
      speak: (text, utteranceId) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const id = utteranceId ?? `${handle.id}-${jobs.length}`;
        jobs.push(
          client.speak({ text: trimmed, utteranceId: id }).catch((err) => {
            console.warn("[useVoiceSession] streaming tts speak failed:", err);
          }),
        );
      },
      finish: async () => {
        await Promise.allSettled(jobs);
        try {
          await output.finish(handle);
        } catch (err) {
          console.warn("[useVoiceSession] streaming tts finish failed:", err);
        }
        client.close();
        detach();
      },
      interrupt: () => {
        client.close();
        output.interrupt(handle, "user-interrupt");
        detach();
      },
    };
  }, [createAgentOutput, currentVoiceId, runtime]);

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
    replyInFlightRef.current = false;
    const handle = speechHandleRef.current;
    handle?.interrupt("user-interrupt");
    speechHandleRef.current = null;
    dispatchCtx({ type: "INTERRUPT" });
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
    replyInFlightRef.current = false;
    speechHandleRef.current?.interrupt("reset");
    speechHandleRef.current = null;
    dispatchCtx({ type: "RESET" });
    voiceChat.clearTranscript();
    voiceChat.clearError();
    setTools({ isRunning: false, currentToolName: null, artifacts: [] });
    setPendingApproval(null);
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
    ],
  );
}
