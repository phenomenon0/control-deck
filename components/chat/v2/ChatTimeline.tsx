"use client";

/**
 * ChatTimeline (v2 rebuild) — the scrollable transcript.
 *
 * Stacks ChatMessage rows with flat hairline separators, handles the empty and
 * initial-loading states, and auto-scrolls to the bottom as messages arrive or
 * the streaming message grows. Prop-driven, no provider deps — the container
 * feeds it `messages` from useThreadManager/the chat run later.
 *
 * a11y: the transcript is a polite live region (role="log") so new messages are
 * announced without stealing focus.
 */

import { useEffect, useRef } from "react";

import { ChatMessage, type ChatRole } from "./ChatMessage";

export interface TimelineMessage {
  id: string;
  role: ChatRole;
  content: string;
  model?: string;
  timestamp?: string;
  streaming?: boolean;
}

export interface ChatTimelineProps {
  messages: TimelineMessage[];
  /** Initial-history loading state. */
  loading?: boolean;
  /** Big welcome title for the empty state. */
  emptyTitle?: string;
  /** Muted subtitle/hint under the welcome title (empty state). */
  emptyLabel?: string;
}

export function ChatTimeline({
  messages,
  loading = false,
  emptyTitle = "Ask anything.",
  emptyLabel = "No messages yet",
}: ChatTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const count = messages.length;
  const lastContent = messages[count - 1]?.content ?? "";

  // Keep the latest message in view as the transcript grows / streams.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count, lastContent]);

  const metaStyle = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

  if (loading) {
    return (
      <div role="status" className="flex h-full items-center justify-center">
        <span className="text-[var(--text-muted)]" style={metaStyle}>
          loading…
        </span>
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <h2
          className="text-[var(--text-primary)]"
          style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl, 28px)", letterSpacing: "var(--tracking-tight, -0.01em)", fontWeight: "var(--fw-heading, 600)", lineHeight: 1.15 }}
        >
          {emptyTitle}
        </h2>
        <span className="text-[var(--text-muted)]" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>
          {emptyLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-y-auto py-6"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
    >
      {/* mt-auto keeps a short thread anchored near the composer instead of
          starting "from the sky"; long threads scroll normally. */}
      <div className="mt-auto flex flex-col">
        {messages.map((m, i) => {
          // Group runs: tight gap between same-sender messages, roomier on a
          // role switch. Uniform spacing reads "odd" once content varies.
          const sameAsPrev = i > 0 && messages[i - 1].role === m.role;
          const spacing = i === 0 ? "" : sameAsPrev ? "mt-1.5" : "mt-6";
          return (
            <div key={m.id} className={spacing}>
              <ChatMessage
                role={m.role}
                content={m.content}
                model={m.model}
                timestamp={m.timestamp}
                streaming={m.streaming}
              />
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}

export default ChatTimeline;
