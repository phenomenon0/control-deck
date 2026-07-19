"use client";

/**
 * useChatAutoTTS — speak assistant replies to voice-origin turns.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Auto-TTS only fires for assistant messages that answer a voice-origin turn
 * (tracked via voiceReplyMessageIdsRef, registered in ChatSubmitController —
 * see shouldRegisterVoiceReply). Opening voice mode by itself must not read
 * old chat history or typed replies; manual speak controls still call
 * `voiceChat.speak()` directly.
 */

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/chat/helpers";
import type { VoiceSessionApi } from "@/lib/voice/use-voice-session";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";

export interface AutoSpeakGateInput {
  voiceEnabled: boolean;
  isRunning: boolean;
  lastMessage: Pick<Message, "id" | "role" | "content"> | undefined;
  registeredIds: ReadonlySet<string>;
  lastSpokenId: string | null;
}

/**
 * Gate for full-text readback. Pure so the contract stays pinned under test:
 * speak only a completed assistant message whose id was registered for
 * readback by the submit controller, once, after the run has settled.
 */
export function shouldAutoSpeakReply({
  voiceEnabled,
  isRunning,
  lastMessage,
  registeredIds,
  lastSpokenId,
}: AutoSpeakGateInput): boolean {
  if (!voiceEnabled || isRunning) return false;
  if (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.content) return false;
  if (!registeredIds.has(lastMessage.id)) return false;
  if (lastSpokenId === lastMessage.id) return false;
  return true;
}

interface UseChatAutoTTSOptions {
  voiceEnabled: boolean;
  isRunning: boolean;
  messages: Message[];
  voiceChat: UseVoiceChatReturn;
  voiceSession: VoiceSessionApi;
  voiceReplyMessageIdsRef: { current: Set<string> };
}

export function useChatAutoTTS({
  voiceEnabled,
  isRunning,
  messages,
  voiceChat,
  voiceSession,
  voiceReplyMessageIdsRef,
}: UseChatAutoTTSOptions): void {
  const lastSpokenIdRef = useRef<string | null>(null);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (
      !lastMsg ||
      !shouldAutoSpeakReply({
        voiceEnabled,
        isRunning,
        lastMessage: lastMsg,
        registeredIds: voiceReplyMessageIdsRef.current,
        lastSpokenId: lastSpokenIdRef.current,
      })
    ) {
      return;
    }
    voiceReplyMessageIdsRef.current.delete(lastMsg.id);
    lastSpokenIdRef.current = lastMsg.id;

    const cleanContent = lastMsg.content
      .replace(/<tool[^>]*>[\s\S]*?<\/tool>/g, "")
      .replace(/```[\s\S]*?```/g, "code block")
      .replace(/\{"tool"[\s\S]*?\}/g, "")
      // Markdown → speakable plain text. Order matters: images/links before
      // inline code so URLs in brackets don't get partially eaten.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
      .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .trim();

    if (cleanContent) {
      voiceChat.speak(cleanContent).finally(() => {
        voiceSession.markAgentRunFinished();
      });
    } else {
      voiceSession.markAgentRunFinished();
    }
  }, [isRunning, messages, voiceEnabled, voiceChat, voiceSession]);
}
