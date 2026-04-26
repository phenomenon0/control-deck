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
  cleanResponseForSpeech,
  createPhraseSplitter,
  getToolStartMessage,
} from "@/lib/voice/conductor";
import { SpeechHandle } from "@/lib/voice/speech-handle";
import { StreamingTtsClient } from "@/lib/voice/streaming-tts";
import { StreamingSttClient } from "@/lib/voice/streaming-stt";
import { AgentOutput } from "@/lib/voice/audio-output";
import { shouldRouteToVoiceEngines } from "@/lib/inference/voice-engines/sidecar-url";
import type { VoiceRoutePreset } from "@/lib/voice/resolve-voice-route";
import type { Artifact } from "@/lib/types/chat";

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

  setRoute(preset: VoiceRoutePreset): void;
  setVoice(voiceId: string | null): void;
  setDevices(opts: { inputId?: string | null; outputId?: string | null }): void;

  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  interrupt(): Promise<void>;
  reset(): void;

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

  // Streaming STT lifecycle — one client per listening session, replaced
  // on engine change. Constructed lazily inside the mic-frame callback so
  // we don't open a WS until the user actually starts speaking.
  const streamingSttRef = useRef<StreamingSttClient | null>(null);
  const sttModelRef = useRef<string | null>(null);
  const useStreamingSttRef = useRef(false);

  const ensureStreamingSttClient = useCallback((): StreamingSttClient | null => {
    if (!useStreamingSttRef.current) return null;
    const model = sttModelRef.current;
    if (!model) return null;
    let client = streamingSttRef.current;
    if (client) return client;
    client = new StreamingSttClient({
      engine: model,
      onPartial: (text) => {
        if (text) dispatchCtx({ type: "TRANSCRIPT_PARTIAL", text });
      },
      onFinal: (text) => {
        const trimmed = (text ?? "").trim();
        if (!trimmed) return;
        dispatchCtx({ type: "TRANSCRIPT_FINAL", text: trimmed });
        onTranscriptFinal?.(trimmed);
      },
      onError: (err) => {
        console.warn("[useVoiceSession] streaming stt error:", err);
      },
    });
    streamingSttRef.current = client;
    void client.connect();
    return client;
  }, [onTranscriptFinal]);

  const handleMicFrame = useCallback((frame: Float32Array, sampleRate: number) => {
    const client = ensureStreamingSttClient();
    if (!client) return;
    client.pushFloat32(frame, sampleRate);
  }, [ensureStreamingSttClient]);

  const voiceChat = useVoiceChat({
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
    suppressBlobStt: useStreamingSttRef.current,
  });

  // Bridge useVoiceChat booleans into state-machine events. Treat its booleans
  // as the source of truth for mic/playback lifecycle until T3 replaces them.
  const prevIsListening = useRef(false);
  const prevIsSpeaking = useRef(false);
  const prevError = useRef<string | null>(null);
  const stateRef = useRef(ctx.state);
  useEffect(() => {
    stateRef.current = ctx.state;
  }, [ctx.state]);

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
      streamingSttRef.current?.reset();
      dispatchCtx({ type: "MIC_REQUESTED" });
      dispatchCtx({ type: "MIC_GRANTED" });
    } else if (!voiceChat.isListening && prevIsListening.current) {
      // End of utterance — ask the streaming STT to emit its final transcript.
      // The blob-STT path is suppressed when streaming is active, so this is
      // the only thing that produces TRANSCRIPT_FINAL.
      streamingSttRef.current?.final();
      dispatchCtx({ type: "VOICE_ENDED" });
    }
    prevIsListening.current = voiceChat.isListening;
  }, [voiceChat.isListening]);

  useEffect(() => {
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

  // Sync streaming-STT activation with the resolved runtime — voice-engines
  // sidecar engines (kokoro/moonshine/etc) get the WS partial path; the
  // legacy port-8000 engines stay on the blob-based MediaRecorder flow.
  useEffect(() => {
    const model = runtime?.route?.stt?.model ?? null;
    const next = shouldRouteToVoiceEngines(model);
    sttModelRef.current = model;
    useStreamingSttRef.current = next;
    if (!next && streamingSttRef.current) {
      streamingSttRef.current.close();
      streamingSttRef.current = null;
    }
  }, [runtime]);

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
  const [tools, setTools] = useState<VoiceToolState>({
    isRunning: false,
    currentToolName: null,
    artifacts: [],
  });
  const conversationRef = useRef<Array<{ role: string; content: string }>>([]);
  const speechHandleRef = useRef<SpeechHandle | null>(null);
  const turnSeqRef = useRef(0);

  // Streaming TTS path (Phase 6) — only constructed when the active TTS model
  // is served by the in-repo voice-engines sidecar (port 9101). For legacy
  // sidecar engines (piper/xtts/chatterbox) we keep `voiceChat.queueSpeech`.
  const agentOutputRef = useRef<AgentOutput | null>(null);
  const streamingTtsRef = useRef<StreamingTtsClient | null>(null);

  // Tear down streaming TTS / STT resources when the output device or the
  // active engine changes (or on unmount).
  useEffect(() => {
    return () => {
      streamingTtsRef.current?.close();
      streamingTtsRef.current = null;
      agentOutputRef.current?.stopAll();
      agentOutputRef.current = null;
      streamingSttRef.current?.close();
      streamingSttRef.current = null;
    };
  }, []);

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
      } catch (err) {
        console.warn("[useVoiceSession] Failed to parse SSE event:", err);
      }
    };
    eventSource.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };
    return () => eventSource.close();
  }, []);

  const runTurn = useCallback(
    async (text: string, opts: RunTurnOptions) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Drop any in-flight turn before starting a new one.
      speechHandleRef.current?.interrupt("new-turn");

      const handle = new SpeechHandle(turnSeqRef.current++);
      speechHandleRef.current = handle;

      // Decide TTS lane for this turn. The legacy port-8000 sidecar speaks
      // WAV-per-phrase; the new tier sidecar streams Int16 PCM so we can
      // play the first chunk as soon as synthesis begins.
      const ttsModel = runtime?.route?.tts?.model ?? null;
      const useStreamingTts = shouldRouteToVoiceEngines(ttsModel);
      let ttsClient: StreamingTtsClient | null = null;
      if (useStreamingTts) {
        // Lazily build (or rebuild) the AgentOutput so the post-processing
        // graph + speaker-routing live across turns.
        if (!agentOutputRef.current) {
          agentOutputRef.current = new AgentOutput({ outputDeviceId });
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
      conversationRef.current.push({ role: "user", content: trimmed });

      let fullResponse = "";
      let phraseSeq = 0;
      const splitter = createPhraseSplitter();
      const speakPhrase = (speakable: string) => {
        if (!speakable) return;
        if (ttsClient) {
          void ttsClient.speak({
            text: speakable,
            utteranceId: `${handle.id}-${phraseSeq++}`,
          });
        } else {
          voiceChat.queueSpeech(speakable);
        }
      };
      const flushQueued = (chunk: string) => {
        for (const phrase of splitter.push(chunk)) {
          speakPhrase(cleanResponseForSpeech(phrase));
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

        const tail = splitter.flush();
        if (tail) speakPhrase(cleanResponseForSpeech(tail));

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
        opts.onComplete?.(trimmed, fullResponse);

        if (ttsClient) {
          // Streaming TTS path: nothing left to push, but the AgentOutput
          // queue may still be draining. Close the WS so the sidecar releases
          // its lock; AgentOutput keeps playing what's already queued.
          ttsClient.close();
          if (streamingTtsRef.current === ttsClient) streamingTtsRef.current = null;
        } else {
          await voiceChat.waitForSpeechEnd();
        }
        handle.markDone();
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
        console.error("[useVoiceSession] runTurn error:", err);
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
        if (speechHandleRef.current === handle) speechHandleRef.current = null;
      }
    },
    [voiceChat],
  );

  // ------- Lifecycle controls -------

  const startListening = useCallback(async () => {
    if (!enabled) return;
    await voiceChat.startListening();
  }, [enabled, voiceChat]);

  const stopListening = useCallback(async () => {
    await voiceChat.stopListening();
  }, [voiceChat]);

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
  }, [voiceChat]);

  const reset = useCallback(() => {
    speechHandleRef.current?.interrupt("reset");
    speechHandleRef.current = null;
    dispatchCtx({ type: "RESET" });
    voiceChat.clearTranscript();
    voiceChat.clearError();
    setTurns([]);
    setTools({ isRunning: false, currentToolName: null, artifacts: [] });
    conversationRef.current = [];
  }, [voiceChat]);

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

      setRoute,
      setVoice,
      setDevices,

      startListening,
      stopListening,
      interrupt,
      reset,

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
      setRoute,
      setVoice,
      setDevices,
      startListening,
      stopListening,
      interrupt,
      reset,
      runTurn,
      attachThread,
      clearTurns,
    ],
  );
}
