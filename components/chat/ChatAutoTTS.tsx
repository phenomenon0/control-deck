"use client";

/**
 * useChatAutoTTS — speak assistant replies to voice-origin turns.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Auto-TTS only fires for assistant messages that answer a voice-origin turn
 * (tracked via voiceReplyMessageIdsRef). Opening voice mode by itself must
 * not read old chat history or typed replies; manual speak controls still
 * call `voiceChat.speak()` directly.
 */

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/chat/helpers";
import type { VoiceSessionApi } from "@/lib/voice/use-voice-session";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";

interface UseChatAutoTTSOptions {
  voiceEnabled: boolean;
  isRunning: boolean;
  messages: Message[];
  voiceChat: UseVoiceChatReturn;
  voiceSession: VoiceSessionApi;
  voiceReplyMessageIdsRef: { current: Set<string> };
  setSpeakingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useChatAutoTTS({
  voiceEnabled,
  isRunning,
  messages,
  voiceChat,
  voiceSession,
  voiceReplyMessageIdsRef,
  setSpeakingMessageId,
}: UseChatAutoTTSOptions): void {
  const lastSpokenIdRef = useRef<string | null>(null);
  const pendingTTSRef = useRef<string | null>(null);

  useEffect(() => {
    if (!voiceEnabled || isRunning) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.content) return;
    if (!voiceReplyMessageIdsRef.current.has(lastMsg.id)) return;
    if (lastSpokenIdRef.current === lastMsg.id) return;
    if (pendingTTSRef.current === lastMsg.id) pendingTTSRef.current = null;
    voiceReplyMessageIdsRef.current.delete(lastMsg.id);

    lastSpokenIdRef.current = lastMsg.id;
    setSpeakingMessageId(lastMsg.id);

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
        setSpeakingMessageId(null);
        voiceSession.markAgentRunFinished();
      });
    } else {
      setSpeakingMessageId(null);
      voiceSession.markAgentRunFinished();
    }
  }, [isRunning, messages, voiceEnabled, voiceChat, voiceSession]);
}
