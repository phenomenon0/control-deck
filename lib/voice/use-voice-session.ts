"use client";

/**
 * Voice session hook — the canonical runtime the UI talks to.
 *
 * Today this composes the existing `useVoiceChat` primitive (which still owns
 * mic, WebSocket, and playback) with the session state machine from
 * `session-machine.ts` and a route/latency overlay that fetches
 * `/api/voice/runtime`. Task 3 swaps the internals for real capture/playback/
 * transport hooks without changing this public API.
 *
 * Every voice surface (Live tab, fullscreen VoiceModeSheet, inline chat mic)
 * should consume this hook instead of calling `useVoiceChat` directly. Sharing
 * a single session means a single WebSocket, one transcript, one state.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useVoiceChat, type UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import {
  initialContext,
  reduceVoiceSession,
  labelForState,
  isInterruptible as stateIsInterruptible,
  isListening as stateIsListening,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "@/lib/voice/session-machine";
import type { VoiceRoutePreset } from "@/lib/voice/resolve-voice-route";

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

  setRoute(preset: VoiceRoutePreset): void;
  setVoice(voiceId: string | null): void;
  setDevices(opts: { inputId?: string | null; outputId?: string | null }): void;

  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  interrupt(): Promise<void>;
  reset(): void;

  /** Escape hatch for read-aloud and speak-on-submit paths that still drive TTS directly. */
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

  const voiceChat = useVoiceChat({
    onTranscript: (text) => {
      dispatchCtx({ type: "TRANSCRIPT_PARTIAL", text });
    },
    onAutoSend: (text) => {
      dispatchCtx({ type: "TRANSCRIPT_FINAL", text });
      onTranscriptFinal?.(text);
    },
  });

  // Bridge useVoiceChat booleans into state-machine events. Treat its booleans
  // as the source of truth for mic/playback lifecycle until T3 replaces them.
  const prevIsListening = useRef(false);
  const prevIsSpeaking = useRef(false);
  const prevError = useRef<string | null>(null);

  useEffect(() => {
    if (voiceChat.isListening && !prevIsListening.current) {
      dispatchCtx({ type: "MIC_REQUESTED" });
      dispatchCtx({ type: "MIC_GRANTED" });
    } else if (!voiceChat.isListening && prevIsListening.current) {
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

  // Voice + devices (persisted in memory for now; Task 8 wires to library)
  const [currentVoiceId, setCurrentVoiceIdState] = useState<string | null>(null);
  const [currentDevices, setCurrentDevicesState] = useState<{
    inputId: string | null;
    outputId: string | null;
  }>({ inputId: null, outputId: null });

  const setVoice = useCallback((id: string | null) => setCurrentVoiceIdState(id), []);
  const setDevices = useCallback(
    (opts: { inputId?: string | null; outputId?: string | null }) =>
      setCurrentDevicesState((prev) => ({
        inputId: opts.inputId !== undefined ? opts.inputId : prev.inputId,
        outputId: opts.outputId !== undefined ? opts.outputId : prev.outputId,
      })),
    [],
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

  const startListening = useCallback(async () => {
    if (!enabled) return;
    await voiceChat.startListening();
  }, [enabled, voiceChat]);

  const stopListening = useCallback(async () => {
    await voiceChat.stopListening();
  }, [voiceChat]);

  const interrupt = useCallback(async () => {
    dispatchCtx({ type: "INTERRUPT" });
    voiceChat.stopSpeaking();
    voiceChat.clearQueue();
  }, [voiceChat]);

  const reset = useCallback(() => {
    dispatchCtx({ type: "RESET" });
    voiceChat.clearTranscript();
    voiceChat.clearError();
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

      setRoute,
      setVoice,
      setDevices,

      startListening,
      stopListening,
      interrupt,
      reset,

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
      setRoute,
      setVoice,
      setDevices,
      startListening,
      stopListening,
      interrupt,
      reset,
    ],
  );
}
