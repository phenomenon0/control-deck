"use client";

import { useState } from "react";
import { useVoiceChat, type TTSEngine, type VoiceInputMode } from "@/lib/hooks/useVoiceChat";
import { AudioLevelIndicator } from "@/components/chat/AudioLevelIndicator";
import Link from "next/link";

const ENGINES: { id: TTSEngine; name: string; description: string }[] = [
  { id: "piper", name: "Piper", description: "Fast, robotic" },
  { id: "xtts", name: "XTTS v2", description: "Human-like, 58 voices" },
  { id: "chatterbox", name: "Chatterbox", description: "Most expressive" },
];

export function VoicePane() {
  const [engine, setEngine] = useState<TTSEngine>("chatterbox");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<VoiceInputMode>("push-to-talk");

  const {
    isListening,
    isSpeaking,
    isProcessingSTT,
    isProcessingTTS,
    transcript,
    audioLevel,
    voiceApiStatus,
    error,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    checkVoiceApi,
    clearError,
  } = useVoiceChat({
    ttsEngine: engine,
    onTranscript: (transcribedText) => {
      setText(transcribedText);
    },
  });

  const handleGenerate = async () => {
    if (!text.trim()) return;
    await speak(text);
  };

  const handleMicClick = () => {
    if (mode === "toggle") {
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
    } else {
      startListening();
    }
  };

  const handleMicRelease = () => {
    if (mode === "push-to-talk" && isListening) {
      stopListening();
    }
  };

  return (
    <div className="voice-stage">
      <header className="voice-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Speech loop</div>
            <h1>Voice</h1>
            <p>Whisper speech input, local TTS engines, and live voice controls for the chat surface.</p>
          </div>
          <div className="warp-pane-actions">
            <span className="pill--mono">STT Whisper</span>
            <span className="pill--mono">TTS {engine}</span>
          <div
            className="flex items-center gap-1"
            title={`Voice API: ${voiceApiStatus}`}
          >
            <span
              className={`voice-status-dot voice-status-dot--${voiceApiStatus}`}
            />
          </div>
        </div>
        </div>
      </header>

      <div className="space-y-6">
        {/* Live Chat Mode Link */}
        <div className="card bg-[var(--accent)]/10 border-[var(--accent)]/30">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">
                Live Voice Chat
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Have a conversation using voice in the chat interface
              </p>
            </div>
            <Link
              href="/deck/chat"
              className="btn btn-primary text-sm"
            >
              Open Chat
            </Link>
          </div>
        </div>

        {/* Engine Selection */}
        <div className="card">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span>TTS Engine</span>
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {ENGINES.map((e) => (
              <button
                key={e.id}
                onClick={() => setEngine(e.id)}
                className={`p-3 text-left rounded-lg border transition-colors ${
                  engine === e.id
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)]"
                }`}
              >
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{e.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* STT with Audio Level Indicator */}
        <div className="card">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span>Speech to Text</span>
          </h3>
          
          {/* Mode selector */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setMode("push-to-talk")}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                mode === "push-to-talk"
                  ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              Push to Talk
            </button>
            <button
              onClick={() => setMode("toggle")}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                mode === "toggle"
                  ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              Toggle
            </button>
          </div>

          <div className="flex flex-col items-center gap-4">
            {/* Audio Level Indicator with mic button */}
            <button
              onMouseDown={handleMicClick}
              onMouseUp={handleMicRelease}
              onMouseLeave={handleMicRelease}
              onTouchStart={handleMicClick}
              onTouchEnd={handleMicRelease}
              disabled={voiceApiStatus === "disconnected" || isProcessingSTT}
              className={`
                relative rounded-full bg-transparent border-0 p-0 transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2
                ${voiceApiStatus === "disconnected" ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                ${isListening ? "scale-110" : "hover:scale-105"}
              `}
            >
              <AudioLevelIndicator
                level={audioLevel}
                isActive={isListening}
                size="lg"
                variant="rings"
              />
            </button>

            {/* Status */}
            <div className="text-sm text-center">
              {isProcessingSTT ? (
                <span className="text-[var(--text-muted)] flex items-center gap-2">
                  <LoadingSpinner size={14} />
                  Processing...
                </span>
              ) : isListening ? (
                <span className="text-[var(--accent)]">
                  {mode === "push-to-talk" ? "Release to send" : "Listening... Click to stop"}
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">
                  {mode === "push-to-talk" ? "Hold to talk" : "Click to start"}
                </span>
              )}
            </div>

            {/* Transcript preview */}
            {transcript && (
              <div className="text-[var(--text-secondary)] text-base italic max-w-[400px] text-center transcript-appear">
                "{transcript}"
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-[var(--error)]">
                <span>{error}</span>
                <button
                  onClick={clearError}
                  className="text-xs underline hover:no-underline"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>

        {/* TTS */}
        <div className="card">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span>Text to Speech</span>
          </h3>
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text to speak..."
              rows={4}
              className="input resize-none"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={isSpeaking ? stopSpeaking : handleGenerate}
                disabled={isProcessingTTS || (!text.trim() && !isSpeaking)}
                className={`btn ${isSpeaking ? "btn-secondary" : "btn-primary"}`}
              >
                {isProcessingTTS ? (
                  <span className="flex items-center gap-2">
                    <LoadingSpinner size={14} />
                    Generating...
                  </span>
                ) : isSpeaking ? (
                  "Stop"
                ) : (
                  "Generate Speech"
                )}
              </button>
              {isSpeaking && (
                <div className="flex items-center gap-2 text-[var(--accent)]">
                  <SpeakingIndicator />
                  <span className="text-sm">Playing...</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="card bg-[var(--bg-primary)]">
          <div className="text-xs text-[var(--text-muted)] space-y-2">
            <p>Voice API must be running on port 8000 for STT/TTS to work.</p>
            <p>Run: <code className="text-[var(--accent)]">cd ~/Documents/INIT/voice-api && ./run.sh</code></p>
            {voiceApiStatus === "disconnected" && (
              <button
                onClick={checkVoiceApi}
                className="text-[var(--accent)] hover:underline"
              >
                Check connection
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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

function SpeakingIndicator() {
  return (
    <div className="flex items-center gap-0.5 h-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="w-0.5 h-full bg-[var(--accent)] rounded-full voice-bar"
          style={{ animationDelay: `${(i - 1) * 0.1}s` }}
        />
      ))}
    </div>
  );
}
