"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageRenderer } from "@/components/chat/MessageRenderer";
import { UploadTray } from "@/components/chat/UploadTray";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { VoiceModeSheet } from "@/components/voice/VoiceModeSheet";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useRightRailSlot } from "@/lib/hooks/useRightRail";
import { InterruptDialog } from "@/components/chat/InterruptDialog";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useThreads } from "@/lib/hooks/useThreads";
import { useFileUploads } from "@/lib/hooks/useFileUploads";
import { useSSE } from "@/lib/hooks/useSSE";
import { useSendMessage } from "@/lib/hooks/useSendMessage";
import { ThreadSidebar } from "@/components/chat/ThreadSidebar";
import { ChatInput } from "@/components/chat/ChatInput";
import { setStoredThreads, type Thread } from "@/lib/chat/helpers";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

export default function ChatPaneV2() {
  // ---------------------------------------------------------------------------
  // External hooks
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
        if (!existing.some(a => a.id === artifact.id)) {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  // ---------------------------------------------------------------------------
  // Voice chat (defined before useSendMessage so we can pass stopSpeaking)
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
  // Right Rail (shell-level, context-based)
  // ---------------------------------------------------------------------------
  const rightRail = useRightRailSlot();

  // Sync thread/model/loading/toolcalls/artifacts to RightRail
  useEffect(() => { rightRail.setThreadId(activeThreadId); }, [activeThreadId, rightRail]);
  useEffect(() => { rightRail.setModel(selectedModel); }, [selectedModel, rightRail]);
  useEffect(() => { rightRail.setIsLoading(isLoading); }, [isLoading, rightRail]);
  useEffect(() => { rightRail.setToolCalls(Array.from(toolCallStates.values())); }, [toolCallStates, rightRail]);
  useEffect(() => { rightRail.setArtifacts(messages.flatMap(m => m.artifacts || [])); }, [messages, rightRail]);

  const sendMessageToInput = useCallback((text: string) => { setInputValue(text); inputRef.current?.focus(); }, []);
  useEffect(() => { rightRail.setOnSendMessage(sendMessageToInput); }, [sendMessageToInput, rightRail]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Auto-TTS when assistant message completes (skip if voice mode sheet handles it)
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

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
            if (files) { for (const file of files) handleFileUpload(file); }
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

        {/* Messages */}
        <main style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{
            maxWidth: 960, margin: "0 auto", padding: "20px 40px 24px", width: "100%",
            flex: messages.length === 0 ? 1 : "none",
            display: "flex", flexDirection: "column",
            justifyContent: messages.length === 0 ? "flex-end" : "flex-start",
          }}>
            {messages.length === 0 ? (
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
            ) : (
              <div>
                {messages.map((msg, idx) => {
                  const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
                  const msgToolCalls = isLastAssistant ? Array.from(toolCallStates.values()) : [];
                  return (
                    <div
                      key={msg.id}
                      style={{
                        marginTop: idx > 0 && messages[idx - 1]?.role === msg.role ? 4 : 16,
                      }}
                    >
                      <MessageRenderer
                        message={{
                          ...msg,
                          ...(isLastAssistant && currentPlan ? { plan: currentPlan } : {}),
                          ...(isLastAssistant && currentProgress ? { progress: currentProgress } : {}),
                          ...(msg.cards ? { cards: msg.cards } : (isLastAssistant && currentCards.length > 0 ? { cards: currentCards } : {})),
                        }}
                        isLoading={isLoading}
                        isLast={idx === messages.length - 1}
                        toolCalls={msgToolCalls}
                        isThinking={isLastAssistant && (isThinking || isReasoning)}
                        reasoningContent={isLastAssistant ? reasoningContent : undefined}
                      />
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </main>

        {/* Status bar */}
        {(searchStatus || voiceChat.isProcessingTTS || (isLoading && isThinking)) && (
          <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)", padding: "8px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {isLoading && isThinking && (
              <span className="animate-thinking-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
            )}
            {searchStatus || (voiceChat.isProcessingTTS && "Generating speech...") || (isThinking && "Thinking...")}
          </div>
        )}

        {/* Input Bar */}
        <ChatInput
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSubmit={onSubmit}
          isLoading={isLoading}
          voiceChat={voiceChat}
          voiceEnabled={prefs.voice.enabled}
          voiceMode={prefs.voice.mode}
          onVoiceModeOpen={() => setVoiceModeOpen(true)}
          onMicClick={handleMicClick}
          onMicRelease={handleMicRelease}
          pendingUploads={pendingUploads}
          onAttachClick={handleAttachClick}
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
          setMessages(prev => [
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
          }).catch((err) => console.error("[ChatPane] Failed to save voice user message:", err));
          fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", threadId: tid, id: assistantMsgId, role: "assistant", content: assistantMessage }),
          }).catch((err) => console.error("[ChatPane] Failed to save voice assistant message:", err));
        }}
      />

      {/* Agent-GO Interrupt Dialog */}
      <InterruptDialog
        request={pendingInterrupt}
        onApprove={() => { console.log("[ChatPane] Interrupt approved"); setPendingInterrupt(null); }}
        onReject={(reason) => { console.log("[ChatPane] Interrupt rejected:", reason); setPendingInterrupt(null); }}
      />
    </div>
  );
}
