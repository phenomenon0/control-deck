"use client";

/**
 * ChatSurface — orchestrator for the redesigned agent chat surface
 *
 * Replaces ChatPaneV2 (SURFACE.md §5.1) by composing Phase 1-3 components:
 *   - ChatTimeline (segment list with scroll management)
 *   - StatusStrip (persistent run status indicator)
 *   - ChatComposer (context-aware input composer)
 *
 * Phase 4: Uses useAgentRun directly for SSE consumption — no bridge layer.
 * The hook consumes the SSE event stream from POST /api/chat and drives the
 * timeline + run state machine. Thread management and message persistence
 * are handled here in the orchestrator.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useFileUploads } from "@/lib/hooks/useFileUploads";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useChatInspectorUpdate } from "@/lib/hooks/useChatInspector";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import type { InterruptRequest } from "@/lib/hooks/useAgentRun";
import { ChatTimeline } from "@/components/chat/ChatTimeline";
import { StatusStrip } from "@/components/chat/StatusStrip";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { UploadTray } from "@/components/chat/UploadTray";
import { VoiceModeSheet } from "@/components/voice/VoiceModeSheet";
import { InterruptDialog } from "@/components/chat/InterruptDialog";
import { setStoredThreads, type Thread, type Message } from "@/lib/chat/helpers";
import { useCanvas } from "@/lib/hooks/useCanvas";
import type { Artifact } from "@/components/chat/ArtifactRenderer";
import type { AgentActivitySegment, ActivityStep, ArtifactSegment } from "@/lib/types/agentRun";

/** Truncate string values in tool args to keep metadata compact */
function truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = typeof value === "string" && value.length > 200
      ? value.slice(0, 200) + "..."
      : value;
  }
  return result;
}

/** Extract tool call summaries from segments for persistence */
function extractToolSummaries(segments: import("@/lib/types/agentRun").TimelineSegment[]) {
  return segments
    .filter((s): s is AgentActivitySegment => s.type === "agent-activity")
    .flatMap((s) => s.steps)
    .filter((step) => step.status !== "running") // Only persist completed/errored steps
    .map((step) => ({
      toolCallId: step.toolCallId,
      toolName: step.toolName,
      args: step.args ? truncateArgs(step.args) : undefined,
      status: step.status as "complete" | "error",
      durationMs: step.durationMs,
      success: step.result?.success ?? true,
      error: step.result?.error,
    }));
}

