/**
 * Voice turn — first-class object representing a single user→assistant
 * audio round-trip. Stamped onto AG-UI events so voice surfaces, the
 * agent, and tool ledger all agree on the same identity.
 */

import type { AudioMode } from "@/lib/audio/audio-modes";

export type VoiceTurnSource = "wake" | "ptt" | "manual" | "newsroom" | "diagnostic";

export type AudioSurface = "conductor" | "newsroom" | "chat" | "global-dock";

export interface VoiceTurnLatencyMarks {
  stt: {
    firstPartialAt?: number;
    finalAt?: number;
    confidence?: number;
  };
  llm: {
    submittedAt?: number;
    firstAguiEventAt?: number;
    firstTextAt?: number;
    completedAt?: number;
  };
  tts: {
    firstPhraseAt?: number;
    firstAudioAt?: number;
    completedAt?: number;
  };
}

export interface VoiceTurn {
  turnId: string;
  threadId: string;
  runId?: string;
  mode: AudioMode;
  routeId: string;
  surface: AudioSurface;
  source: VoiceTurnSource;

  startedAt: number;
  endedAt?: number;

  partialTranscript: string;
  finalTranscript?: string;

  marks: VoiceTurnLatencyMarks;
}

let turnSeq = 0;

export function createTurnId(): string {
  turnSeq += 1;
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `turn-${Date.now().toString(36)}-${turnSeq.toString(36)}-${id}`;
}

export function newVoiceTurn(init: {
  threadId: string;
  mode: AudioMode;
  routeId: string;
  surface: AudioSurface;
  source: VoiceTurnSource;
  runId?: string;
}): VoiceTurn {
  return {
    turnId: createTurnId(),
    threadId: init.threadId,
    runId: init.runId,
    mode: init.mode,
    routeId: init.routeId,
    surface: init.surface,
    source: init.source,
    startedAt: Date.now(),
    partialTranscript: "",
    marks: { stt: {}, llm: {}, tts: {} },
  };
}
