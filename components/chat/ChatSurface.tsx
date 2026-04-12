"use client";

/**
 * ChatSurface — orchestrator for the redesigned agent chat surface
 *
 * Replaces ChatPaneV2 (SURFACE.md §5.1) by composing Phase 1-3 components:
 *   - ChatTimeline (segment list with scroll management)
 *   - StatusStrip (persistent run status indicator)
 *   - ChatComposer (context-aware input composer)
 *
 * BRIDGE ARCHITECTURE: This version still uses the existing hooks (useThreads,
 * useSSE, useSendMessage) for backend communication. Two bridge functions
 * translate old hook state into the new type system:
 *   - deriveRunState()      → RunState discriminated union
 *   - messagesToSegments()  → TimelineSegment[] for the timeline
 *
 * Phase 4 (backend) will replace this bridge with direct SSE consumption
 * in useAgentRun, eliminating the translation layer.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useThreads } from "@/lib/hooks/useThreads";
import { useFileUploads } from "@/lib/hooks/useFileUploads";
import { useSSE } from "@/lib/hooks/useSSE";
import { useSendMessage } from "@/lib/hooks/useSendMessage";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useRightRailSlot } from "@/lib/hooks/useRightRail";
import { ThreadSidebar } from "@/components/chat/ThreadSidebar";
import { ChatTimeline } from "@/components/chat/ChatTimeline";
import { StatusStrip } from "@/components/chat/StatusStrip";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { UploadTray } from "@/components/chat/UploadTray";
import { VoiceModeSheet } from "@/components/voice/VoiceModeSheet";
import { InterruptDialog } from "@/components/chat/InterruptDialog";
import { setStoredThreads, type Thread } from "@/lib/chat/helpers";
import type { Artifact } from "@/components/chat/ArtifactRenderer";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { RunState, TimelineSegment } from "@/lib/types/agentRun";
import type { Message } from "@/lib/chat/helpers";

// =============================================================================
// Bridge: old hook state → RunState (BEHAVIOR.md §2)
// =============================================================================

function deriveRunState(
  isLoading: boolean,
  isThinking: boolean,
  isReasoning: boolean,
  toolCallStates: Map<string, ToolCallData>,
  runId: string | null,
  runStartedAt: number,
): RunState {
  if (!isLoading) return { phase: "idle" };

  const id = runId ?? "";

  // Check if any tool is actively running
  const runningTool = Array.from(toolCallStates.values()).find(
    (tc) => tc.status === "running"
  );
  if (runningTool) {
    return {
      phase: "executing",
      runId: id,
      toolCallId: runningTool.id,
      toolName: runningTool.name,
      startedAt: runningTool.startedAt ?? runStartedAt,
    };
  }

  // Thinking / reasoning phase
  if (isThinking || isReasoning) {
    return { phase: "thinking", runId: id, startedAt: runStartedAt };
  }

  // Default: streaming text
  return { phase: "streaming", runId: id, messageId: "", startedAt: runStartedAt };
}

// =============================================================================
// Bridge: Message[] + SSE state → TimelineSegment[]
// =============================================================================

/** Map ToolCallData.status (ToolStatus) to ActivityStep.status */
function mapToolStatus(status: string): "running" | "complete" | "error" {
  if (status === "error") return "error";
  if (status === "complete" || status === "success") return "complete";
  return "running";
}

function messagesToSegments(
  messages: Message[],
  isLoading: boolean,
  toolCallStates: Map<string, ToolCallData>,
  reasoningContent: string,
  isReasoning: boolean,
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let segCounter = 0;
  const nextId = () => `seg_bridge_${++segCounter}`;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isLast = i === messages.length - 1;
    const isLastAssistant = msg.role === "assistant" && isLast;

    if (msg.role === "user") {
      // Extract upload info from user artifacts (attached images)
      const uploads = msg.artifacts?.map((a) => ({
        id: a.id,
        name: a.name || "attachment",
        url: a.url,
      }));

      segments.push({
        id: nextId(),
        type: "user-message",
        timestamp: 0,
        content: msg.content,
        uploads: uploads?.length ? uploads : undefined,
      });
    } else if (msg.role === "assistant") {
      // For the LAST assistant message during an active run, interleave
      // reasoning and activity segments before the text.
      if (isLastAssistant && isLoading) {
        // Reasoning segment
        if (reasoningContent) {
          segments.push({
            id: nextId(),
            type: "agent-reasoning",
            timestamp: 0,
            content: reasoningContent,
            isStreaming: isReasoning,
          });
        }

        // Activity segment (grouped tool calls)
        if (toolCallStates.size > 0) {
          const steps = Array.from(toolCallStates.values()).map((tc) => ({
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.args as Record<string, unknown> | undefined,
            status: mapToolStatus(tc.status),
            result: tc.result
              ? {
                  success: tc.result.success ?? true,
                  message: tc.result.message,
                  error: tc.result.error,
                }
              : undefined,
            durationMs: tc.durationMs,
            startedAt: tc.startedAt ?? 0,
          }));
          segments.push({
            id: nextId(),
            type: "agent-activity",
            timestamp: 0,
            steps,
          });
        }
      }

      // Agent text message
      segments.push({
        id: nextId(),
        type: "agent-message",
        timestamp: 0,
        messageId: msg.id,
        content: msg.content || "",
        isStreaming: isLastAssistant && isLoading,
      });

      // Artifact segments (agent-generated work product)
      if (msg.artifacts && msg.artifacts.length > 0) {
        for (const artifact of msg.artifacts) {
          segments.push({
            id: nextId(),
            type: "artifact",
            timestamp: 0,
            artifact,
          });
        }
      }
    }
  }

  return segments;
}

