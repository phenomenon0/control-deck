"use client";

import { useEffect, type RefObject } from "react";
import { VoiceInputIndicator } from "@/components/chat/VoiceWaveform";
import { VoiceModeIcon, MicIcon, PaperclipIcon, SendIcon } from "@/components/chat/ChatIcons";
import type { PendingUpload } from "@/components/chat/UploadTray";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";

interface ChatInputProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;

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
  fileInputRef: RefObject<HTMLInputElement | null>;

  // Refs
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function ChatInput({
  inputValue,
  onInputChange,
  onSubmit,
  isLoading,
  voiceChat,
  voiceEnabled,
  voiceMode,
  onVoiceModeOpen,
  onMicClick,
  onMicRelease,
  pendingUploads,
  onAttachClick,
  fileInputRef,
  inputRef,
}: ChatInputProps) {
  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + "px";
    }
  }, [inputValue, inputRef]);

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: "var(--bg-primary)",
        padding: "12px 20px 16px",
        maxWidth: 960 + 80,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div
        className="chat-input-container"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 12px",
          transition: "border-color 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      >
        {/* Attach button */}
        <button
          type="button"
          onClick={onAttachClick}
          style={{
            background: "none",
            border: "none",
            color: pendingUploads.length > 0 ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "color 150ms cubic-bezier(0, 0, 0.2, 1)",
          }}
          title={pendingUploads.length > 0 ? "View attachments" : "Attach files"}
        >
          <PaperclipIcon size={18} />
          {pendingUploads.length > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                background: "var(--accent)",
                color: "#FFFFFF",
                borderRadius: 8,
                padding: "1px 5px",
              }}
            >
              {pendingUploads.length}
            </span>
          )}
        </button>

        {/* Input area - either textarea or voice indicator */}
        {voiceChat.isListening || voiceChat.isProcessingSTT ? (
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
            placeholder="Message..."
            disabled={isLoading}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: 14,
              lineHeight: 1.5,
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
              padding: 0,
              outline: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
          />
        )}

        {/* Voice Mode button (full-screen voice conversation) */}
        <button
          type="button"
          onClick={onVoiceModeOpen}
          disabled={voiceChat.voiceApiStatus === "disconnected"}
          style={{
            background: voiceChat.voiceApiStatus === "connected" ? "rgba(94, 106, 210, 0.1)" : "none",
            border: voiceChat.voiceApiStatus === "connected" ? "1px solid rgba(94, 106, 210, 0.2)" : "1px solid transparent",
            color: voiceChat.voiceApiStatus === "connected" ? "var(--accent)" : "var(--text-muted)",
            cursor: voiceChat.voiceApiStatus === "connected" ? "pointer" : "not-allowed",
            padding: 6,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            opacity: voiceChat.voiceApiStatus === "disconnected" ? 0.5 : 1,
            transition: "all 150ms cubic-bezier(0, 0, 0.2, 1)",
          }}
          title="Open Voice Mode (Full Screen)"
        >
          <VoiceModeIcon size={18} />
        </button>

        {/* Mic button (inline voice input) - always visible when voice enabled */}
        {voiceEnabled && (
          <button
            type="button"
            onMouseDown={onMicClick}
            onMouseUp={onMicRelease}
            onMouseLeave={onMicRelease}
            disabled={voiceChat.voiceApiStatus === "disconnected" || voiceChat.isProcessingSTT}
            style={{
              background: voiceChat.isListening ? "var(--error)" : "none",
              border: "none",
              color: voiceChat.isListening ? "white" : "var(--text-muted)",
              cursor: "pointer",
              padding: 6,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              transition: "all 150ms cubic-bezier(0, 0, 0.2, 1)",
            }}
            title={voiceMode === "push-to-talk" ? "Hold to talk" : "Click to talk"}
          >
            <MicIcon size={18} />
          </button>
        )}

        {/* Send button - Apple-style filled circle */}
        <button
          type="submit"
          disabled={isLoading || (!inputValue.trim() && pendingUploads.length === 0) || voiceChat.isListening}
          style={{
            background: inputValue.trim() || pendingUploads.length > 0 ? "var(--accent)" : "var(--bg-tertiary)",
            border: "none",
            color: inputValue.trim() || pendingUploads.length > 0 ? "#FFFFFF" : "var(--text-muted)",
            cursor: inputValue.trim() || pendingUploads.length > 0 ? "pointer" : "default",
            padding: 6,
            borderRadius: 6,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: isLoading || voiceChat.isListening ? 0.5 : 1,
            transition: "all 150ms cubic-bezier(0, 0, 0.2, 1)",
            flexShrink: 0,
          }}
        >
          <SendIcon size={16} />
        </button>
      </div>
    </form>
  );
}
