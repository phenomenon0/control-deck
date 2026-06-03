"use client";

/**
 * ChatSurfaceV2 — the RICH chat surface, wired live.
 *
 * Unlike ChatDeckV2 (flat ChatTimeline), this renders the deck's real agent-run
 * timeline: it drives `ChatSegments` straight off `useAgentRun().state.segments`,
 * so reasoning, tool-call activity, artifacts, and errors render as they stream —
 * not just text. Approval (InterruptRequested) surfaces the ApprovalRequest gate
 * and POSTs the decision back. Thread history seeds the timeline via LOAD_HISTORY.
 *
 * Mounted at /deck/chat-v2 as a live preview beside the untouched v1 chat.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import type { Message } from "@/lib/chat/helpers";
import type { TimelineSegment } from "@/lib/types/agentRun";

import { ThreadSidebar, type ThreadItem } from "./ThreadSidebar";
import { ChatComposer } from "./ChatComposer";
import { ChatSegments, type PendingApproval } from "./ChatSegments";

// Voice states where the mic is genuinely open (drives the composer's recording
// affordance). Transitional/agent/network states must NOT read as "recording".
const LISTENING_STATES = new Set(["arming", "listening", "transcribing"]);

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

/** Persisted flat messages → timeline segments (for thread history). */
function messagesToSegments(messages: Message[]): TimelineSegment[] {
  return messages.map((m, i) =>
    m.role === "user"
      ? { id: m.id, timestamp: i, type: "user-message", content: m.content }
      : { id: m.id, timestamp: i, type: "agent-message", messageId: m.id, content: m.content, isStreaming: false, complete: true },
  );
}

/** Timeline segments → the {role,content} conversation the model is sent. */
function segmentsToMessages(segments: TimelineSegment[]): Array<{ role: string; content: string }> {
  return segments
    .filter((s): s is Extract<TimelineSegment, { type: "user-message" | "agent-message" }> => s.type === "user-message" || s.type === "agent-message")
    .map((s) => ({ role: s.type === "user-message" ? "user" : "assistant", content: s.content }));
}

async function postDecision(path: "approve" | "reject", runId: string, reason?: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chat/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(path === "reject" ? { runId, reason } : { runId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function ChatSurfaceV2() {
  const {
    threads, activeThreadId, messages, effectiveThreadId,
    selectThread, deleteThread, updateThreadTitle, setActiveThreadId, setMessages, resetFallbackThreadId,
  } = useThreadManager();
  const { prefs } = useDeckSettings();

  const [approval, setApproval] = useState<(PendingApproval & { runId: string }) | null>(null);
  const { state, dispatch, send, stop, isRunning } = useAgentRun({
    onInterrupt: (req) =>
      setApproval({ runId: req.runId, toolName: req.toolName, args: (req.args ?? undefined) as Record<string, unknown> | undefined, status: "pending" }),
    onInterruptResolved: () => setApproval(null),
  });
  const [input, setInput] = useState("");

  // Voice/mic: reuse a parent-provided session if one exists (one mic, one
  // socket), otherwise own one. Dictated finals append into the composer so the
  // user can review/edit before sending.
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

  // Seed the timeline from thread history on switch / idle refresh (a live run
  // owns the segments, so don't clobber it while running).
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isRunning) return;
    const key = `${activeThreadId ?? "new"}:${messages.length}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    dispatch({ type: "LOAD_HISTORY", segments: messagesToSegments(messages) });
  }, [activeThreadId, messages, isRunning, dispatch]);

  const threadItems: ThreadItem[] = threads.map((t) => ({ id: t.id, title: t.title || "New conversation", meta: relTime(t.lastMessageAt) }));

  const startNew = useCallback(() => {
    resetFallbackThreadId();
    setActiveThreadId(null);
    setMessages([]);
    dispatch({ type: "LOAD_HISTORY", segments: [] });
    loadedRef.current = "new:0";
    setInput("");
  }, [resetFallbackThreadId, setActiveThreadId, setMessages, dispatch]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");
    // Full conversation incl. the new turn (the reducer adds the user segment
    // for display; the body carries the messages the model actually sees).
    const convo = [...segmentsToMessages(state.segments), { role: "user", content: text }];
    const CHAT_PROVIDERS = ["ollama", "vllm", "llamacpp", "lm-studio"] as const;
    const providerId = (CHAT_PROVIDERS as readonly string[]).includes(prefs.providerId as string)
      ? (prefs.providerId as (typeof CHAT_PROVIDERS)[number])
      : undefined;
    await send(text, {
      messages: convo,
      threadId: effectiveThreadId,
      model: prefs.model,
      providerId,
      systemPrompt: prefs.systemPrompt,
      preset: prefs.localModelPreset,
    });
  }, [input, isRunning, state.segments, send, effectiveThreadId, prefs]);

  const handleApprove = useCallback(async () => {
    if (!approval) return;
    setApproval((a) => (a ? { ...a, busy: true } : a));
    const ok = await postDecision("approve", approval.runId);
    setApproval((a) => (a ? { ...a, busy: false, status: ok ? "approved" : a.status, error: ok ? null : "approval failed" } : a));
  }, [approval]);

  const handleReject = useCallback(async (reason?: string) => {
    if (!approval) return;
    setApproval((a) => (a ? { ...a, busy: true } : a));
    const ok = await postDecision("reject", approval.runId, reason);
    setApproval((a) => (a ? { ...a, busy: false, status: ok ? "rejected" : a.status, error: ok ? null : "reject failed" } : a));
  }, [approval]);

  const empty = state.segments.length === 0;

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="hidden w-[260px] shrink-0 border-r sm:block" style={{ borderColor: "var(--border-subtle)" }}>
        <ThreadSidebar threads={threadItems} activeId={activeThreadId} onSelect={selectThread} onNew={startNew} onRename={updateThreadTitle} onDelete={deleteThread} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto h-full max-w-3xl px-4 py-4">
            {empty ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: "calc(var(--font-size-base) * 1.6)", color: "var(--text-primary)", fontWeight: "var(--fw-heading, 600)" }}>Ask anything.</span>
                <span className="text-[var(--text-muted)]" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>Pick a thread, or start a new one.</span>
              </div>
            ) : (
              <ChatSegments
                segments={state.segments}
                pendingApproval={approval ?? undefined}
                onApprove={handleApprove}
                onReject={handleReject}
                onRetry={handleSubmit}
              />
            )}
          </div>
        </div>
        <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="mx-auto max-w-3xl px-4 py-3">
            <ChatComposer value={input} onChange={setInput} onSubmit={handleSubmit} streaming={isRunning} onStop={stop} modelLabel={prefs.model || "auto"} placeholder="Message the deck…" onToggleVoice={prefs.voice.enabled ? toggleVoice : undefined} recording={recording} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatSurfaceV2;
