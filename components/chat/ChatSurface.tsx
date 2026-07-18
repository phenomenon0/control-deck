"use client";

/**
 * ChatSurface — orchestrator for the redesigned agent chat surface
 *
 * Replaces ChatPaneV2 (SURFACE.md §5.1) by composing Phase 1-4 components:
 *   - ChatSurfaceLayout (render assembly: header, timeline, strip, composer)
 *   - ChatTimeline (segment list with scroll management)
 *   - StatusStrip (persistent run status indicator)
 *   - ChatComposer (context-aware input composer)
 *   - ChatSurfaceHeader / ChatControlTower (surface-variant chrome)
 *
 * Phase 4: Uses useAgentRun directly for SSE consumption — no bridge layer.
 * The hook consumes the SSE event stream from POST /api/chat and drives the
 * timeline + run state machine. Thread management and message persistence
 * are handled here in the orchestrator; focused logic lives in sibling
 * hooks (ChatVoiceController, ChatSubmitController, ChatKeyboardShortcuts,
 * ChatHistorySync, ChatInspectorSync, ChatCanvasAutoOpen, ChatAutoTTS).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useFileUploads } from "@/lib/hooks/useFileUploads";
import { VoiceSessionProvider } from "@/lib/voice/VoiceSessionContext";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import { useRunController } from "@/lib/hooks/useRunController";
import type { InterruptRequest } from "@/lib/hooks/useAgentRun";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import { useCommands } from "@/lib/hooks/useCommands";
import { subscribeChatPrefill } from "@/lib/messages/chatPrefill";
import { shouldMoveFocusTo } from "@/lib/dom/editable";
import { ChatSurfaceLayout } from "@/components/chat/ChatSurfaceLayout";
import { useChatHistorySync } from "@/components/chat/ChatHistorySync";
import { useChatVoiceController } from "@/components/chat/ChatVoiceController";
import { useChatInspectorSync } from "@/components/chat/ChatInspectorSync";
import { useChatCanvasAutoOpen } from "@/components/chat/ChatCanvasAutoOpen";
import { useChatAutoTTS } from "@/components/chat/ChatAutoTTS";
import { useChatKeyboardShortcuts } from "@/components/chat/ChatKeyboardShortcuts";
import {
  useChatSubmitController,
  type SubmitOrigin,
  type VoiceSubmitOrigin,
} from "@/components/chat/ChatSubmitController";
import type { AgentActivitySegment, ActivityStep, TimelineSegment } from "@/lib/types/agentRun";

interface ChatSurfaceProps {
  voiceSubmitOrigin?: VoiceSubmitOrigin;
}

function collectActivitySteps(
  segments: TimelineSegment[],
): ActivityStep[] {
  return segments
    .filter((segment): segment is AgentActivitySegment => segment.type === "agent-activity")
    .flatMap((segment) => segment.steps);
}

export default function ChatSurface({ voiceSubmitOrigin = "voice-dictation" }: ChatSurfaceProps = {}) {
  // ---------------------------------------------------------------------------
  // External hooks
  // ---------------------------------------------------------------------------
  const { prefs } = useDeckSettings();
  const dock = useOptionalAudioDock();
  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------
  const {
    threads, activeThreadId, messages, messagesLoading, setMessages,
    effectiveThreadId, fallbackThreadId,
    setActiveThreadId, selectThread, deleteThread,
    setThreads, resetFallbackThreadId,
  } = useThreadManager();

  // ---------------------------------------------------------------------------
  // File uploads
  // ---------------------------------------------------------------------------
  const {
    pendingUploads, setPendingUploads, uploadTrayOpen, setUploadTrayOpen,
    handleFileUpload, handleDrop, fileInputRef, clearUploads, isUploading,
  } = useFileUploads({ activeThreadId, fallbackThreadId, setActiveThreadId, setThreads });

  // ---------------------------------------------------------------------------
  // Local state & refs
  // ---------------------------------------------------------------------------
  const [inputValue, setInputValue] = useState("");
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [pendingInterrupt, setPendingInterrupt] = useState<InterruptRequest | null>(null);
  const selectedModel = prefs.model;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendMessageRef = useRef<(text: string, origin?: SubmitOrigin) => void>(() => {});
  const directSubmitRef = useRef<{ text: string; origin: SubmitOrigin } | null>(null);
  const voiceReplyMessageIdsRef = useRef<Set<string>>(new Set());
  const queueComposerFocus = useCallback((delay = 0) => {
    window.setTimeout(() => {
      if (shouldMoveFocusTo(inputRef.current)) {
        inputRef.current?.focus();
      }
    }, delay);
  }, []);

  // Pick up cross-surface prefill requests (e.g. the BrowserPane
  // "Send to chat" button). The helper handles BroadcastChannel + the
  // localStorage fallback so this file only cares about what to do
  // with an incoming payload.
  useEffect(() => {
    return subscribeChatPrefill((msg) => {
      const snippet =
        msg.text ?? (msg.url ? `${msg.title ? `${msg.title}\n` : ""}${msg.url}` : "");
      if (!snippet) return;
      setInputValue((prev) => (prev ? `${prev.trimEnd()}\n\n${snippet}` : snippet));
      queueComposerFocus(0);
    });
  }, [queueComposerFocus]);

  // ---------------------------------------------------------------------------
  // Agent Run — unified SSE consumer (replaces useSendMessage + useSSE)
  //
  // One run controller owns the active run id and cancellation for both the
  // chat run (useAgentRun) and the voice session below, so stop() and
  // voice interrupt() can never double-POST a run cancel.
  // ---------------------------------------------------------------------------
  const runController = useRunController();
  const agentRun = useAgentRun({
    controller: runController,
    onInterrupt: useCallback((req: InterruptRequest) => {
      setPendingInterrupt(req);
    }, []),
    onInterruptResolved: useCallback(() => {
      setPendingInterrupt(null);
    }, []),
  });

  const { state: agentState, dispatch: agentDispatch, isRunning } = agentRun;
  const { runState, segments } = agentState;
  const isStreaming = runState.phase === "streaming" || runState.phase === "executing";

  // ---------------------------------------------------------------------------
  // Voice chat (session ownership + transcript plumbing)
  // ---------------------------------------------------------------------------
  const { voiceSession, voiceChat } = useChatVoiceController({
    voiceEnabled: prefs.voice.enabled,
    voiceModeOpen,
    inputValue,
    setInputValue,
    runController,
    sendMessageRef,
  });

  // ---------------------------------------------------------------------------
  // Inspector sync (SURFACE.md §5.4 — single update replaces 6 push effects)
  // ---------------------------------------------------------------------------
  useChatInspectorSync({
    activeThreadId,
    selectedModel,
    isRunning,
    messages,
    segments,
    resolvedModel: agentRun.state.resolvedModel,
  });

  // ---------------------------------------------------------------------------
  // Canvas auto-open: open artifacts in canvas when created during a run
  // ---------------------------------------------------------------------------
  useChatCanvasAutoOpen({ segments, isRunning, effectiveThreadId });

  // Clean up local state on thread switch (uploads, input focus)
  // Replaces the side-effects that were previously in handleNewThread/handleSelectThread
  const prevThreadRef = useRef(activeThreadId);
  useEffect(() => {
    if (prevThreadRef.current !== activeThreadId) {
      prevThreadRef.current = activeThreadId;
      setPendingUploads([]);
      queueComposerFocus(100);
    }
  }, [activeThreadId, queueComposerFocus, setPendingUploads]);

  // ---------------------------------------------------------------------------
  // Elapsed time for StatusStrip
  // ---------------------------------------------------------------------------
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isRunning) {
      setElapsedMs(0);
      return;
    }
    const startedAt = "startedAt" in runState ? (runState as { startedAt: number }).startedAt : Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 500);
    return () => clearInterval(interval);
  }, [isRunning, runState]);

  // ---------------------------------------------------------------------------
  // Load history: convert persisted messages → segments on thread change
  // ---------------------------------------------------------------------------
  useChatHistorySync({ messages, effectiveThreadId, agentDispatch });

  // ---------------------------------------------------------------------------
  // Reactive thread title update from RunFinished event (SURFACE.md §6.2)
  // Replaces the old setTimeout polling pattern with event-driven updates
  // ---------------------------------------------------------------------------
  const threadTitle = agentState.threadTitle;
  useEffect(() => {
    if (!threadTitle || !activeThreadId) return;
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThreadId ? { ...t, title: threadTitle } : t
      )
    );
  }, [threadTitle, activeThreadId, setThreads]);

  // ---------------------------------------------------------------------------
  // Auto-TTS for voice-origin replies
  // ---------------------------------------------------------------------------
  useChatAutoTTS({
    voiceEnabled: prefs.voice.enabled,
    isRunning,
    messages,
    voiceChat,
    voiceSession,
    voiceReplyMessageIdsRef,
    setSpeakingMessageId,
  });

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (BEHAVIOR.md §5)
  // ---------------------------------------------------------------------------
  useChatKeyboardShortcuts({
    uploadTrayOpen,
    setUploadTrayOpen,
    voiceChat,
    voicePrefs: prefs.voice,
    inputValue,
    setInputValue,
    setVoiceModeOpen,
    inputRef,
    activeThreadId,
    threads,
    selectThread,
    deleteThread,
    resetFallbackThreadId,
    setActiveThreadId,
    setMessages,
  });

  // ---------------------------------------------------------------------------
  // Submit pipeline (send + persistence + live voice reply + retry/edit/stop)
  // ---------------------------------------------------------------------------
  const { onSubmit, handleStop, handleRetry, handleEditLastMessage } = useChatSubmitController({
    inputValue,
    setInputValue,
    pendingUploads,
    clearUploads,
    isRunning,
    isUploading,
    messagesLoading,
    activeThreadId,
    fallbackThreadId,
    setActiveThreadId,
    setThreads,
    messages,
    setMessages,
    selectedModel,
    providerId: prefs.providerId,
    systemPrompt: prefs.systemPrompt,
    localModelPreset: prefs.localModelPreset,
    agentRun,
    voiceSession,
    voiceChat,
    dockMode: dock?.mode,
    dockRouteId: dock?.routeId,
    directSubmitRef,
    sendMessageRef,
    voiceReplyMessageIdsRef,
    queueComposerFocus,
    setSpeakingMessageId,
  });

  // Contribute chat-specific commands to the palette while mounted.
  useCommands([
    {
      id: "chat.retry",
      label: "Retry last message",
      category: "Chat",
      scope: "/v2/chat",
      action: handleRetry,
    },
    {
      id: "chat.edit-last",
      label: "Edit last message",
      category: "Chat",
      scope: "/v2/chat",
      action: handleEditLastMessage,
    },
    {
      id: "chat.stop-speaking",
      label: "Stop TTS playback",
      category: "Chat",
      scope: "/v2/chat",
      action: () => voiceChat.stopSpeaking(),
    },
  ]);

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
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)
    : null;
  const chatTitle = activeThread?.title || "New thread";
  const chatSurface = prefs.chatSurface ?? "safe";
  const showContextRail = prefs.chatContextRail;
  const activitySteps = collectActivitySteps(segments);
  const toolCount = segments.reduce(
    (count, segment) => count + (segment.type === "agent-activity" ? segment.steps.length : 0),
    0
  );
  const artifactCount = segments.filter((segment) => segment.type === "artifact").length;
  const messageCount = messages.length;

  return (
    <VoiceSessionProvider session={voiceSession}>
    <ChatSurfaceLayout
      chatSurface={chatSurface}
      showContextRail={showContextRail}
      chatTitle={chatTitle}
      selectedModel={selectedModel}
      toolCount={toolCount}
      artifactCount={artifactCount}
      messageCount={messageCount}
      onDrop={handleDrop}
      runState={runState}
      isStreaming={isStreaming}
      elapsedMs={elapsedMs}
      activitySteps={activitySteps}
      segments={segments}
      onStop={handleStop}
      onRetry={handleRetry}
      fileInputRef={fileInputRef}
      onFileUpload={handleFileUpload}
      uploadTrayOpen={uploadTrayOpen}
      setUploadTrayOpen={setUploadTrayOpen}
      pendingUploads={pendingUploads}
      setPendingUploads={setPendingUploads}
      inputValue={inputValue}
      setInputValue={setInputValue}
      onSubmit={onSubmit}
      inputRef={inputRef}
      voiceChat={voiceChat}
      voiceEnabled={prefs.voice.enabled}
      voiceMode={prefs.voice.mode}
      voiceModeOpen={voiceModeOpen}
      setVoiceModeOpen={setVoiceModeOpen}
      onMicClick={handleMicClick}
      onMicRelease={handleMicRelease}
      onAttachClick={handleAttachClick}
      onRemoveUpload={handleRemoveUpload}
      onEditLastMessage={handleEditLastMessage}
      effectiveThreadId={effectiveThreadId}
      pendingInterrupt={pendingInterrupt}
      setPendingInterrupt={setPendingInterrupt}
    />
    </VoiceSessionProvider>
  );
}
