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
import { VoiceTranscript } from "./VoiceTranscript";
import { VoiceToolResults } from "./VoiceToolResult";
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
  selectedModel: string;
  onMessageSent?: (userMessage: string, assistantMessage: string) => void;
}

export function VoiceModeSheet({
  isOpen,
  onClose,
  threadId,
  selectedModel,
  onMessageSent,
}: VoiceModeSheetProps) {
  const { prefs, updateVoicePrefs } = useDeckSettings();
  const mode: VoiceMode = prefs.voice.mode;
  const dock = useOptionalAudioDock();

  // Reuse a shared session if one is in scope (e.g. LiveVoiceSurface);
  // otherwise own the runtime for standalone chat-page usage.
  const sharedSession = useOptionalVoiceSession();
  const ownSession = useVoiceSession({ enabled: !sharedSession });
  const session = sharedSession ?? ownSession;
  const { voiceChat } = session;

  const autoStartedRef = useRef(false);
  const lastSubmittedRef = useRef<string>("");

  // Subscribe to agentic SSE while open.
  useEffect(() => {
    if (!isOpen || !threadId) return;
    return session.attachThread(threadId);
  }, [isOpen, threadId, session]);

  // Drive a turn whenever the session emits a final transcript. While the
  // FSM is in `confirming`, the same transcript is interpreted as the
  // exact-phrase response to a pending approval rather than a new turn.
  useEffect(() => {
    const text = session.transcriptFinal.trim();
    if (!text || text === lastSubmittedRef.current) return;
    lastSubmittedRef.current = text;

    if (session.state === "confirming" && session.pendingApproval) {
      if (isCancellation(text)) {
        void session.confirmApproval("rejected", "user-cancelled");
      } else if (matchPhrase(session.pendingApproval, text)) {
        void session.confirmApproval("approved");
      }
      // Non-matching speech in confirming state stays as ambient noise.
      return;
    }

    void session.runTurn(text, {
      threadId,
      model: selectedModel,
      onComplete: onMessageSent,
      voice: {
        routeId: dock?.routeId ?? "handsfree-chat",
        mode: dock?.mode ?? "chat",
        surface: "chat",
        source: "manual",
      },
    });
  }, [session, session.transcriptFinal, threadId, selectedModel, onMessageSent, dock]);

  // Auto-start listening when sheet opens.
  useEffect(() => {
    if (isOpen && voiceChat.voiceApiStatus === "connected" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      const timer = setTimeout(() => {
        void session.startListening();
      }, 300);
      return () => clearTimeout(timer);
    }
    if (!isOpen) {
      autoStartedRef.current = false;
    }
  }, [isOpen, voiceChat.voiceApiStatus, session]);

  // Safety net: keep the mic alive when the session is idle and the sheet open.
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      if (
        voiceChat.voiceApiStatus === "connected" &&
        !voiceChat.isListening &&
        !voiceChat.isSpeaking &&
        !voiceChat.isProcessingSTT &&
        session.state !== "thinking" &&
        session.state !== "submitting"
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
  ]);

  // Mic press → barge-in if speaking, otherwise start/stop listening.
  const handleMicPress = useCallback(() => {
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
  }, [mode, session, voiceChat.isListening, voiceChat.isSpeaking]);

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

  return (
    <div
      className="voice-mode-overlay"
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.85)",
        zIndex: 999,
        animation: "fadeIn 0.15s cubic-bezier(0, 0, 0.2, 1)",
      }}
    >
      <div
        className="voice-mode-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "70vh",
          maxHeight: "640px",
          background: "var(--bg-secondary)",
          borderRadius: "6px 6px 0 0",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          animation: "slideUpSheet 0.15s cubic-bezier(0, 0, 0.2, 1)",
          zIndex: 1000,
        }}
      >
        {/* Minimal header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "4px 20px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                fontSize: "15px",
                fontWeight: "600",
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              Voice
            </span>
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background:
                  voiceChat.voiceApiStatus === "connected"
                    ? "var(--success)"
                    : "var(--error)",
                flexShrink: 0,
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => updateVoicePrefs({ mode: mode === "vad" ? "push-to-talk" : "vad" })}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "var(--accent)",
                fontSize: "12px",
                fontWeight: "500",
                cursor: "pointer",
                transition: "background 0.15s cubic-bezier(0, 0, 0.2, 1)",
              }}
              title={mode === "vad" ? "Voice Activity Detection (auto)" : "Push-to-Talk (manual)"}
            >
              {mode === "vad" ? "Auto" : "PTT"}
            </button>
            <button
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
                fontWeight: "300",
                transition: "background 0.15s cubic-bezier(0, 0, 0.2, 1)",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "12px 20px 20px",
            gap: "16px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              paddingTop: "12px",
            }}
          >
            <div
              onPointerDown={handleMicPress}
              onPointerUp={handleMicRelease}
              onPointerLeave={handleMicRelease}
              style={{
                cursor: voiceChat.voiceApiStatus === "connected" ? "pointer" : "not-allowed",
                opacity: voiceChat.voiceApiStatus === "connected" ? 1 : 0.5,
                touchAction: "none",
              }}
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
                size={80}
              />
            </div>

            <div
              style={{
                fontSize: "13px",
                color: "var(--text-muted)",
                textAlign: "center",
                marginTop: "12px",
                fontWeight: "400",
                letterSpacing: "-0.01em",
                transition: "opacity 0.2s cubic-bezier(0.4, 0, 0.6, 1)",
              }}
            >
              {phase === "idle" && "Starting..."}
              {phase === "listening" && "Listening..."}
              {phase === "processing" && "Thinking..."}
              {phase === "speaking" && "Tap to interrupt"}
            </div>
          </div>

          <VoiceApprovalCard />

          <VoiceToolResults
            artifacts={session.tools.artifacts}
            isGenerating={session.tools.isRunning}
            toolName={session.tools.currentToolName ?? undefined}
          />

          <VoiceTranscript
            entries={session.turns}
            currentUserSpeech={session.transcriptPartial}
            isListening={voiceChat.isListening}
          />
        </div>

        {voiceChat.error && (
          <div
            style={{
              padding: "10px 20px",
              background: "rgba(255, 59, 48, 0.08)",
              borderTop: "1px solid rgba(255, 59, 48, 0.12)",
              color: "var(--error)",
              fontSize: "13px",
              textAlign: "center",
              fontWeight: "400",
            }}
          >
            {voiceChat.error}
            <button
              onClick={() => voiceChat.clearError()}
              style={{
                marginLeft: "8px",
                background: "none",
                border: "none",
                color: "inherit",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
