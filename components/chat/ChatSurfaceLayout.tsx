"use client";

/**
 * ChatSurfaceLayout — render assembly for the chat surface.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Pure composition: header, hidden file input, upload tray, timeline, status
 * strip, composer / voice sheet, the "radical" control-tower shell, context
 * rail, and the interrupt dialog. All state and handlers flow in as props
 * from the orchestrator — nothing is owned here.
 */

import type { RefObject } from "react";
import type { ChatSurface as ChatSurfaceVariant, VoiceMode } from "@/components/settings/DeckSettingsProvider";
import type { InterruptRequest } from "@/lib/hooks/useAgentRun";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import type { PendingUpload } from "@/lib/types/chat";
import type { ActivityStep, RunState, TimelineSegment } from "@/lib/types/agentRun";
import { ChatTimeline } from "@/components/chat/ChatTimeline";
import { StatusStrip } from "@/components/chat/StatusStrip";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { UploadTray } from "@/components/chat/UploadTray";
import { ContextRail } from "@/components/chat/ContextRail";
import { VoiceModeSheet } from "@/components/voice/VoiceModeSheet";
import { InterruptDialog } from "@/components/chat/InterruptDialog";
import { ChatSurfaceHeader } from "@/components/chat/ChatSurfaceHeader";
import { ChatControlTower } from "@/components/chat/ChatControlTower";

interface ChatSurfaceLayoutProps {
  // Surface chrome
  chatSurface: ChatSurfaceVariant;
  showContextRail: boolean;
  chatTitle: string;
  selectedModel: string;
  toolCount: number;
  artifactCount: number;
  messageCount: number;
  onDrop: (e: React.DragEvent) => void;

  // Run / timeline
  runState: RunState;
  isStreaming: boolean;
  elapsedMs: number;
  activitySteps: ActivityStep[];
  segments: TimelineSegment[];
  onStop: () => void;
  onRetry: () => void;

  // Uploads
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileUpload: (file: File) => Promise<void>;
  uploadTrayOpen: boolean;
  setUploadTrayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pendingUploads: PendingUpload[];
  setPendingUploads: React.Dispatch<React.SetStateAction<PendingUpload[]>>;

  // Composer / voice
  inputValue: string;
  setInputValue: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  voiceChat: UseVoiceChatReturn;
  voiceEnabled: boolean;
  voiceMode: VoiceMode;
  voiceModeOpen: boolean;
  setVoiceModeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onMicClick: () => void;
  onMicRelease: () => void;
  onAttachClick: () => void;
  onRemoveUpload: (id: string) => void;
  onEditLastMessage: () => void;
  effectiveThreadId: string;

  // Interrupt dialog
  pendingInterrupt: InterruptRequest | null;
  setPendingInterrupt: React.Dispatch<React.SetStateAction<InterruptRequest | null>>;
}

export function ChatSurfaceLayout({
  chatSurface,
  showContextRail,
  chatTitle,
  selectedModel,
  toolCount,
  artifactCount,
  messageCount,
  onDrop,
  runState,
  isStreaming,
  elapsedMs,
  activitySteps,
  segments,
  onStop,
  onRetry,
  fileInputRef,
  onFileUpload,
  uploadTrayOpen,
  setUploadTrayOpen,
  pendingUploads,
  setPendingUploads,
  inputValue,
  setInputValue,
  onSubmit,
  inputRef,
  voiceChat,
  voiceEnabled,
  voiceMode,
  voiceModeOpen,
  setVoiceModeOpen,
  onMicClick,
  onMicRelease,
  onAttachClick,
  onRemoveUpload,
  onEditLastMessage,
  effectiveThreadId,
  pendingInterrupt,
  setPendingInterrupt,
}: ChatSurfaceLayoutProps) {
  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(e) => {
        const files = e.target.files;
        if (files) {
          for (const file of files) onFileUpload(file);
        }
        e.target.value = "";
      }}
    />
  );

  const uploadTray = (
    <UploadTray
      isOpen={uploadTrayOpen}
      onClose={() => setUploadTrayOpen(false)}
      uploads={pendingUploads}
      onRemove={(id) => setPendingUploads((prev) => prev.filter((u) => u.id !== id))}
      onAddMore={() => fileInputRef.current?.click()}
    />
  );

  const timeline = (
    <ChatTimeline
      segments={segments}
      isStreaming={isStreaming}
      onRetry={onRetry}
      onSpeak={(text) => {
        if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
        void voiceChat.speak(text);
      }}
      emptyState={
        <div className="cs-empty">
          <p className="cs-empty-primary">
            What&apos;s on your mind?
          </p>
          {voiceEnabled && (
            <p className="cs-empty-hint">
              {voiceMode === "push-to-talk" ? "Hold spacebar to speak" : "Click mic to talk"}
            </p>
          )}
        </div>
      }
    />
  );

  const statusStrip = (
    <StatusStrip
      runState={runState}
      onStop={onStop}
      elapsedMs={elapsedMs}
    />
  );

  const composer = (
    <ChatComposer
      runState={runState}
      surface={chatSurface}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onSubmit={onSubmit}
      onStop={onStop}
      model={selectedModel}
      voiceChat={voiceChat}
      voiceEnabled={voiceEnabled}
      voiceMode={voiceMode}
      onVoiceModeOpen={() => setVoiceModeOpen(true)}
      onMicClick={onMicClick}
      onMicRelease={onMicRelease}
      pendingUploads={pendingUploads}
      onAttachClick={onAttachClick}
      onRemoveUpload={onRemoveUpload}
      onEditLastMessage={onEditLastMessage}
      fileInputRef={fileInputRef}
      inputRef={inputRef}
    />
  );

  // While voice mode is on, the composer text bar is replaced by an inline
  // voice strip (orb + status + partial transcript + close). Chat timeline
  // stays visible and interactive above it.
  const composerOrVoice = voiceModeOpen ? (
    <VoiceModeSheet
      isOpen
      onClose={() => setVoiceModeOpen(false)}
      threadId={effectiveThreadId}
    />
  ) : composer;

  const chatStack = (
    <>
      <ChatSurfaceHeader
        surface={chatSurface}
        chatTitle={chatTitle}
        model={selectedModel}
        toolCount={toolCount}
        artifactCount={artifactCount}
        messageCount={messageCount}
      />
      {hiddenFileInput}
      {uploadTray}
      {timeline}
      {statusStrip}
      {composerOrVoice}
    </>
  );

  return (
    <div
      className={`cs-root cs-root--surface-${chatSurface} ${showContextRail ? "cs-root--context" : ""}`}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Main chat column */}
      <main aria-label="Chat" className={`cs-main cs-main--${chatSurface}`}>
        {chatSurface === "radical" ? (
          <div className="cs-tower-shell">
            <ChatControlTower
              runState={runState}
              elapsedMs={elapsedMs}
              steps={activitySteps}
              messageCount={messageCount}
              toolCount={toolCount}
              artifactCount={artifactCount}
            />
            <section className="cs-tower-log" aria-label="Thread log">
              {chatStack}
            </section>
          </div>
        ) : (
          chatStack
        )}
      </main>

      {showContextRail && <ContextRail />}

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