export default function ChatSurface() {
  // ---------------------------------------------------------------------------
  // External hooks
  // ---------------------------------------------------------------------------
  const { prefs } = useDeckSettings();
  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------
  const {
    threads, activeThreadId, messages, setMessages,
    effectiveThreadId, fallbackThreadId,
    setActiveThreadId, selectThread, deleteThread,
    setThreads, resetFallbackThreadId,
  } = useThreadManager();

  // ---------------------------------------------------------------------------
  // File uploads
  // ---------------------------------------------------------------------------
  const {
    pendingUploads, setPendingUploads, uploadTrayOpen, setUploadTrayOpen,
    handleFileUpload, handleDrop, fileInputRef, clearUploads,
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
  const lastSpokenIdRef = useRef<string | null>(null);
  const sendMessageRef = useRef<(text: string) => void>(() => {});
  const pendingTTSRef = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // Agent Run — unified SSE consumer (replaces useSendMessage + useSSE)
  // ---------------------------------------------------------------------------
  const agentRun = useAgentRun({
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
  // Inspector sync (SURFACE.md §5.4 — single update replaces 6 push effects)
  // ---------------------------------------------------------------------------
  const updateInspector = useChatInspectorUpdate();

  useEffect(() => {
    const toolCalls = segments
      .filter((s) => s.type === "agent-activity")
      .flatMap((s) => (s as import("@/lib/types/agentRun").AgentActivitySegment).steps)
      .map((step) => ({
        id: step.toolCallId,
        name: step.toolName,
        status: step.status === "running" ? "running" as const : step.status === "complete" ? "complete" as const : "error" as const,
        args: step.args,
        result: step.result ? { success: step.result.success, message: step.result.message, error: step.result.error } : undefined,
        durationMs: step.durationMs,
        startedAt: step.startedAt,
      }));
    updateInspector({
      threadId: activeThreadId,
      model: selectedModel,
      isLoading: isRunning,
      artifacts: messages.flatMap((m) => m.artifacts || []),
      toolCalls,
    });
  }, [activeThreadId, selectedModel, isRunning, messages, segments, updateInspector]);

  // ---------------------------------------------------------------------------
  // Canvas auto-open: open artifacts in canvas when created during a run
  // (Restores behavior lost in iteration 6 when useSSE was replaced by useAgentRun)
  // ---------------------------------------------------------------------------
  const canvas = useCanvas();
  const openedArtifactIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const artifactSegments = segments.filter(
      (s): s is ArtifactSegment => s.type === "artifact"
    );
    for (const seg of artifactSegments) {
      const artifactId = seg.artifact.id;
      if (openedArtifactIdsRef.current.has(artifactId)) continue;
      openedArtifactIdsRef.current.add(artifactId);

      // Only auto-open for code execution results and images during a live run
      if (!isRunning) continue;
      canvas.openArtifact({
        id: artifactId,
        url: seg.artifact.url,
        name: seg.artifact.name,
        mimeType: seg.artifact.mimeType,
      });
    }
  }, [segments, isRunning, canvas]);

  // Clear tracked artifact IDs when switching threads
  useEffect(() => {
    openedArtifactIdsRef.current.clear();
  }, [effectiveThreadId]);

  // Clean up local state on thread switch (uploads, input focus)
  // Replaces the side-effects that were previously in handleNewThread/handleSelectThread
  const prevThreadRef = useRef(activeThreadId);
  useEffect(() => {
    if (prevThreadRef.current !== activeThreadId) {
      prevThreadRef.current = activeThreadId;
      setPendingUploads([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [activeThreadId, setPendingUploads]);

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
  useEffect(() => {
    if (!messages.length) {
      agentDispatch({ type: "LOAD_HISTORY", segments: [] });
      return;
    }
    const historySegments: import("@/lib/types/agentRun").TimelineSegment[] = [];
    let segCounter = 0;
    const nextId = () => `seg_hist_${++segCounter}`;

    for (const msg of messages) {
      if (msg.role === "user") {
        const uploads = msg.artifacts?.map((a) => ({
          id: a.id,
          name: a.name || "attachment",
          url: a.url,
        }));
        historySegments.push({
          id: nextId(),
          type: "user-message",
          timestamp: 0,
          content: msg.content,
          uploads: uploads?.length ? uploads : undefined,
        });
      } else if (msg.role === "assistant") {
        // Reconstruct tool activity from persisted metadata (before text)
        const toolCalls = msg.metadata?.toolCalls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          historySegments.push({
            id: nextId(),
            type: "agent-activity",
            timestamp: 0,
            steps: toolCalls.map((tc: { toolCallId?: string; toolName: string; args?: Record<string, unknown>; status?: string; durationMs?: number; success?: boolean; error?: string }) => ({
              toolCallId: tc.toolCallId || crypto.randomUUID(),
              toolName: tc.toolName,
              args: tc.args,
              status: (tc.status === "error" ? "error" : "complete") as ActivityStep["status"],
              result: {
                success: tc.success ?? true,
                error: tc.error,
              },
              durationMs: tc.durationMs,
              startedAt: 0,
            })),
          });
        }
        historySegments.push({
          id: nextId(),
          type: "agent-message",
          timestamp: 0,
          messageId: msg.id,
          content: msg.content || "",
          isStreaming: false,
        });
        if (msg.artifacts?.length) {
          for (const artifact of msg.artifacts) {
            historySegments.push({
              id: nextId(),
              type: "artifact",
              timestamp: 0,
              artifact,
            });
          }
        }
      }
    }
    agentDispatch({ type: "LOAD_HISTORY", segments: historySegments });
  }, [effectiveThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Reactive thread title update from RunFinished event (SURFACE.md §6.2)
  // Replaces the old setTimeout polling pattern with event-driven updates
  // ---------------------------------------------------------------------------
  const threadTitle = agentState.threadTitle;
  useEffect(() => {
    if (!threadTitle || !activeThreadId) return;
    setThreads((prev) => {
      const updated = prev.map((t) =>
        t.id === activeThreadId ? { ...t, title: threadTitle } : t
      );
      setStoredThreads(updated);
      return updated;
    });
  }, [threadTitle, activeThreadId, setThreads]);

  // ---------------------------------------------------------------------------
  // Handlers (before effects so keyboard shortcuts can reference them)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Effects: Auto-TTS, keyboard shortcuts
  // ---------------------------------------------------------------------------

  // Auto-TTS when assistant message completes
  useEffect(() => {
    if (!prefs.voice.enabled || !prefs.voice.readAloud || isRunning || voiceModeOpen) return;
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
  }, [isRunning, messages, prefs.voice.enabled, prefs.voice.readAloud, voiceChat, voiceModeOpen]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (BEHAVIOR.md §5)
  // Priority: Modal (100) > Floating panel (50) > Composer (20) > Nav (10) > Global (0)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      // --- Priority 100: Escape (modals, overlays) ---
      if (e.key === "Escape") {
        if (uploadTrayOpen) { setUploadTrayOpen(false); return; }
        if (voiceChat.isSpeaking) { voiceChat.stopSpeaking(); return; }
        if (voiceChat.isListening) { voiceChat.stopListening(); return; }
        // Composer escape: clear text first, then blur (§5.2)
        if (inInput && inputRef.current) {
          if (inputValue.trim()) {
            setInputValue("");
          } else {
            inputRef.current.blur();
          }
          return;
        }
      }

      // --- Priority 0: Global shortcuts ---

      // Cmd+Shift+V — toggle voice mode
      if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setVoiceModeOpen((prev) => !prev);
        return;
      }

      // --- Priority 10: Navigation shortcuts (§5.3) ---

      // Cmd+N — new thread
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        resetFallbackThreadId();
        setActiveThreadId(null);
        setMessages([]);
        return;
      }

      // Cmd+W — close current thread (with native confirm)
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeThreadId) {
          const thread = threads.find((t) => t.id === activeThreadId);
          const title = thread?.title || "this thread";
          if (window.confirm(`Delete "${title}"?`)) {
            // Simulate a MouseEvent for the handler signature
            deleteThread(activeThreadId);
          }
        }
        return;
      }

      // Cmd+[ — previous thread, Cmd+] — next thread
      if (mod && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        if (threads.length === 0) return;
        const currentIdx = activeThreadId
          ? threads.findIndex((t) => t.id === activeThreadId)
          : -1;
        let nextIdx: number;
        if (e.key === "[") {
          // Previous (older) — move down the list
          nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, threads.length - 1);
        } else {
          // Next (newer) — move up the list
          nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
        }
        if (nextIdx >= 0 && nextIdx < threads.length) {
          selectThread(threads[nextIdx].id);
        }
        return;
      }

      // --- Priority 10: Push-to-talk (Space when not in input) ---
      if (
        prefs.voice.enabled && prefs.voice.mode === "push-to-talk" &&
        e.code === "Space" && !e.repeat && !inInput
      ) {
        e.preventDefault();
        if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
        if (!voiceChat.isListening) voiceChat.startListening();
        return;
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
  }, [
    uploadTrayOpen, voiceChat, prefs.voice, setUploadTrayOpen,
    inputValue, activeThreadId, threads,
    selectThread, deleteThread, resetFallbackThreadId, setActiveThreadId, setMessages,
  ]);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text && pendingUploads.length === 0) return;
    if (isRunning) return;

    // Stop any ongoing speech
    if (voiceChat.isSpeaking) voiceChat.stopSpeaking();

    // Resolve thread ID (create if needed)
    let threadId = activeThreadId;
    if (!threadId) {
      threadId = fallbackThreadId;
      const newThread: Thread = {
        id: threadId,
        title: text.slice(0, 50) + (text.length > 50 ? "..." : ""),
        lastMessageAt: new Date().toISOString(),
      };
      setThreads((prev) => {
        const updated = [newThread, ...prev];
        setStoredThreads(updated);
        return updated;
      });
      setActiveThreadId(threadId);
    }

    // Build message content with upload refs
    let messageContent = text;
    const uploadIds = pendingUploads.map((u) => u.id);
    if (pendingUploads.length > 0) {
      const uploadRefs = pendingUploads.map((u) => `[Image: ${u.name}] (image_id: ${u.id})`).join("\n");
      messageContent = uploadRefs + (text ? `\n\n${text}` : "");
    }

    // Create user message for persistence
    const userMessageId = crypto.randomUUID();
    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: messageContent,
      artifacts: pendingUploads.map((u) => ({
        id: u.id,
        url: u.url,
        name: u.name,
        mimeType: u.mimeType,
      })),
    };

    // Update local messages state
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Clear input + uploads
    setInputValue("");
    clearUploads();

    // Persist user message to DB (include upload artifacts as metadata)
    fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "message",
        threadId,
        id: userMessageId,
        role: "user",
        content: messageContent,
        metadata: pendingUploads.length > 0
          ? { uploads: pendingUploads.map((u) => ({ id: u.id, url: u.url, name: u.name, mimeType: u.mimeType })) }
          : undefined,
      }),
    }).catch((err) => console.error("[ChatSurface] Failed to save user message:", err));

    // TTS tracking
    const assistantId = crypto.randomUUID();
    if (prefs.voice.enabled && prefs.voice.readAloud) {
      pendingTTSRef.current = assistantId;
    }

    // Build API messages (using all messages in the conversation)
    const apiMessages = updatedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Send via useAgentRun — this POSTs to /api/chat and consumes the SSE stream
    const result = await agentRun.send(messageContent, {
      messages: apiMessages,
      threadId,
      model: selectedModel,
      uploadIds: uploadIds.length > 0 ? uploadIds : undefined,
    });

    // Persist assistant message on completion
    if (result.ok && result.fullText) {
      // Extract artifacts and tool call summaries from segments
      const runArtifacts: Artifact[] = [];
      for (const seg of agentRun.state.segments) {
        if (seg.type === "artifact") {
          runArtifacts.push(seg.artifact);
        }
      }
      const toolCallSummaries = extractToolSummaries(agentRun.state.segments);

      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: result.fullText,
        artifacts: runArtifacts.length > 0 ? runArtifacts : undefined,
      };

      // Update messages state with the completed assistant message
      setMessages((prev) => [...prev, assistantMessage]);

      // Persist with tool call metadata for history reconstruction
      const metadata = toolCallSummaries.length > 0 ? { toolCalls: toolCallSummaries } : undefined;
      fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          threadId: result.threadId,
          id: assistantId,
          role: "assistant",
          content: result.fullText,
          runId: result.runId,
          metadata,
        }),
      }).catch((err) => console.error("[ChatSurface] Failed to save assistant message:", err));

      // Thread title update is handled reactively via agentState.threadTitle
      // (see useEffect below) — no setTimeout polling needed (SURFACE.md §6.2)
    } else if (!result.ok && result.fullText) {
      // Partial content — save what we have with error indicator
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: result.fullText + "\n\n*[Response interrupted]*",
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }

    // Refocus input
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [
    inputValue, pendingUploads, isRunning, activeThreadId, fallbackThreadId,
    messages, selectedModel, agentRun, voiceChat, prefs.voice,
    setMessages, setActiveThreadId, setThreads, clearUploads,
  ]);

  // Wire voice auto-send
  sendMessageRef.current = (text: string) => {
    setInputValue(text);
    // Simulate form submit
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    setTimeout(() => onSubmit(fakeEvent), 50);
  };

  const handleStop = useCallback(() => {
    agentRun.stop();
  }, [agentRun]);

  // Retry: re-send the last user message (BEHAVIOR.md §7.1)
  // Uses sendMessageRef which is updated every render with latest onSubmit closure
  const handleRetry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    sendMessageRef.current(lastUserMsg.content);
  }, [messages]);

  // Edit last message: populate composer with last user message text (§5.2)
  const handleEditLastMessage = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setInputValue(lastUserMsg.content);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [messages]);

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
      className="cs-root"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Main chat column */}
      <main aria-label="Chat" className="cs-main">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
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

        {/* Timeline - renders segments from useAgentRun */}
        <ChatTimeline
          segments={segments}
          isStreaming={isStreaming}
          onRetry={handleRetry}
          emptyState={
            <div className="cs-empty">
              <p className="cs-empty-primary">
                What&apos;s on your mind?
              </p>
              {prefs.voice.enabled && (
                <p className="cs-empty-hint">
                  {prefs.voice.mode === "push-to-talk" ? "Hold spacebar to speak" : "Click mic to talk"}
                </p>
              )}
            </div>
          }
        />

        {/* Status strip — driven by useAgentRun state */}
        <StatusStrip
          runState={runState}
          onStop={handleStop}
          elapsedMs={elapsedMs}
        />

        {/* Composer — driven by useAgentRun state */}
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
          onEditLastMessage={handleEditLastMessage}
          fileInputRef={fileInputRef}
          inputRef={inputRef}
        />
      </main>

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
