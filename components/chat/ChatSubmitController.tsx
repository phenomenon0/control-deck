"use client";

/**
 * useChatSubmitController — submit pipeline for the chat surface.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Owns the send path: thread resolution, user-message persistence, the
 * useAgentRun POST + SSE consumption, live voice reply streaming (phrase
 * conductor / streaming reply lane), assistant-message persistence, and the
 * sendMessageRef wiring that lets the voice controller auto-send. Also
 * exposes stop / retry / edit-last handlers.
 */

import { useCallback } from "react";
import type { Thread, Message } from "@/lib/chat/helpers";
import type { PendingUpload } from "@/lib/types/chat";
import type { UseAgentRunReturn } from "@/lib/hooks/useAgentRun";
import type { VoiceSessionApi } from "@/lib/voice/use-voice-session";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";
import type { AudioDockApi } from "@/components/audio/AudioDockProvider";
import type { DeckPrefs, LocalModelPreset } from "@/components/settings/DeckSettingsProvider";
import { PhraseConductor } from "@/lib/voice/phrase-conductor";
import { cleanResponseForSpeech } from "@/lib/voice/conductor";
import type { Artifact } from "@/components/chat/ArtifactRenderer";
import type { ActivityStep } from "@/lib/types/agentRun";

export type VoiceSubmitOrigin = "voice-dictation" | "voice-live";
export type SubmitOrigin = "typed" | VoiceSubmitOrigin;

/** Truncate string values in tool args to keep metadata compact.
 *  `code` is exempt — the inline code block in chat needs the full source on
 *  reload, otherwise old execute_code rows render as a 200-char stub. */
function truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const keepFull = key === "code";
    result[key] = !keepFull && typeof value === "string" && value.length > 200
      ? value.slice(0, 200) + "..."
      : value;
  }
  return result;
}

