"use client";

import { useEffect, useCallback } from "react";
import { useVoiceChat, type TTSEngine, type VoiceInputMode } from "@/lib/hooks/useVoiceChat";
import { AudioLevelIndicator } from "./AudioLevelIndicator";

interface VoiceInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  ttsEngine: TTSEngine;
  mode: VoiceInputMode;
  onModeChange?: (mode: VoiceInputMode) => void;
  className?: string;
}

export function VoiceInput({
  onSend,
  disabled = false,
  ttsEngine,
  mode,
  onModeChange,
  className = "",
}: VoiceInputProps) {
  const {
    isListening,
    isProcessingSTT,
    transcript,
    audioLevel,
    voiceApiStatus,
    error,
    startListening,
    stopListening,
    clearError,
  } = useVoiceChat({
    ttsEngine,
    onAutoSend: onSend,
    silenceTimeout: 1500,
  });

  // Handle push-to-talk keyboard (spacebar)
  useEffect(() => {
    if (mode !== "push-to-talk" || disabled) return;

    let isSpaceDown = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === "Space" && !isSpaceDown && !e.repeat) {
        e.preventDefault();
        isSpaceDown = true;
        startListening();
      }

      if (e.code === "Escape" && isListening) {
        e.preventDefault();
        // Cancel without sending
        stopListening();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && isSpaceDown) {
        e.preventDefault();
        isSpaceDown = false;
        if (isListening) {
          stopListening();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mode, disabled, isListening, startListening, stopListening]);

  // Handle toggle mode click
  const handleMicClick = useCallback(() => {
    if (disabled) return;

    if (mode === "toggle") {
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
    } else {
      // Push-to-talk: start on mousedown, stop on mouseup
      startListening();
    }
  }, [mode, disabled, isListening, startListening, stopListening]);

  const handleMicRelease = useCallback(() => {
    if (mode === "push-to-talk" && isListening) {
      stopListening();
    }
  }, [mode, isListening, stopListening]);

  // Status text
  const getStatusText = () => {
    if (voiceApiStatus === "disconnected") {
      return "Voice API offline";
    }
    if (isProcessingSTT) {
      return "Processing...";
    }
    if (isListening) {
      return transcript || "Listening...";
    }
    if (error) {
      return error;
    }
    if (mode === "push-to-talk") {
      return "Hold spacebar or click to talk";
    }
    return "Click to start talking";
  };

  const isApiOffline = voiceApiStatus === "disconnected";

  return (
    <div className={`flex flex-col items-center gap-4 py-4 ${className}`}>
      {/* Mode selector */}
      {onModeChange && (
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => onModeChange("push-to-talk")}
            className={`px-3 py-1.5 rounded-full transition-colors ${
              mode === "push-to-talk"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
            }`}
          >
            Push to Talk
          </button>
          <button
            onClick={() => onModeChange("toggle")}
            className={`px-3 py-1.5 rounded-full transition-colors ${
              mode === "toggle"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
            }`}
          >
            Toggle
          </button>
        </div>
      )}

      {/* Mic button with audio level indicator */}
      <button
        onMouseDown={handleMicClick}
        onMouseUp={handleMicRelease}
        onMouseLeave={handleMicRelease}
        onTouchStart={handleMicClick}
        onTouchEnd={handleMicRelease}
        disabled={disabled || isApiOffline || isProcessingSTT}
        className={`
          relative rounded-full bg-transparent border-none p-0 transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--bg-primary)]
          ${disabled || isApiOffline ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          ${isListening ? "scale-110" : "hover:scale-105"}
        `}
        aria-label={isListening ? "Stop recording" : "Start recording"}
      >
        <AudioLevelIndicator
          level={audioLevel}
          isActive={isListening}
          size="lg"
          variant="rings"
        />
      </button>

      {/* Status text */}
      <div
        className={`text-sm text-center min-h-[2.5rem] max-w-[300px] px-4 ${
          error ? "text-[var(--error)]" : "text-[var(--text-muted)]"
        }`}
      >
        {isProcessingSTT ? (
          <span className="flex items-center justify-center gap-2">
            <LoadingSpinner size={14} />
            {getStatusText()}
          </span>
        ) : (
          getStatusText()
        )}
      </div>

      {/* Transcript preview (when listening) */}
      {isListening && transcript && (
        <div className="text-[var(--text-secondary)] text-base italic max-w-[400px] text-center">
          "{transcript}"
        </div>
      )}

      {/* Error dismiss */}
      {error && !isListening && (
        <button
          onClick={clearError}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline"
        >
          Dismiss
        </button>
      )}

      {/* Voice API offline warning */}
      {isApiOffline && (
        <div className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded-lg px-4 py-2 max-w-[300px] text-center">
          Voice API not running.
          <br />
          <code className="text-[var(--accent)]">
            cd ~/Documents/INIT/voice-api && ./run.sh
          </code>
        </div>
      )}
    </div>
  );
}

// Compact version for inline use
export function VoiceInputCompact({
  onSend,
  disabled = false,
  ttsEngine,
  mode,
  className = "",
}: Omit<VoiceInputProps, "onModeChange">) {
  const {
    isListening,
    isProcessingSTT,
    audioLevel,
    voiceApiStatus,
    startListening,
    stopListening,
  } = useVoiceChat({
    ttsEngine,
    onAutoSend: onSend,
    silenceTimeout: 1500,
  });

  const handleMicClick = useCallback(() => {
    if (disabled || voiceApiStatus === "disconnected") return;

    if (mode === "toggle") {
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
    } else {
      startListening();
    }
  }, [mode, disabled, voiceApiStatus, isListening, startListening, stopListening]);

  const handleMicRelease = useCallback(() => {
    if (mode === "push-to-talk" && isListening) {
      stopListening();
    }
  }, [mode, isListening, stopListening]);

  const isApiOffline = voiceApiStatus === "disconnected";

  return (
    <button
      onMouseDown={handleMicClick}
      onMouseUp={handleMicRelease}
      onMouseLeave={handleMicRelease}
      onTouchStart={handleMicClick}
      onTouchEnd={handleMicRelease}
      disabled={disabled || isApiOffline || isProcessingSTT}
      className={`
        relative p-2 rounded-full transition-all duration-200 
        ${disabled || isApiOffline ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-[var(--bg-tertiary)]"}
        ${isListening ? "bg-[var(--accent)]" : ""}
        ${className}
      `}
      title={
        isApiOffline
          ? "Voice API offline"
          : isListening
          ? "Release to send"
          : mode === "push-to-talk"
          ? "Hold to talk"
          : "Click to talk"
      }
      aria-label={isListening ? "Stop recording" : "Start recording"}
    >
      {isProcessingSTT ? (
        <LoadingSpinner size={18} />
      ) : (
        <AudioLevelIndicator
          level={audioLevel}
          isActive={isListening}
          size="sm"
          variant="pulse"
        />
      )}
    </button>
  );
}

function LoadingSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