// =============================================================================
// ChatSurface component
// =============================================================================

export default function ChatSurface() {
  // ---------------------------------------------------------------------------
  // External hooks (same as ChatPaneV2 — this is the bridge layer)
  // ---------------------------------------------------------------------------
  const { prefs, sidebarOpen, setSidebarOpen } = useDeckSettings();
  const canvas = useCanvas();

  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------
  const {
    threads, activeThreadId, messages, setMessages,
    threadGroups, effectiveThreadId, fallbackThreadId,
    setActiveThreadId, createThread, selectThread, deleteThread,
    setThreads,
  } = useThreads();

  // ---------------------------------------------------------------------------
  // File uploads
  // ---------------------------------------------------------------------------
  const {
    pendingUploads, setPendingUploads, uploadTrayOpen, setUploadTrayOpen,
    handleFileUpload, handleDrop, fileInputRef, clearUploads,
  } = useFileUploads({ activeThreadId, fallbackThreadId, setActiveThreadId, setThreads });

  // ---------------------------------------------------------------------------
  // SSE streaming
  // ---------------------------------------------------------------------------
  const onArtifactAttach = useCallback((artifact: Artifact) => {
    setMessages((prev) => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx]?.role === "assistant") {
        const existing = updated[lastIdx].artifacts || [];
        if (!existing.some((a) => a.id === artifact.id)) {
          updated[lastIdx] = { ...updated[lastIdx], artifacts: [...existing, artifact] };
        }
      }
      return updated;
    });
  }, [setMessages]);

  const {
    toolCallStates, isThinking, reasoningContent, isReasoning,
    currentPlan, currentProgress, currentCards, setCurrentCards,
    pendingInterrupt, setPendingInterrupt,
    currentRunIdRef, resetForNewRun,
  } = useSSE({ threadId: effectiveThreadId, canvas, onArtifactAttach });

  // ---------------------------------------------------------------------------
  // Local state & refs
  // ---------------------------------------------------------------------------
  const [inputValue, setInputValue] = useState("");
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const selectedModel = prefs.model;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  // Track when loading started for StatusStrip elapsed time
  const runStartedAtRef = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // Voice chat
  // ---------------------------------------------------------------------------
  const voiceChat = useVoiceChat({
    ttsEngine: prefs.voice.ttsEngine,
    silenceTimeout: prefs.voice.silenceTimeoutMs,
    silenceThreshold: prefs.voice.silenceThreshold,
    onTranscript: (text) => {
      if (prefs.voice.enabled) setInputValue(text);
    },
    onAutoSend: (text) => {
      if (prefs.voice.enabled && text.trim()) sendMessageRef.current(text);
    },
  });

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  const { sendMessage, isLoading, searchStatus, pendingTTSRef } = useSendMessage({
    activeThreadId, fallbackThreadId, messages, setMessages,
    setActiveThreadId, setThreads,
    currentRunIdRef, resetForNewRun, setCurrentCards,
    selectedModel,
    voiceEnabled: prefs.voice.enabled,
    readAloud: prefs.voice.readAloud,
    stopSpeaking: voiceChat.stopSpeaking,
    isSpeaking: voiceChat.isSpeaking,
    pendingUploads, clearUploads,
  });

  sendMessageRef.current = sendMessage;

  // ---------------------------------------------------------------------------
  // Right Rail sync (same as ChatPaneV2)
  // ---------------------------------------------------------------------------
  const rightRail = useRightRailSlot();

  useEffect(() => { rightRail.setThreadId(activeThreadId); }, [activeThreadId, rightRail]);
  useEffect(() => { rightRail.setModel(selectedModel); }, [selectedModel, rightRail]);
  useEffect(() => { rightRail.setIsLoading(isLoading); }, [isLoading, rightRail]);
  useEffect(() => { rightRail.setToolCalls(Array.from(toolCallStates.values())); }, [toolCallStates, rightRail]);
  useEffect(() => { rightRail.setArtifacts(messages.flatMap((m) => m.artifacts || [])); }, [messages, rightRail]);

  const sendMessageToInput = useCallback((text: string) => {
    setInputValue(text);
    inputRef.current?.focus();
  }, []);
  useEffect(() => { rightRail.setOnSendMessage(sendMessageToInput); }, [sendMessageToInput, rightRail]);

  // ---------------------------------------------------------------------------
  // Track run start time for elapsed display
  // ---------------------------------------------------------------------------
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (isLoading && !prevLoadingRef.current) {
      runStartedAtRef.current = Date.now();
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading]);

  // ---------------------------------------------------------------------------
  // Bridge: derive RunState and TimelineSegment[] from old hook state
  // ---------------------------------------------------------------------------
  const runState: RunState = useMemo(
    () =>
      deriveRunState(
        isLoading,
        isThinking,
        isReasoning,
        toolCallStates,
        currentRunIdRef.current,
        runStartedAtRef.current,
      ),
    [isLoading, isThinking, isReasoning, toolCallStates, currentRunIdRef]
  );

  const segments: TimelineSegment[] = useMemo(
    () =>
      messagesToSegments(
        messages,
        isLoading,
        toolCallStates,
        reasoningContent,
        isReasoning,
      ),
    [messages, isLoading, toolCallStates, reasoningContent, isReasoning]
  );

  const isStreaming = runState.phase === "streaming" || runState.phase === "executing";

  // Elapsed ms for StatusStrip
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isLoading || runStartedAtRef.current === 0) {
      setElapsedMs(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - runStartedAtRef.current);
    }, 500);
    return () => clearInterval(interval);
  }, [isLoading]);

  // ---------------------------------------------------------------------------
  // Effects: Auto-TTS, keyboard shortcuts
  // ---------------------------------------------------------------------------

  // Auto-TTS when assistant message completes
  useEffect(() => {
    if (!prefs.voice.enabled || !prefs.voice.readAloud || isLoading || voiceModeOpen) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.content) return;
    if (lastSpokenIdRef.current === lastMsg.id) return;
    if (pendingTTSRef.current === lastMsg.id) pendingTTSRef.current = null;

    lastSpokenIdRef.current = lastMsg.id;
    setSpeakingMessageId(lastMsg.id);

    const cleanContent = lastMsg.content
      .replace(/<tool[^>]*>[\s\S]*?<\/tool>/g, "")
      .replace(/```[\s\S]*?```/g, "code block")
      .replace(/\{"tool"[\s\S]*?\}/g, "")
      .trim();

    if (cleanContent) {
      voiceChat.speak(cleanContent).finally(() => setSpeakingMessageId(null));
    } else {
      setSpeakingMessageId(null);
    }
  }, [isLoading, messages, prefs.voice.enabled, prefs.voice.readAloud, voiceChat, voiceModeOpen, pendingTTSRef]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (uploadTrayOpen) setUploadTrayOpen(false);
        if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
        if (voiceChat.isListening) voiceChat.stopListening();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setVoiceModeOpen((prev) => !prev);
      }
      if (
        prefs.voice.enabled && prefs.voice.mode === "push-to-talk" &&
        e.code === "Space" && !e.repeat &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
        if (!voiceChat.isListening) voiceChat.startListening();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        prefs.voice.enabled && prefs.voice.mode === "push-to-talk" &&
        e.code === "Space" && voiceChat.isListening
      ) {
        e.preventDefault();
        voiceChat.stopListening();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [uploadTrayOpen, voiceChat, prefs.voice, setUploadTrayOpen]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleNewThread = () => {
    createThread();
    setPendingUploads([]);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSelectThread = (id: string) => {
    selectThread(id);
    setPendingUploads([]);
  };

  const handleDeleteThread = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteThread(id);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
    setInputValue("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleStop = useCallback(() => {
    // The old hooks don't expose a clean stop — we'd need the abort controller.
    // For now, this is a placeholder; Phase 4 will wire useAgentRun.stop().
    console.log("[ChatSurface] Stop requested");
  }, []);

  const handleMicClick = () => {
    if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
    if (prefs.voice.mode === "vad") {
      voiceChat.isListening ? voiceChat.stopListening() : voiceChat.startListening();
    } else {
      voiceChat.startListening();
    }
  };

  const handleMicRelease = () => {
    if (prefs.voice.mode === "push-to-talk" && voiceChat.isListening) voiceChat.stopListening();
  };

  const handleAttachClick = () => {
    if (pendingUploads.length > 0) setUploadTrayOpen(true);
    else fileInputRef.current?.click();
  };

  const handleRemoveUpload = useCallback(
    (id: string) => setPendingUploads((prev) => prev.filter((u) => u.id !== id)),
    [setPendingUploads]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        background: "var(--bg-primary)",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Left Sidebar */}
      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        threadGroups={threadGroups}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={setSidebarOpen}
        onNewThread={handleNewThread}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
      />

      {/* Main chat column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = e.target.files;
            if (files) {
              for (const file of files) handleFileUpload(file);
            }
            e.target.value = "";
          }}
        />

        <UploadTray
          isOpen={uploadTrayOpen}
          onClose={() => setUploadTrayOpen(false)}
          uploads={pendingUploads}
          onRemove={(id) => setPendingUploads((prev) => prev.filter((u) => u.id !== id))}
          onAddMore={() => fileInputRef.current?.click()}
        />

        {/* Timeline — replaces the message list */}
        <ChatTimeline
          segments={segments}
          isStreaming={isStreaming}
          emptyState={
            <div style={{ textAlign: "center", paddingBottom: 32 }}>
              <p style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 400, margin: 0 }}>
                What&apos;s on your mind?
              </p>
              {prefs.voice.enabled && (
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8, opacity: 0.6 }}>
                  {prefs.voice.mode === "push-to-talk" ? "Hold spacebar to speak" : "Click mic to talk"}
                </p>
              )}
            </div>
          }
        />

        {/* Status strip — replaces scattered status indicators */}
        <StatusStrip
          runState={runState}
          onStop={handleStop}
          elapsedMs={elapsedMs}
        />

        {/* Composer — replaces ChatInput */}
        <ChatComposer
          runState={runState}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSubmit={onSubmit}
          onStop={handleStop}
          model={selectedModel}
          voiceChat={voiceChat}
          voiceEnabled={prefs.voice.enabled}
          voiceMode={prefs.voice.mode}
          onVoiceModeOpen={() => setVoiceModeOpen(true)}
          onMicClick={handleMicClick}
          onMicRelease={handleMicRelease}
          pendingUploads={pendingUploads}
          onAttachClick={handleAttachClick}
          onRemoveUpload={handleRemoveUpload}
          fileInputRef={fileInputRef}
          inputRef={inputRef}
        />
      </div>

      {/* Voice Mode Sheet */}
      <VoiceModeSheet
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        threadId={effectiveThreadId}
        selectedModel={selectedModel}
        onMessageSent={(userMessage, assistantMessage) => {
          const userMsgId = crypto.randomUUID();
          const assistantMsgId = crypto.randomUUID();
          setMessages((prev) => [
            ...prev,
            { id: userMsgId, role: "user", content: userMessage },
            { id: assistantMsgId, role: "assistant", content: assistantMessage },
          ]);
          const tid = effectiveThreadId;
          if (!activeThreadId) {
            const newThread: Thread = {
              id: tid,
              title: userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : ""),
              lastMessageAt: new Date().toISOString(),
            };
            setThreads((prev) => {
              const updated = [newThread, ...prev];
              setStoredThreads(updated);
              return updated;
            });
            setActiveThreadId(tid);
          }
          fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", threadId: tid, id: userMsgId, role: "user", content: userMessage }),
          }).catch((err) => console.error("[ChatSurface] Failed to save voice user message:", err));
          fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", threadId: tid, id: assistantMsgId, role: "assistant", content: assistantMessage }),
          }).catch((err) => console.error("[ChatSurface] Failed to save voice assistant message:", err));
        }}
      />

      {/* Agent-GO Interrupt Dialog */}
      <InterruptDialog
        request={pendingInterrupt}
        onApprove={() => {
          console.log("[ChatSurface] Interrupt approved");
          setPendingInterrupt(null);
        }}
        onReject={(reason) => {
          console.log("[ChatSurface] Interrupt rejected:", reason);
          setPendingInterrupt(null);
        }}
      />
    </div>
  );
}