function summarizeToolSteps(steps: ActivityStep[]) {
  return steps
    .filter((step) => step.status !== "running")
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

interface UseChatSubmitControllerOptions {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  pendingUploads: PendingUpload[];
  clearUploads: () => void;
  isRunning: boolean;
  isUploading: boolean;
  messagesLoading: boolean;
  activeThreadId: string | null;
  fallbackThreadId: string;
  setActiveThreadId: (id: string | null, options?: { load?: boolean }) => void;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  selectedModel: string;
  providerId: DeckPrefs["providerId"];
  systemPrompt: string;
  localModelPreset: LocalModelPreset;
  agentRun: UseAgentRunReturn;
  voiceSession: VoiceSessionApi;
  voiceChat: UseVoiceChatReturn;
  dockMode: AudioDockApi["mode"] | undefined;
  dockRouteId: string | undefined;
  directSubmitRef: { current: { text: string; origin: SubmitOrigin } | null };
  sendMessageRef: { current: (text: string, origin?: SubmitOrigin) => void };
  voiceReplyMessageIdsRef: { current: Set<string> };
  queueComposerFocus: (delay?: number) => void;
  setSpeakingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
}

interface ChatSubmitController {
  onSubmit: (e: React.FormEvent) => Promise<void>;
  handleStop: () => void;
  handleRetry: () => void;
  handleEditLastMessage: () => void;
}

export function useChatSubmitController({
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
  providerId,
  systemPrompt,
  localModelPreset,
  agentRun,
  voiceSession,
  voiceChat,
  dockMode,
  dockRouteId,
  directSubmitRef,
  sendMessageRef,
  voiceReplyMessageIdsRef,
  queueComposerFocus,
  setSpeakingMessageId,
}: UseChatSubmitControllerOptions): ChatSubmitController {
  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const directSubmit = directSubmitRef.current;
    directSubmitRef.current = null;
    const origin: SubmitOrigin = directSubmit?.origin ?? "typed";
    const isVoiceOrigin = origin === "voice-dictation" || origin === "voice-live";
    const shouldSpeakReply = origin === "voice-live";
    const text = (directSubmit?.text ?? inputValue).trim();
    if (!text && pendingUploads.length === 0) return;
    if (isRunning || isUploading || messagesLoading) return;

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
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(threadId, { load: false });
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

    // TTS tracking. Live voice streams speech from SSE text deltas below, so
    // don't also mark the completed assistant message for full-text readback.
    const assistantId = crypto.randomUUID();

    // Build API messages (using all messages in the conversation).
    // Drop any with empty/whitespace-only content — earlier voice bugs
    // could stamp blank user bubbles into the thread, and replaying them
    // makes the model respond as if every new turn were a no-op.
    const apiMessages = updatedMessages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    // Send via useAgentRun — this POSTs to /api/chat and consumes the SSE stream
    const clientRunId = crypto.randomUUID();
    if (isVoiceOrigin) {
      voiceSession.markAgentRunStarted(clientRunId);
    }
    let liveSpeechQueued = false;
    // Realtime transports own incremental audio. The app-gateway path queues
    // phrase WAVs via voiceChat.queueSpeech.
    const streamingReply = shouldSpeakReply ? voiceSession.beginStreamingReply() : null;
    // Shorter phrases when streaming — we want the first phrase to ship as
    // soon as a sentence boundary appears. The 180-char max was tuned for the
    // per-phrase WAV path where round-trip cost dominated.
    const liveConductor = shouldSpeakReply
      ? new PhraseConductor({ maxChars: streamingReply ? 80 : 180 })
      : null;
    const pushPhrase = (text: string): boolean => {
      if (streamingReply) {
        streamingReply.speak(text);
        return true;
      }
      return voiceChat.queueSpeech(text);
    };
    const queueLiveSpeech = (delta: string) => {
      if (!liveConductor) return;
      for (const candidate of liveConductor.pushTextDelta(delta)) {
        liveSpeechQueued = pushPhrase(candidate.text) || liveSpeechQueued;
      }
    };
    const flushLiveSpeech = () => {
      if (!liveConductor) return;
      for (const candidate of liveConductor.flush()) {
        liveSpeechQueued = pushPhrase(candidate.text) || liveSpeechQueued;
      }
    };
    // Only the chat-capable local engines round-trip through the per-request
    // baseURL override in /api/chat. comfyui isn't an LLM and cloud routes
    // ignore providerId entirely, so this guard is enough.
    const chatProviderId =
      providerId === "ollama" ||
      providerId === "vllm" ||
      providerId === "llamacpp" ||
      providerId === "lm-studio"
        ? providerId
        : undefined;
    const result = await agentRun.send(messageContent, {
      messages: apiMessages,
      threadId,
      runId: clientRunId,
      model: selectedModel,
      providerId: chatProviderId,
      uploadIds: uploadIds.length > 0 ? uploadIds : undefined,
      systemPrompt,
      preset: localModelPreset,
      voice: isVoiceOrigin
        ? {
            turnId: crypto.randomUUID(),
            runId: clientRunId,
            routeId: shouldSpeakReply ? dockRouteId ?? "handsfree-chat" : "dictation",
            mode: shouldSpeakReply ? dockMode ?? "chat" : "dictation",
            surface: "chat",
            source: shouldSpeakReply ? "live" : "dictation",
            modality: "voice",
          }
        : undefined,
      hooks: shouldSpeakReply ? { onTextDelta: queueLiveSpeech } : undefined,
    });

    // Persist assistant message on completion
    if (result.ok && result.fullText) {
      // Persist from the stream-local capture returned by useAgentRun. Reading
      // reducer state here is stale because this async callback belongs to the
      // render that started the run.
      const runArtifacts: Artifact[] = result.artifacts;
      const toolCallSummaries = summarizeToolSteps(result.toolCalls);

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
      if (isVoiceOrigin && !shouldSpeakReply) {
        voiceSession.markAgentRunFinished();
      }
    } else if (!result.ok && result.fullText) {
      // Partial content — save what we have with error indicator
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: result.fullText + "\n\n*[Response interrupted]*",
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (isVoiceOrigin && !shouldSpeakReply) {
        voiceSession.markAgentRunFinished();
      }
    } else {
      voiceReplyMessageIdsRef.current.delete(assistantId);
      if (isVoiceOrigin && !shouldSpeakReply) {
        voiceSession.markAgentRunFinished();
      }
    }

    if (shouldSpeakReply) {
      flushLiveSpeech();
      setSpeakingMessageId(assistantId);
      if (!liveSpeechQueued) {
        // No phrases queued (streaming lane wasn't routable AND queueSpeech
        // refused — or the reply produced no terminator-bound phrases). Fall
        // back to a single readback. Skip if streamingReply is live, since
        // the streaming lane is the only valid output then.
        if (!streamingReply) {
          const fallbackText = cleanResponseForSpeech(result.fullText, 360);
          if (fallbackText) {
            await voiceChat.speak(fallbackText);
          }
        }
      }
      if (streamingReply) {
        await streamingReply.finish();
      } else if (liveSpeechQueued) {
        await voiceChat.waitForSpeechEnd();
      }
      setSpeakingMessageId(null);
      voiceSession.markAgentRunFinished();
    }

    // Refocus input
    queueComposerFocus(100);
  }, [
    inputValue, pendingUploads, isRunning, isUploading, messagesLoading, activeThreadId, fallbackThreadId,
    messages, selectedModel, agentRun, voiceChat, voiceSession,
    providerId, systemPrompt, localModelPreset, dockMode, dockRouteId,
    setMessages, setActiveThreadId, setThreads, clearUploads, queueComposerFocus,
  ]);

  // Wire voice auto-send
  sendMessageRef.current = (text: string, origin: SubmitOrigin = "typed") => {
    const trimmed = text.trim();
    if (!trimmed) return;
    directSubmitRef.current = { text: trimmed, origin };
    setInputValue(trimmed);
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    void onSubmit(fakeEvent);
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
    queueComposerFocus(0);
  }, [messages, queueComposerFocus]);

  return { onSubmit, handleStop, handleRetry, handleEditLastMessage };
}
