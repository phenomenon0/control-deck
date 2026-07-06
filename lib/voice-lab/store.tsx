"use client";

/**
 * Voice-lab knob store + run history.
 *
 * Plain React Context + useReducer — no extra deps. The lab is a single page
 * so a context store is plenty; if we ever expose the same surface elsewhere
 * we can lift this into Zustand.
 *
 * Knob mutations re-write the session's lab overrides via `setLabOverrides`
 * (debounced 250 ms — slider drag would otherwise socket-storm the STT WS).
 * Run history holds `ProbeReport` rows produced by `useTimingFrames` so the
 * report / timeline / batch panels can render off a single source.
 */

import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";

import type { ProbeReport } from "@/lib/voice/test-harness/latency-probe";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";

/** Mirror of the server / client knobs the lab exposes. */
export interface LabKnobs {
  /** Server VAD threshold (0-1). */
  vadThreshold: number;
  /** Server VAD min-silence-to-end-speech (ms). */
  vadMinSilenceMs: number;
  /** Server VAD min-speech-to-start (ms). */
  vadMinSpeechMs: number;
  /** STT streaming engine id. null = use tier default. */
  sttEngine: string | null;
  /** Correction engine. null = disable; undefined = leave default. */
  correctionEngine: string | null;
  /** TTS engine id (per-utterance). null = use tier default. */
  ttsEngine: string | null;
  /** Voice id. null = use tier default. */
  voice: string | null;
  /** TTS speed multiplier. */
  speed: number;
  /** Client AgentInput Silero VAD threshold (0-1). */
  clientVadThreshold: number;
  /** Client AgentInput Silero `minSpeechFrames`. */
  clientVadMinSpeechFrames: number;
  /** Correction round-trip timeout. */
  correctionTimeoutMs: number;
}

export const DEFAULT_KNOBS: LabKnobs = {
  vadThreshold: 0.5,
  vadMinSilenceMs: 250,
  vadMinSpeechMs: 100,
  sttEngine: null,
  correctionEngine: "faster-whisper",
  ttsEngine: null,
  voice: null,
  speed: 1.0,
  clientVadThreshold: 0.5,
  clientVadMinSpeechFrames: 3,
  correctionTimeoutMs: 4000,
};

/** One row in the run history table. */
export interface LabRun {
  id: string;
  startedAt: number;
  knobs: LabKnobs;
  /** WAV name when sourced from a fixture, "live" when from the mic. */
  source: string;
  report: ProbeReport;
  /** Server timing frames as received, ordered by arrival. */
  serverFrames: Array<{ source: "stt" | "tts"; phase: string; ms: number; meta?: Record<string, unknown>; receivedAt: number }>;
}

interface State {
  knobs: LabKnobs;
  runs: LabRun[];
  /** Live timing frames for the active turn — flushed into a Run on completion. */
  liveFrames: LabRun["serverFrames"];
}

type Action =
  | { type: "SET_KNOB"; key: keyof LabKnobs; value: LabKnobs[keyof LabKnobs] }
  | { type: "RESET_KNOBS" }
  | { type: "PUSH_FRAME"; frame: LabRun["serverFrames"][number] }
  | { type: "CLEAR_LIVE" }
  | { type: "ADD_RUN"; run: LabRun }
  | { type: "CLEAR_RUNS" }
  | { type: "LOAD_KNOBS"; knobs: LabKnobs };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_KNOB":
      return { ...state, knobs: { ...state.knobs, [action.key]: action.value } };
    case "RESET_KNOBS":
      return { ...state, knobs: { ...DEFAULT_KNOBS } };
    case "LOAD_KNOBS":
      return { ...state, knobs: { ...DEFAULT_KNOBS, ...action.knobs } };
    case "PUSH_FRAME":
      // Hard cap so a stuck open lane doesn't grow unbounded.
      return {
        ...state,
        liveFrames: [...state.liveFrames.slice(-499), action.frame],
      };
    case "CLEAR_LIVE":
      return { ...state, liveFrames: [] };
    case "ADD_RUN":
      // Keep the most recent 50 runs in memory.
      return { ...state, runs: [action.run, ...state.runs].slice(0, 50) };
    case "CLEAR_RUNS":
      return { ...state, runs: [] };
    default:
      return state;
  }
}

export interface LabStoreApi {
  knobs: LabKnobs;
  runs: LabRun[];
  liveFrames: LabRun["serverFrames"];
  setKnob<K extends keyof LabKnobs>(key: K, value: LabKnobs[K]): void;
  loadKnobs(knobs: LabKnobs): void;
  resetKnobs(): void;
  pushFrame(frame: LabRun["serverFrames"][number]): void;
  clearLive(): void;
  addRun(run: LabRun): void;
  clearRuns(): void;
}

const LabStoreContext = createContext<LabStoreApi | null>(null);

const SESSION_OVERRIDE_DEBOUNCE_MS = 250;

export function LabStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    knobs: { ...DEFAULT_KNOBS },
    runs: [],
    liveFrames: [],
  }));

  const dock = useOptionalAudioDock();
  const session = dock?.session ?? null;
  const debounceRef = useRef<number | null>(null);

  // Push knob changes into the live voice session. Debounce so a slider drag
  // doesn't thrash the STT WS open/close cycle.
  useEffect(() => {
    if (!session) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      session.setLabOverrides({
        sttEngine: state.knobs.sttEngine,
        correctionEngine: state.knobs.correctionEngine,
        ttsEngine: state.knobs.ttsEngine,
        debug: true,
      });
    }, SESSION_OVERRIDE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [
    session,
    state.knobs.sttEngine,
    state.knobs.correctionEngine,
    state.knobs.ttsEngine,
  ]);

  // Apply voice/speed to the audioDock-managed voice prefs.
  useEffect(() => {
    if (!session) return;
    if (state.knobs.voice !== null && session.currentVoiceId !== state.knobs.voice) {
      session.setVoice(state.knobs.voice);
    }
  }, [session, state.knobs.voice]);

  const api = useMemo<LabStoreApi>(
    () => ({
      knobs: state.knobs,
      runs: state.runs,
      liveFrames: state.liveFrames,
      setKnob: (key, value) => dispatch({ type: "SET_KNOB", key, value }),
      loadKnobs: (knobs) => dispatch({ type: "LOAD_KNOBS", knobs }),
      resetKnobs: () => dispatch({ type: "RESET_KNOBS" }),
      pushFrame: (frame) => dispatch({ type: "PUSH_FRAME", frame }),
      clearLive: () => dispatch({ type: "CLEAR_LIVE" }),
      addRun: (run) => dispatch({ type: "ADD_RUN", run }),
      clearRuns: () => dispatch({ type: "CLEAR_RUNS" }),
    }),
    [state],
  );

  return <LabStoreContext.Provider value={api}>{children}</LabStoreContext.Provider>;
}

export function useLabStore(): LabStoreApi {
  const ctx = useContext(LabStoreContext);
  if (!ctx) throw new Error("useLabStore must be used inside LabStoreProvider");
  return ctx;
}
