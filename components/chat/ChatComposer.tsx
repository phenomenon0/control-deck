"use client";

/**
 * ChatComposer — evolved input composer for the agent chat surface
 *
 * Replaces ChatInput.tsx with:
 *   - Context row: model badge, attachment thumbnails (DESIGN.md §3.4)
 *   - Run-state-aware send/stop button (BEHAVIOR.md §4.4)
 *   - Design-token-driven styling (no inline hardcoded values)
 *   - Same voice capabilities (PTT, VAD, voice mode)
 *
 * Props are narrower than ChatInput: receives RunState directly instead
 * of a bare isLoading boolean, enabling phase-specific UI behavior.
 *
 * See: SURFACE.md §5.1 (ChatComposer spec), DESIGN.md §3.4
 */

import { useEffect, useRef, type RefObject } from "react";
import { Paperclip, Send, Square, AudioLines, Mic, X } from "lucide-react";
import { VoiceInputIndicator } from "@/components/chat/VoiceWaveform";
import type { PendingUpload } from "@/components/chat/UploadTray";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import type { RunState } from "@/lib/types/agentRun";

// =============================================================================
// Types
// =============================================================================

export interface ChatComposerProps {
  /** Current run state from useAgentRun */
  runState: RunState;

  // Input
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;

  // Model context
  model?: string;

  // Voice
  voiceChat: UseVoiceChatReturn;
  voiceEnabled: boolean;
  voiceMode: string;
  onVoiceModeOpen: () => void;
  onMicClick: () => void;
  onMicRelease: () => void;

