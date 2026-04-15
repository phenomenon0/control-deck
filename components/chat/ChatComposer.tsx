"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Paperclip, Send, Square, AudioLines, Mic, X } from "lucide-react";
import { VoiceInputIndicator } from "@/components/chat/VoiceWaveform";
import type { PendingUpload } from "@/components/chat/UploadTray";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import type { RunState } from "@/lib/types/agentRun";

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

  onEditLastMessage?: () => void;

  // Refs
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

function isRunning(runState: RunState): boolean {
  return runState.phase !== "idle" && runState.phase !== "error";
}

function isInputEnabled(runState: RunState): boolean {
  return runState.phase === "idle" || runState.phase === "error";
}

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
      {model && (
        <span className="composer-model-badge">{model}</span>
      )}

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

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(inputRef.current.scrollHeight, 280) + "px";
    }
  }, [inputValue, inputRef]);

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
        <ContextRow
          model={model}
          uploads={pendingUploads}
          onRemoveUpload={onRemoveUpload}
        />

        <div className="composer-input-row">
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

          <div className="composer-actions">
            <button
              type="button"
              onClick={onVoiceModeOpen}
              disabled={voiceChat.voiceApiStatus === "disconnected"}
              className={`composer-btn-icon ${voiceChat.voiceApiStatus === "connected" ? "composer-btn-icon--voice-active" : ""}`}
              title="Open Voice Mode (Full Screen)"
            >
              <AudioLines size={18} />
            </button>

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
