"use client";

/**
 * useChatVoiceController — voice session ownership + transcript plumbing.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 *
 * If a parent surface (e.g. LiveVoiceSurface) provides a shared voice session,
 * this reuses its runtime — one mic, one WebSocket, one transcript. Otherwise
 * it owns the voice runtime for standalone chat pages. Also handles the
 * final-transcript → composer/auto-send pipeline (dictation drops text into
 * the input; full voice mode auto-sends — that's the hands-free contract).
 */

import { useCallback, useEffect, useRef } from "react";
import {
  useVoiceSession,
  type VoiceSessionApi,
} from "@/lib/voice/use-voice-session";
import { useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import type { RunController } from "@/lib/hooks/useRunController";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import type { SubmitOrigin } from "@/components/chat/ChatSubmitController";

interface UseChatVoiceControllerOptions {
  voiceEnabled: boolean;
  voiceModeOpen: boolean;
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  runController: RunController;
  sendMessageRef: { current: (text: string, origin?: SubmitOrigin) => void };
}

interface ChatVoiceController {
  voiceSession: VoiceSessionApi;
  voiceChat: UseVoiceChatReturn;
}

export function useChatVoiceController({
  voiceEnabled,
  voiceModeOpen,
  inputValue,
  setInputValue,
  runController,
  sendMessageRef,
}: UseChatVoiceControllerOptions): ChatVoiceController {
  const lastSharedFinalSubmittedRef = useRef<string>("");
  const voiceStateRef = useRef<string>("idle");

  const submitVoiceFinal = useCallback(
    (text: string) => {
      if (!voiceEnabled) return;
      if (voiceStateRef.current === "confirming") return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed === lastSharedFinalSubmittedRef.current) return;
      lastSharedFinalSubmittedRef.current = trimmed;
      // Dictation (composer mic): drop the text into the input so the user
      // can review/edit/send manually. Only the full voice-mode sheet
      // auto-sends — that's the hands-free contract.
      if (!voiceModeOpen) {
        setInputValue(trimmed);
        return;
      }
      sendMessageRef.current(trimmed, "voice-live");
    },
    [voiceEnabled, voiceModeOpen],
  );

  // Own a session when no parent provides one — and ALWAYS expose a session
  // to downstream voice consumers (the sheet) via VoiceSessionProvider in the
  // orchestrator. Without this, opening VoiceModeSheet on /chat spawns a
  // parallel session that ChatSurface never observes, so transcripts go
  // nowhere.
  const sharedVoiceSession = useOptionalVoiceSession();
  const ownSession = useVoiceSession({
    enabled: !sharedVoiceSession,
    onTranscriptFinal: submitVoiceFinal,
    controller: runController,
  });
  const voiceSession = sharedVoiceSession ?? ownSession;
  const voiceChat = voiceSession.voiceChat;
  useEffect(() => {
    voiceStateRef.current = voiceSession.state;
  }, [voiceSession.state]);

  const sharedPartial = voiceSession.transcriptPartial;
  const sharedFinal = voiceSession.transcriptFinal;
  useEffect(() => {
    if (!voiceEnabled) return;
    if (sharedPartial) setInputValue(sharedPartial);
  }, [voiceEnabled, sharedPartial]);
  useEffect(() => {
    if (!voiceEnabled) return;
    submitVoiceFinal(sharedFinal);
  }, [voiceEnabled, sharedFinal, submitVoiceFinal]);

  // Streaming STT can emit a blank final immediately after the real final.
  // If React batches those updates, the non-empty `transcriptFinal` may never
  // be observed by this component; the FSM still enters `submitting`, so use
  // the composer text as the last-known final in that case.
  useEffect(() => {
    if (voiceSession.state !== "submitting") return;
    submitVoiceFinal(sharedFinal || inputValue);
  }, [inputValue, sharedFinal, submitVoiceFinal, voiceSession.state]);

  // Drop the dedup memory once the FSM clears the shared transcript, so a
  // genuinely identical follow-up utterance is not blocked.
  useEffect(() => {
    if (!sharedFinal && voiceSession.state === "idle") lastSharedFinalSubmittedRef.current = "";
  }, [sharedFinal, voiceSession.state]);

  return { voiceSession, voiceChat };
}
