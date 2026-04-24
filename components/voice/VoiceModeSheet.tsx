"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { VoiceOrb, type OrbPhase } from "./VoiceOrb";
import { VoiceTranscript } from "./VoiceTranscript";
import { VoiceToolResults } from "./VoiceToolResult";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

export type VoiceMode = "push-to-talk" | "vad" | "toggle";

// Phrase detection regex: splits on sentence endings OR commas/semicolons for faster first utterance
// This allows TTS to start speaking sooner (on first phrase, not first sentence)
const PHRASE_ENDINGS = /[.!?。]\s+|\n\n|[,;:]\s+/;

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

  // Use mode from settings (allows switching between VAD and push-to-talk)
  const mode: VoiceMode = prefs.voice.mode;

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
  const autoStartedRef = useRef(false);

  // Track if we're in the middle of a conversation turn (waiting for AI response)
  const isProcessingRef = useRef(false);

  // Voice chat hook. If a parent surface provides a VoiceSessionProvider —
  // e.g. fullscreen voice mode opened from inside the Live tab — reuse its
  // runtime so we don't open a second WebSocket.
  const sharedVoiceSession = useOptionalVoiceSession();
  const ownVoiceChat = useVoiceChat({
    enabled: !sharedVoiceSession,
    ttsEngine: prefs.voice.ttsEngine,
    silenceTimeout: prefs.voice.silenceTimeoutMs,
    silenceThreshold: prefs.voice.silenceThreshold,
    onTranscript: (text) => {
      setCurrentUserSpeech(text);
    },
    onAutoSend: (text) => {
      handleUserUtterance(text);
    },
    onListeningStopped: () => {
      // Auto-restart listening in continuous voice mode
      console.log("[VoiceMode] onListeningStopped called, isOpen:", isOpen, "isProcessing:", isProcessingRef.current);
      if (isOpen) {
        // Small delay to let any state settle
        setTimeout(() => {
          if (isOpen && !isProcessingRef.current && !voiceChat.isListening) {
            console.log("[VoiceMode] Auto-restarting listening from onListeningStopped");
            voiceChat.startListening();
            setPhase("listening");
          }
        }, 200);
      }
    },
  });
  const voiceChat = sharedVoiceSession?.voiceChat ?? ownVoiceChat;

  // Mirror the shared session's transcript into this sheet when a parent owns
  // the runtime. These effects are no-ops when voiceChat is ours.
  const sharedPartial = sharedVoiceSession?.transcriptPartial ?? "";
  const sharedFinal = sharedVoiceSession?.transcriptFinal ?? "";
  useEffect(() => {
    if (!sharedVoiceSession) return;
    if (sharedPartial) setCurrentUserSpeech(sharedPartial);
  }, [sharedVoiceSession, sharedPartial]);

  // Auto-start listening when sheet opens (always continuous)
  useEffect(() => {
    if (isOpen && voiceChat.voiceApiStatus === "connected" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      console.log("[VoiceMode] Auto-starting listening on open");
      // Small delay to let the UI render
      const timer = setTimeout(() => {
        voiceChat.startListening();
        setPhase("listening");
      }, 300);
      return () => clearTimeout(timer);
    }

    if (!isOpen) {
      autoStartedRef.current = false;
    }
  }, [isOpen, voiceChat.voiceApiStatus]);

  // Safety net: ensure we're always listening when open and not processing/speaking
  useEffect(() => {
    if (!isOpen) return;
    
    const checkAndRestartListening = () => {
      const shouldListen = isOpen && 
          voiceChat.voiceApiStatus === "connected" && 
          !voiceChat.isListening && 
          !voiceChat.isSpeaking &&
          !voiceChat.isProcessingSTT;
      
      if (shouldListen) {
        console.log("[VoiceMode] Safety net: restarting listening");
        isProcessingRef.current = false; // Reset just in case
        voiceChat.startListening();
        setPhase("listening");
      }
    };
    
    // Check frequently
    const interval = setInterval(checkAndRestartListening, 500);
    return () => clearInterval(interval);
  }, [isOpen, voiceChat.voiceApiStatus, voiceChat.isListening, voiceChat.isSpeaking, voiceChat.isProcessingSTT]);

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
      } catch (err) {
        console.warn("[VoiceModeSheet] Failed to parse SSE event:", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [isOpen, threadId]);

  // Handle user utterance - send to chat API with streaming TTS
  const handleUserUtterance = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Mark that we're processing (prevents auto-restart of listening)
      isProcessingRef.current = true;
      
      setPhase("processing");
      setCurrentUserSpeech("");
      setCurrentArtifacts([]);

      // Play filler immediately while waiting for LLM
      voiceChat.playFiller();

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
        let sentenceBuffer = ""; // Buffer for accumulating text until sentence boundary

        // Streaming TTS: queue sentences as they complete
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullResponse += chunk;
          sentenceBuffer += chunk;

          // Look for completed sentences in the buffer
          let match;
          while ((match = sentenceBuffer.match(PHRASE_ENDINGS))) {
            const cutOff = match.index! + match[0].length;
            const textToSpeak = sentenceBuffer.slice(0, cutOff).trim();

            if (textToSpeak) {
              // Queue this sentence for TTS (non-blocking)
              const cleanedText = cleanResponseForSpeech(textToSpeak);
              if (cleanedText) {
                setPhase("speaking");
                voiceChat.queueSpeech(cleanedText);
              }
            }

            // Remove spoken sentence from buffer
            sentenceBuffer = sentenceBuffer.slice(cutOff);
          }

          // Update transcript with streaming response
          setAssistantResponse(fullResponse);
          setTranscript((prev) =>
            prev.map((entry) =>
              entry.id === assistantId
                ? { ...entry, content: cleanResponseForDisplay(fullResponse) }
                : entry
            )
          );
        }

        // Speak any remaining text in buffer (incomplete sentence at end)
        if (sentenceBuffer.trim()) {
          const cleanedText = cleanResponseForSpeech(sentenceBuffer.trim());
          if (cleanedText) {
            voiceChat.queueSpeech(cleanedText);
          }
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

        // Wait for ALL queued audio to finish before restarting VAD
        console.log("[VoiceMode] Waiting for speech to end...");
        await voiceChat.waitForSpeechEnd();
        console.log("[VoiceMode] Speech ended, restarting listening...");

        // Ready for next turn - allow auto-restart
        isProcessingRef.current = false;
        setPhase("idle");
        setAssistantResponse("");

        // Auto-restart listening after response - always in voice mode
        if (isOpen) {
          console.log("[VoiceMode] Auto-restarting listening");
          voiceChat.startListening();
          setPhase("listening");
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
        
        // Allow auto-restart on error too
        isProcessingRef.current = false;
        setPhase("idle");

        // Resume listening on error - always in voice mode
        if (isOpen) {
          console.log("[VoiceMode] Restarting listening after error");
          voiceChat.startListening();
          setPhase("listening");
        }
      }
    },
    [selectedModel, threadId, mode, isOpen, voiceChat, onMessageSent]
  );

  // Drive conversation turns from the shared session's final transcript when
  // a parent owns the runtime. (No-op when voiceChat is ours.)
  useEffect(() => {
    if (!sharedVoiceSession) return;
    const text = sharedFinal.trim();
    if (text) handleUserUtterance(text);
  }, [sharedVoiceSession, sharedFinal, handleUserUtterance]);

  // Handle mic button interaction (barge-in support)
  const handleMicPress = useCallback(() => {
    // Barge-in: stop speaking AND clear queue if assistant is talking
    if (voiceChat.isSpeaking) {
      voiceChat.stopSpeaking();
      voiceChat.clearQueue();
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
    voiceChat.clearQueue();
    abortControllerRef.current?.abort();
    setPhase("idle");
    setCurrentUserSpeech("");
    setAssistantResponse("");
    autoStartedRef.current = false;
    onClose();
  }, [voiceChat, onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
      // Space bar for push-to-talk
      if (e.code === "Space" && mode === "push-to-talk" && !e.repeat) {
        e.preventDefault();
        handleMicPress();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && mode === "push-to-talk") {
        e.preventDefault();
        handleMicRelease();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isOpen, handleClose, handleMicPress, handleMicRelease, mode]);

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
            {/* Mode toggle pill */}
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

            {/* Close button */}
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

        {/* Main content: orb center, transcript below, controls at bottom */}
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
          {/* Orb area - centered */}
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
                audioLevel={voiceChat.isListening ? voiceChat.audioLevel : voiceChat.isSpeaking ? 0.3 : 0}
                size={80}
              />
            </div>

            {/* Phase indicator */}
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

          {/* Tool results */}
          <VoiceToolResults
            artifacts={currentArtifacts}
            isGenerating={isToolRunning}
            toolName={currentToolName}
          />

          {/* Transcript - takes remaining space */}
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
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "code block")
    .replace(/\n{2,}/g, ". "); // Replace multiple newlines with pause

  // Don't return if it's just whitespace or too short
  clean = clean.trim();
  if (clean.length < 2) return "";

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
