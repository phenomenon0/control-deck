"use client";

/**
 * ChatDeckV2 — the recomposed v2 chat surface, wired live.
 *
 * Composes the v2 leaves (ThreadSidebar + ChatTimeline + ChatComposer) and wires
 * them to the deck's real state: useThreadManager (threads + messages) and
 * useAgentRun (send + stream + stop). Token-driven, so it renders in the deck's
 * native theme. Mounted at /deck/chat-v2 as a side-by-side preview of the old
 * ChatSurface — the existing chat route is untouched.
 *
 * Streaming model: the active thread's `messages` are the single source of
 * truth; on submit we optimistically append the user message + an empty
 * assistant message, then stream tokens into that assistant message via
 * agentRun.send's onTextDelta hook, finalizing with the returned fullText.
 *
 * Trim-to-core: text in / streamed text out. Uploads + voice (the composer's
 * opt-in modalities) are deliberately not wired yet.
 */

import { useCallback, useState } from "react";

import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import type { Message } from "@/lib/chat/helpers";

// Voice states where the mic is genuinely open (drives the composer's
// recording affordance). Deliberately narrow: transitional/agent/network
// states (submitting, thinking, speaking, reconnecting, error) must NOT read
// as "recording" — otherwise a down voice service shows a false live mic.
const LISTENING_STATES = new Set(["arming", "listening", "transcribing"]);

import { ThreadSidebar, type ThreadItem } from "./ThreadSidebar";
import { ChatTimeline, type TimelineMessage } from "./ChatTimeline";
import { ChatComposer } from "./ChatComposer";

function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.round(Math.random() * 1e9)}`);

export function ChatDeckV2() {
  const {
    threads,
    activeThreadId,
    messages,
    effectiveThreadId,
    selectThread,
    deleteThread,
    updateThreadTitle,
    setActiveThreadId,
    setMessages,
    resetFallbackThreadId,
  } = useThreadManager();
  const { prefs } = useDeckSettings();
  const { send, stop, isRunning } = useAgentRun();
  const [input, setInput] = useState("");

  // Voice/mic: reuse a parent-provided session if one exists (one mic, one
  // socket), otherwise own one. Dictated finals append into the composer so the
  // user can review/edit before sending — same contract as the legacy chat.
  const sharedVoice = useOptionalVoiceSession();
  const ownVoice = useVoiceSession({
    enabled: prefs.voice.enabled && !sharedVoice,
    onTranscriptFinal: (text) => {
      const trimmed = text.trim();
      if (trimmed) setInput((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
    },
  });
  const voice = sharedVoice ?? ownVoice;
  const recording = LISTENING_STATES.has(voice.state);
  const toggleVoice = useCallback(() => {
    if (recording) void voice.stopListening();
    else void voice.startListening();
  }, [recording, voice]);

  const threadItems: ThreadItem[] = threads.map((t) => ({
    id: t.id,
    title: t.title || "New conversation",
    meta: relTime(t.lastMessageAt),
  }));

  const timelineMessages: TimelineMessage[] = messages.map((m, i) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    model: m.role === "assistant" ? prefs.model || undefined : undefined,
    streaming: isRunning && m.role === "assistant" && i === messages.length - 1,
  }));

  const startNew = useCallback(() => {
    resetFallbackThreadId();
    setActiveThreadId(null);
    setMessages([]);
    setInput("");
  }, [resetFallbackThreadId, setActiveThreadId, setMessages]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");

    const history = messages;
    const assistantId = uid();
    const userMsg: Message = { id: uid(), role: "user", content: text };
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const CHAT_PROVIDERS = ["ollama", "vllm", "llamacpp", "lm-studio"] as const;
    const providerId = (CHAT_PROVIDERS as readonly string[]).includes(prefs.providerId as string)
      ? (prefs.providerId as (typeof CHAT_PROVIDERS)[number])
      : undefined;

    try {
      const result = await send(text, {
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        threadId: effectiveThreadId,
        model: prefs.model,
        providerId,
        systemPrompt: prefs.systemPrompt,
        preset: prefs.localModelPreset,
        hooks: {
          onTextDelta: (delta) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
            ),
        },
      });
      if (result?.ok && result.fullText) {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: result.fullText } : m)));
      } else if (!result?.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content
              ? { ...m, content: "_(no response — is a model running?)_" }
              : m,
          ),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "request failed";
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId && !m.content ? { ...m, content: `_(error: ${msg})_` } : m)),
      );
    }
  }, [input, isRunning, messages, send, effectiveThreadId, prefs, setMessages]);

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="hidden w-[260px] shrink-0 border-r sm:block" style={{ borderColor: "var(--border-subtle)" }}>
        <ThreadSidebar
          threads={threadItems}
          activeId={activeThreadId}
          onSelect={selectThread}
          onNew={startNew}
          onRename={updateThreadTitle}
          onDelete={deleteThread}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto h-full max-w-3xl px-4">
            <ChatTimeline messages={timelineMessages} emptyTitle="Ask anything." emptyLabel="Pick a thread, or start a new one." />
          </div>
        </div>
        <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="mx-auto max-w-3xl px-4 py-3">
            <ChatComposer
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              streaming={isRunning}
              onStop={stop}
              modelLabel={prefs.model || "auto"}
              placeholder="Message the deck…"
              onToggleVoice={prefs.voice.enabled ? toggleVoice : undefined}
              recording={recording}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatDeckV2;