  // Uploads
  pendingUploads: PendingUpload[];
  onAttachClick: () => void;
  onRemoveUpload?: (id: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;

  // Edit last message (BEHAVIOR.md §5.2: Up Arrow when input empty)
  onEditLastMessage?: () => void;

  // Refs
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

// =============================================================================
// Helpers
// =============================================================================

/** Is the agent actively working? (any non-idle, non-error phase) */
function isRunning(runState: RunState): boolean {
  return runState.phase !== "idle" && runState.phase !== "error";
}

/** Can the user type and send? */
function isInputEnabled(runState: RunState): boolean {
  return runState.phase === "idle" || runState.phase === "error";
}

/** Get placeholder text based on run state */
function getPlaceholder(runState: RunState): string {
  switch (runState.phase) {
    case "submitted":
      return "Sending...";
    case "thinking":
      return "Agent is reasoning...";
    case "streaming":
      return "Agent is responding...";
    case "executing":
      return `Agent is using ${runState.toolName}...`;
    case "resuming":
      return "Agent is continuing...";
    case "error":
      return "Something went wrong. Try again...";
    default:
      return "Ask anything, or describe what you want to build...";
  }
}

// =============================================================================
// Sub-components
// =============================================================================

/** Context row: model badge + inline attachment previews */
function ContextRow({
  model,
  uploads,
  onRemoveUpload,
}: {
  model?: string;
  uploads: PendingUpload[];
  onRemoveUpload?: (id: string) => void;
}) {
  if (!model && uploads.length === 0) return null;

  return (
    <div className="composer-context-row">
      {/* Model badge */}
      {model && (
        <span className="composer-model-badge">{model}</span>
      )}

      {/* Inline attachment thumbnails */}
      {uploads.length > 0 && (
        <div className="composer-attachments">
          {uploads.map((upload) => (
            <div key={upload.id} className="composer-attachment-thumb">
              {upload.mimeType.startsWith("image/") ? (
                <img
                  src={upload.url}
                  alt={upload.name}
                  className="composer-attachment-img"
                />
              ) : (
                <Paperclip size={12} />
              )}
              {onRemoveUpload && (
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => onRemoveUpload(upload.id)}
                  aria-label={`Remove ${upload.name}`}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Primary action button: Send (idle) or Stop (running) */
function ActionButton({
  runState,
  hasContent,
  onStop,
  isListening,
}: {
  runState: RunState;
  hasContent: boolean;
  onStop: () => void;
  isListening: boolean;
}) {
  const running = isRunning(runState);

  if (running) {
    // Stop button — BEHAVIOR.md §4.4: "Loading (stop mode): background: var(--error)"
    return (
      <button
        type="button"
        onClick={onStop}
        className="composer-btn-stop"
        aria-label="Stop agent"
      >
        <Square size={12} fill="currentColor" />
      </button>
    );
  }

  // Send button — BEHAVIOR.md §4.4
  return (
    <button
      type="submit"
      disabled={!hasContent || isListening}
      className={`composer-btn-send ${hasContent ? "composer-btn-send--active" : ""}`}
      aria-label="Send message"
    >
      <Send size={14} />
    </button>
  );
}

// =============================================================================
// ChatComposer
// =============================================================================

export function ChatComposer({
  runState,
  inputValue,
  onInputChange,
  onSubmit,
  onStop,
  model,
  voiceChat,
  voiceEnabled,
  voiceMode,
  onVoiceModeOpen,
  onMicClick,
  onMicRelease,
  pendingUploads,
  onAttachClick,
  onRemoveUpload,
  onEditLastMessage,
  fileInputRef,
  inputRef,
}: ChatComposerProps) {
  const enabled = isInputEnabled(runState);
  const running = isRunning(runState);
  const hasContent = inputValue.trim().length > 0 || pendingUploads.length > 0;
  const showVoiceInput = voiceChat.isListening || voiceChat.isProcessingSTT;

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(inputRef.current.scrollHeight, 200) + "px";
    }
  }, [inputValue, inputRef]);

  // Re-focus composer when run completes (BEHAVIOR.md §3.4 "Any -> IDLE")
  const prevPhaseRef = useRef(runState.phase);
  useEffect(() => {
    if (prevPhaseRef.current !== "idle" && runState.phase === "idle") {
      inputRef.current?.focus();
    }
    prevPhaseRef.current = runState.phase;
  }, [runState.phase, inputRef]);

  return (
    <form
      onSubmit={onSubmit}
      className="composer-form"
      aria-label="Message composer"
    >
      <div className={`composer-container ${running ? "composer-container--running" : ""}`}>
        {/* Context row: model + attachment previews */}
        <ContextRow
          model={model}
          uploads={pendingUploads}
          onRemoveUpload={onRemoveUpload}
        />

        {/* Main input row */}
        <div className="composer-input-row">
          {/* Attach button */}
          <button
            type="button"
            onClick={onAttachClick}
            className={`composer-btn-icon ${pendingUploads.length > 0 ? "composer-btn-icon--accent" : ""}`}
            aria-label={pendingUploads.length > 0 ? "View attachments" : "Attach files"}
            title={pendingUploads.length > 0 ? "View attachments" : "Attach files"}
          >
            <Paperclip size={18} />
            {pendingUploads.length > 0 && (
              <span className="composer-upload-count">{pendingUploads.length}</span>
            )}
          </button>

          {/* Textarea or voice indicator */}
          {showVoiceInput ? (
            <VoiceInputIndicator
              isRecording={voiceChat.isListening}
              isProcessing={voiceChat.isProcessingSTT}
              audioLevel={voiceChat.audioLevel}
              transcript={voiceChat.transcript}
            />
          ) : (
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={getPlaceholder(runState)}
              disabled={!enabled}
              rows={1}
              className="composer-textarea"
              aria-label="Message input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (hasContent && enabled) {
                    onSubmit(e);
                  }
                }
                // Up Arrow: edit last user message when input is empty (§5.2)
                if (
                  e.key === "ArrowUp" &&
                  !inputValue.trim() &&
                  enabled &&
                  onEditLastMessage
                ) {
                  e.preventDefault();
                  onEditLastMessage();
                }
              }}
            />
          )}

          {/* Action buttons row */}
          <div className="composer-actions">
            {/* Voice mode button */}
            <button
              type="button"
              onClick={onVoiceModeOpen}
              disabled={voiceChat.voiceApiStatus === "disconnected"}
              className={`composer-btn-icon ${voiceChat.voiceApiStatus === "connected" ? "composer-btn-icon--voice-active" : ""}`}
              title="Open Voice Mode (Full Screen)"
            >
              <AudioLines size={18} />
            </button>

            {/* Inline mic button */}
            {voiceEnabled && (
              <button
                type="button"
                onMouseDown={onMicClick}
                onMouseUp={onMicRelease}
                onMouseLeave={onMicRelease}
                disabled={voiceChat.voiceApiStatus === "disconnected" || voiceChat.isProcessingSTT}
                className={`composer-btn-icon ${voiceChat.isListening ? "composer-btn-icon--recording" : ""}`}
                title={voiceMode === "push-to-talk" ? "Hold to talk" : "Click to talk"}
              >
                <Mic size={18} />
              </button>
            )}

            {/* Send / Stop */}
            <ActionButton
              runState={runState}
              hasContent={hasContent}
              onStop={onStop}
              isListening={voiceChat.isListening}
            />
          </div>
        </div>
      </div>
    </form>
  );
}
