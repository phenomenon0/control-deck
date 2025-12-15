"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { VoiceOrb, type OrbPhase } from "./VoiceOrb";
import { VoiceTranscript } from "./VoiceTranscript";
import { VoiceToolResults } from "./VoiceToolResult";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

export type VoiceMode = "push-to-talk" | "vad";

interface VoiceModeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  threadId: string;
  selectedModel: string;
  onMessageSent?: (userMessage: string, assistantMessage: string) => void;
}

interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

export function VoiceModeSheet({
  isOpen,
  onClose,
  threadId,
  selectedModel,
  onMessageSent,
}: VoiceModeSheetProps) {
  // Get voice settings from centralized provider
  const { prefs, updateVoicePrefs } = useDeckSettings();
  
  // Map provider mode to local mode (provider uses "push-to-talk" | "vad")
  const mode: VoiceMode = prefs.voice.mode === "vad" ? "vad" : "push-to-talk";
  
  // Conversation state
  const [phase, setPhase] = useState<OrbPhase>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentUserSpeech, setCurrentUserSpeech] = useState("");
  const [assistantResponse, setAssistantResponse] = useState("");
  
  // Tool/artifact state
  const [currentArtifacts, setCurrentArtifacts] = useState<Artifact[]>([]);
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [currentToolName, setCurrentToolName] = useState<string | undefined>();
  
  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<Array<{ role: string; content: string }>>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Voice chat hook - uses settings from provider
  const voiceChat = useVoiceChat({
    ttsEngine: prefs.voice.ttsEngine,
    silenceTimeout: prefs.voice.silenceTimeoutMs,
    silenceThreshold: prefs.voice.silenceThreshold,
    onTranscript: (text) => {
      setCurrentUserSpeech(text);
    },
    onAutoSend: (text) => {
      handleUserUtterance(text);
    },
  });

  // Connect to SSE for tool events
  useEffect(() => {
    if (!isOpen || !threadId) return;

    const eventSource = new EventSource(`/api/agui/stream?threadId=${threadId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        if (event.type === "ToolCallStart") {
          setIsToolRunning(true);
          setCurrentToolName(event.toolName);
          
          // Add system message about tool
          const toolMessage = getToolStartMessage(event.toolName);
          if (toolMessage) {
            setTranscript((prev) => [
              ...prev,
              { id: `tool-${event.toolCallId}`, role: "system", content: toolMessage },
            ]);
          }
        }

        if (event.type === "ToolCallResult") {
          setIsToolRunning(false);
          setCurrentToolName(undefined);
        }

        if (event.type === "ArtifactCreated") {
          const artifact: Artifact = {
            id: event.artifactId,
            url: event.url,
            name: event.name,
            mimeType: event.mimeType,
          };
          setCurrentArtifacts((prev) => [...prev, artifact]);
        }
      } catch {}
    };

    return () => {
      eventSource.close();
    };
  }, [isOpen, threadId]);

  // Handle user utterance - send to chat API
  const handleUserUtterance = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      setPhase("processing");
      setCurrentUserSpeech("");
      setCurrentArtifacts([]);

      // Add user message to transcript
      const userEntry: TranscriptEntry = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };
      setTranscript((prev) => [...prev, userEntry]);

      // Update conversation history
      conversationRef.current.push({ role: "user", content: text });

      // Prepare assistant entry (streaming)
      const assistantId = `assistant-${Date.now()}`;
      setTranscript((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);

      try {
        abortControllerRef.current = new AbortController();

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: conversationRef.current,
            model: selectedModel,
            threadId,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Chat API error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullResponse += chunk;
          setAssistantResponse(fullResponse);

          // Update transcript with streaming response
          setTranscript((prev) =>
            prev.map((entry) =>
              entry.id === assistantId
                ? { ...entry, content: cleanResponseForDisplay(fullResponse) }
                : entry
            )
          );
        }

        // Finalize transcript
        setTranscript((prev) =>
          prev.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: cleanResponseForDisplay(fullResponse), isStreaming: false }
              : entry
          )
        );

        // Update conversation history
        conversationRef.current.push({ role: "assistant", content: fullResponse });

        // Notify parent
        onMessageSent?.(text, fullResponse);

        // Speak the response
        const textToSpeak = cleanResponseForSpeech(fullResponse);
        if (textToSpeak) {
          setPhase("speaking");
          await voiceChat.speak(textToSpeak);
        }

        // Ready for next turn
        setPhase("idle");
        setAssistantResponse("");

        // If VAD mode, start listening again after a brief pause
        if (mode === "vad") {
          setTimeout(() => {
            if (isOpen) {
              voiceChat.startListening();
              setPhase("listening");
            }
          }, 500);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("[VoiceMode] Error:", error);
          setTranscript((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "system",
              content: "Sorry, there was an error. Please try again.",
            },
          ]);
        }
        setPhase("idle");
      }
    },
    [selectedModel, threadId, mode, isOpen, voiceChat, onMessageSent]
  );

  // Handle mic button interaction
  const handleMicPress = useCallback(() => {
    if (voiceChat.isSpeaking) {
      voiceChat.stopSpeaking();
    }

    if (mode === "push-to-talk") {
      voiceChat.startListening();
      setPhase("listening");
    } else {
      // Toggle in VAD mode
      if (voiceChat.isListening) {
        voiceChat.stopListening();
        setPhase("idle");
      } else {
        voiceChat.startListening();
        setPhase("listening");
      }
    }
  }, [mode, voiceChat]);

  const handleMicRelease = useCallback(() => {
    if (mode === "push-to-talk" && voiceChat.isListening) {
      voiceChat.stopListening();
    }
  }, [mode, voiceChat]);

  // Update phase based on voice chat state
  useEffect(() => {
    if (voiceChat.isListening) {
      setPhase("listening");
    } else if (voiceChat.isProcessingSTT) {
      setPhase("processing");
    } else if (voiceChat.isSpeaking) {
      setPhase("speaking");
    }
  }, [voiceChat.isListening, voiceChat.isProcessingSTT, voiceChat.isSpeaking]);

  // Handle close
  const handleClose = useCallback(() => {
    voiceChat.stopListening();
    voiceChat.stopSpeaking();
    abortControllerRef.current?.abort();
    setPhase("idle");
    setCurrentUserSpeech("");
    setAssistantResponse("");
    onClose();
  }, [voiceChat, onClose]);

  // Keyboard shortcut to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div className="voice-mode-overlay" onClick={handleClose}>
      <div
        className="voice-mode-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "70vh",
          maxHeight: "600px",
          background: "var(--bg-primary)",
          borderRadius: "24px 24px 0 0",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -4px 30px rgba(0, 0, 0, 0.3)",
          animation: "slideUp 0.3s ease-out",
          zIndex: 1000,
        }}
      >
        {/* Handle bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "12px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "4px",
              borderRadius: "2px",
              background: "var(--border)",
            }}
          />
        </div>

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 20px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <h2
              style={{
                fontSize: "18px",
                fontWeight: "600",
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              Voice Mode
            </h2>
            <span
              style={{
                fontSize: "12px",
                padding: "2px 8px",
                borderRadius: "4px",
                background:
                  voiceChat.voiceApiStatus === "connected"
                    ? "rgba(34, 197, 94, 0.2)"
                    : "rgba(239, 68, 68, 0.2)",
                color:
                  voiceChat.voiceApiStatus === "connected"
                    ? "rgb(34, 197, 94)"
                    : "rgb(239, 68, 68)",
              }}
            >
              {voiceChat.voiceApiStatus === "connected" ? "Connected" : "Disconnected"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Mode toggle */}
            <button
              onClick={() => updateVoicePrefs({ mode: mode === "vad" ? "push-to-talk" : "vad" })}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {mode === "vad" ? "VAD" : "PTT"}
            </button>

            {/* Close button */}
            <button
              onClick={handleClose}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                border: "none",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
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
            justifyContent: "center",
            padding: "20px",
            gap: "20px",
            overflow: "hidden",
          }}
        >
          {/* Orb */}
          <div
            onMouseDown={handleMicPress}
            onMouseUp={handleMicRelease}
            onMouseLeave={handleMicRelease}
            onTouchStart={handleMicPress}
            onTouchEnd={handleMicRelease}
            style={{
              cursor: voiceChat.voiceApiStatus === "connected" ? "pointer" : "not-allowed",
              opacity: voiceChat.voiceApiStatus === "connected" ? 1 : 0.5,
              transition: "transform 0.2s ease",
              transform: phase === "listening" ? "scale(1.05)" : "scale(1)",
            }}
          >
            <VoiceOrb
              phase={phase}
              audioLevel={voiceChat.isListening ? voiceChat.audioLevel : voiceChat.isSpeaking ? 0.3 : 0}
              size={180}
            />
          </div>

          {/* Phase indicator */}
          <div
            style={{
              fontSize: "14px",
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            {phase === "idle" && (mode === "vad" ? "Tap orb to start" : "Hold orb to talk")}
            {phase === "listening" && (mode === "vad" ? "Listening..." : "Release to send")}
            {phase === "processing" && "Thinking..."}
            {phase === "speaking" && "Speaking..."}
          </div>

          {/* Tool results */}
          <VoiceToolResults
            artifacts={currentArtifacts}
            isGenerating={isToolRunning}
            toolName={currentToolName}
          />

          {/* Transcript */}
          <VoiceTranscript
            entries={transcript}
            currentUserSpeech={currentUserSpeech}
            isListening={voiceChat.isListening}
          />
        </div>

        {/* Error display */}
        {voiceChat.error && (
          <div
            style={{
              padding: "12px 20px",
              background: "rgba(239, 68, 68, 0.1)",
              borderTop: "1px solid rgba(239, 68, 68, 0.2)",
              color: "rgb(239, 68, 68)",
              fontSize: "13px",
              textAlign: "center",
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

// Helper functions
function cleanResponseForDisplay(text: string): string {
  return text
    .replace(/\[Executing [^\]]+\.\.\.\]\n*/g, "")
    .replace(/```json\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?\s*```/g, "")
    .replace(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .trim();
}

function cleanResponseForSpeech(text: string): string {
  let clean = cleanResponseForDisplay(text);
  // Remove markdown formatting
  clean = clean
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  return clean.slice(0, 500); // Limit length for TTS
}

function getToolStartMessage(toolName: string): string | null {
  switch (toolName) {
    case "generate_image":
      return "Generating image...";
    case "edit_image":
      return "Editing image...";
    case "generate_audio":
      return "Creating audio...";
    case "web_search":
      return "Searching the web...";
    case "image_to_3d":
      return "Creating 3D model...";
    case "analyze_image":
      return "Analyzing image...";
    case "glyph_motif":
      return "Creating glyph...";
    default:
      return null;
  }
}
