/**
 * Audio AG-UI events — the wire format voice surfaces emit so the deck and
 * agent share one timeline. Partial transcripts flow through these as a hot
 * stream; finals + state transitions are the durable ones.
 */

import type { AudioMode } from "@/lib/audio/audio-modes";
import type { AudioSurface, VoiceTurnSource } from "./turn";
import type { VoiceApprovalChallenge } from "./voice-approval";

export type AudioAguiEvent =
  | {
      type: "audio.session.started";
      threadId?: string;
      payload: {
        routeId: string;
        mode: AudioMode;
        surface: AudioSurface;
        inputDeviceLabel?: string;
        outputDeviceLabel?: string;
      };
    }
  | {
      type: "audio.session.stopped";
      threadId?: string;
      payload: {
        reason: "user" | "error" | "mic_lost" | "route_changed";
      };
    }
  | {
      type: "audio.turn.started";
      threadId?: string;
      payload: {
        turnId: string;
        runId?: string;
        mode: AudioMode;
        surface: AudioSurface;
        source: VoiceTurnSource;
      };
    }
  | {
      type: "audio.transcript.partial";
      threadId?: string;
      payload: {
        turnId: string;
        text: string;
      };
    }
  | {
      type: "audio.transcript.final";
      threadId?: string;
      payload: {
        turnId: string;
        text: string;
        confidence?: number;
      };
    }
  | {
      type: "audio.output.started";
      threadId?: string;
      payload: {
        turnId?: string;
        runId?: string;
        voiceId?: string;
      };
    }
  | {
      type: "audio.output.stopped";
      threadId?: string;
      payload: {
        turnId?: string;
        reason: "completed" | "interrupted" | "cancelled" | "error";
      };
    }
  | {
      type: "audio.interrupted";
      threadId?: string;
      payload: {
        turnId?: string;
        runId?: string;
      };
    }
  | {
      type: "audio.approval.challenge";
      threadId?: string;
      payload: VoiceApprovalChallenge;
    };

export type AudioAguiEventType = AudioAguiEvent["type"];
