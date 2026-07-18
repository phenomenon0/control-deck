"use client";

/**
 * useChatKeyboardShortcuts — global key handling for the chat surface.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Priority order (BEHAVIOR.md §5):
 *   Modal (100) > Floating panel (50) > Composer (20) > Nav (10) > Global (0)
 */

import { useEffect } from "react";
import { isEditableElement } from "@/lib/dom/editable";
import type { Message, Thread } from "@/lib/chat/helpers";
import type { VoicePrefs } from "@/components/settings/DeckSettingsProvider";
import type { UseVoiceChatReturn } from "@/lib/hooks/useVoiceChat";

interface UseChatKeyboardShortcutsOptions {
  uploadTrayOpen: boolean;
  setUploadTrayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  voiceChat: UseVoiceChatReturn;
  voicePrefs: VoicePrefs;
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  setVoiceModeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  inputRef: { current: HTMLTextAreaElement | null };
  activeThreadId: string | null;
  threads: Thread[];
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  resetFallbackThreadId: () => string;
  setActiveThreadId: (id: string | null, options?: { load?: boolean }) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export function useChatKeyboardShortcuts({
  uploadTrayOpen,
  setUploadTrayOpen,
  voiceChat,
  voicePrefs,
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
}: UseChatKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inInput = isEditableElement(e.target);

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
        voicePrefs.enabled && voicePrefs.mode === "push-to-talk" &&
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
        voicePrefs.enabled && voicePrefs.mode === "push-to-talk" &&
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
    uploadTrayOpen, voiceChat, voicePrefs, setUploadTrayOpen,
    inputValue, activeThreadId, threads,
    selectThread, deleteThread, resetFallbackThreadId, setActiveThreadId, setMessages,
  ]);
}
