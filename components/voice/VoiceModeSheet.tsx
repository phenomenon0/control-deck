"use client";

/**
 * VoiceModeSheet — render-only fullscreen voice surface.
 *
 * As of phase 3 of the Unified Voice Loop, all orchestration (LLM stream,
 * phrase split, TTS queue, SSE tool events, abort) lives in
 * `useVoiceSession`. This component just:
 *   - reuses a shared session if a parent provides one (LiveVoiceSurface),
 *     otherwise instantiates its own,
 *   - autostarts the mic on open and keeps it healthy with a safety net,
 *   - dispatches `runTurn(text)` when the session emits a final transcript,
 *   - dispatches `interrupt()` on barge-in,
 *   - renders orb / transcript / tool results from session state.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { VoiceOrb, type OrbPhase } from "./VoiceOrb";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { matchPhrase, isCancellation } from "@/lib/voice/voice-approval";
import { VoiceApprovalCard } from "./VoiceApprovalCard";

export type VoiceMode = "push-to-talk" | "vad" | "toggle";

interface VoiceModeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  threadId: string;
}

export function VoiceModeSheet({
  isOpen,
  onClose,
  threadId,
}: VoiceModeSheetProps) {
  const { prefs, updateVoicePrefs } = useDeckSettings();
  const mode: VoiceMode = prefs.voice.mode;
  const dock = useOptionalAudioDock();

  // Reuse a shared session if one is in scope (e.g. LiveVoiceSurface);
  // otherwise own the runtime for standalone chat-page usage. The `!dock`
  // guard mirrors Conductor and Newsroom — without it, a future render
  // outside DeckShell but with an audio-dock available would spawn two
  // parallel mic+TTS pipelines for one deck.
  const sharedSession = useOptionalVoiceSession();
  const ownSession = useVoiceSession({ enabled: !sharedSession && !dock });
  const session = sharedSession ?? dock?.session ?? ownSession;
  const { voiceChat } = session;

  const autoStartedRef = useRef(false);
  const lastSubmittedRef = useRef<string>("");

  // Subscribe to agentic SSE while open.
  useEffect(() => {
    if (!isOpen || !threadId) return;
    return session.attachThread(threadId);
  }, [isOpen, threadId, session]);

  // Approval-phrase handler. Regular voice turns flow through ChatSurface's
  // sharedFinal effect → agentRun.send (the unified path also used by typed
  // input). We only short-circuit here when the FSM is in `confirming` so
  // exact-phrase approval speech doesn't get mistaken for a new chat turn.
  useEffect(() => {
    if (!isOpen) return;
    const text = session.transcriptFinal.trim();
    if (!text) {
      lastSubmittedRef.current = "";
      return;
    }
    if (text === lastSubmittedRef.current) return;
    if (session.state !== "confirming" || !session.pendingApproval) return;

    lastSubmittedRef.current = text;
    if (isCancellation(text)) {
      void session.confirmApproval("rejected", "user-cancelled");
    } else if (matchPhrase(session.pendingApproval, text)) {
      void session.confirmApproval("approved");
    }
    // Non-matching speech in confirming state stays as ambient noise.
  }, [isOpen, session, session.transcriptFinal]);

  // Auto-start listening when sheet opens in VAD mode. In push-to-talk mode,
  // auto-starting leaves the sheet permanently listening and no final
  // transcript is emitted until the mic stops.
  useEffect(() => {
    if (
      isOpen &&
      mode !== "push-to-talk" &&
      voiceChat.voiceApiStatus === "connected" &&
      !autoStartedRef.current
    ) {
      autoStartedRef.current = true;
      const timer = setTimeout(() => {
        void session.startListening();
      }, 300);
      return () => clearTimeout(timer);
    }
    if (!isOpen) {
      autoStartedRef.current = false;
      // Drop the dedup memory so the next session can't be blocked by — or
      // replay — the previous turn's text if the FSM still holds it.
      lastSubmittedRef.current = "";
    }
  }, [isOpen, mode, voiceChat.voiceApiStatus, session]);

  // Safety net: keep the mic alive for VAD. Push-to-talk must not re-arm
  // itself, otherwise releasing the mic immediately starts another recording.
  useEffect(() => {
    if (!isOpen) return;
    if (mode === "push-to-talk") return;
    const interval = setInterval(() => {
      // Positive whitelist — only re-arm from terminal-quiet states so we
      // can't reopen the mic during speaking/transcribing/confirming. The
      // negative-list version allowed mid-reply re-opens during the
      // inter-phrase isSpeaking gap, which fed assistant TTS straight back
      // into MicVAD and produced "always listening" cycles.
      const armable = session.state === "idle" || session.state === "interrupted";
      if (
        armable &&
        voiceChat.voiceApiStatus === "connected" &&
        !voiceChat.isListening &&
        !voiceChat.isSpeaking &&
        !voiceChat.isProcessingSTT
      ) {
        void session.startListening();
      }
    }, 500);
    return () => clearInterval(interval);
  }, [
    isOpen,
    voiceChat.voiceApiStatus,
    voiceChat.isListening,
    voiceChat.isSpeaking,
    voiceChat.isProcessingSTT,
    session,
    mode,
  ]);

  // Mic press → barge-in if speaking, otherwise start/stop listening.
  const handleMicPress = useCallback(() => {
    if (voiceChat.voiceApiStatus !== "connected") return;
    if (voiceChat.isSpeaking || session.isInterruptible) {
      void session.interrupt();
      return;
    }
    if (mode === "push-to-talk") {
      void session.startListening();
    } else if (voiceChat.isListening) {
      void session.stopListening();
    } else {
      void session.startListening();
    }
  }, [mode, session, voiceChat.isListening, voiceChat.isSpeaking, voiceChat.voiceApiStatus]);

  const handleMicRelease = useCallback(() => {
    if (mode === "push-to-talk" && voiceChat.isListening) {
      void session.stopListening();
    }
  }, [mode, session, voiceChat.isListening]);

  const handleClose = useCallback(() => {
    void session.stopListening();
    void session.interrupt();
    autoStartedRef.current = false;
    onClose();
  }, [session, onClose]);

  // Keyboard shortcuts (Esc to close, Space for PTT).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      if (e.code === "Space" && mode === "push-to-talk" && !e.repeat) {
        e.preventDefault();
        handleMicPress();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && mode === "push-to-talk") {
        e.preventDefault();
        handleMicRelease();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isOpen, handleClose, handleMicPress, handleMicRelease, mode]);

  // Map session state → orb phase.
  const phase: OrbPhase = useMemo(() => {
    if (session.isSpeaking) return "speaking";
    if (session.state === "thinking" || session.state === "submitting") return "processing";
    if (session.isListening || voiceChat.isListening) return "listening";
    return "idle";
  }, [session.isListening, session.isSpeaking, session.state, voiceChat.isListening]);

  if (!isOpen) return null;

  const phaseLabel =
    phase === "idle"
      ? mode === "push-to-talk"
        ? "Hold to talk"
        : "Starting..."
      : phase === "listening"
        ? "Listening"
        : phase === "processing"
          ? "Thinking"
          : "Speaking — tap to interrupt";

  const partialOrHint =
    session.transcriptPartial ||
    (phase === "listening"
      ? "Say something."
      : mode === "push-to-talk"
        ? "Hold the orb or spacebar."
        : "");

  return (
    <div
      className="voice-mode-strip"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        background: "var(--bg-secondary)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div
          onPointerDown={handleMicPress}
          onPointerUp={handleMicRelease}
          onPointerLeave={handleMicRelease}
          style={{
            cursor: voiceChat.voiceApiStatus === "connected" ? "pointer" : "not-allowed",
            opacity: voiceChat.voiceApiStatus === "connected" ? 1 : 0.5,
            touchAction: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-label={phaseLabel}
        >
          <VoiceOrb
            phase={phase}
            audioLevel={
              voiceChat.isListening
                ? voiceChat.audioLevel
                : voiceChat.isSpeaking
                  ? 0.3
                  : 0
            }
            size={36}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-muted)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {phaseLabel}
          </div>
          <div
            style={{
              fontSize: "13px",
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minHeight: "18px",
            }}
            title={partialOrHint}
          >
            {partialOrHint || " "}
          </div>
        </div>

        <button
          type="button"
          onClick={() => updateVoicePrefs({ mode: mode === "vad" ? "push-to-talk" : "vad" })}
          style={{
            padding: "4px 10px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "rgba(255, 255, 255, 0.04)",
            color: "var(--accent)",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
            flexShrink: 0,
          }}
          title={mode === "vad" ? "Voice Activity Detection (auto)" : "Push-to-Talk (manual)"}
        >
          {mode === "vad" ? "Auto" : "PTT"}
        </button>

        <button
          type="button"
          onClick={handleClose}
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "rgba(255, 255, 255, 0.04)",
            color: "var(--text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            fontWeight: 300,
            flexShrink: 0,
          }}
          aria-label="Close voice mode"
        >
          ×
        </button>
      </div>

      <VoiceApprovalCard />

      {voiceChat.error && (
        <div
          style={{
            padding: "6px 10px",
            background: "rgba(255, 59, 48, 0.08)",
            borderRadius: "6px",
            color: "var(--error)",
            fontSize: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {voiceChat.error}
          </span>
          <button
            type="button"
            onClick={() => voiceChat.clearError()}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: "12px",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
