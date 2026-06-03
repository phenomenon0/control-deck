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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { measureBlock } from "@/lib/text/measure";

import { ChatMessage, type ChatRole } from "./ChatMessage";
import { EmptyState } from "./ui";

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
  /**
   * Window the transcript with a virtualizer (only mount the visible rows).
   * Off by default — turn it on for long threads. Heights are seeded by Pretext
   * (accurate first paint, stable scrollbar) and corrected by real measurement.
   */
  virtualize?: boolean;
}

export function ChatTimeline({
  messages,
  loading = false,
  emptyTitle = "Ask anything.",
  emptyLabel = "No messages yet",
  virtualize = false,
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
    return <EmptyState title={emptyTitle} description={emptyLabel} className="px-6" />;
  }

  if (virtualize) {
    return <VirtualMessages messages={messages} />;
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

// ── Virtualized transcript ───────────────────────────────────────────────────
// Windows the list so only the visible rows mount. The hard part of any dynamic
// virtualizer is a *good initial height* — guess too small and the scrollbar
// lurches as rows measure. Pretext gives us that estimate up front (real text
// layout, no DOM), and @tanstack/react-virtual corrects it from the measured
// element as each row scrolls in.

interface RowMetrics {
  font: string;
  lineHeight: number;
  width: number;
}

/** Fixed vertical chrome (meta line + padding/bubble) added to the text height. */
const ROLE_CHROME: Record<ChatRole, number> = { user: 44, assistant: 40, system: 28 };
/** User bubbles are right-aligned with a max width, so text wraps narrower. */
const ROLE_WIDTH_FACTOR: Record<ChatRole, number> = { user: 0.78, assistant: 1, system: 0.9 };

function VirtualMessages({ messages }: { messages: TimelineMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<RowMetrics | null>(null);
  const pinnedRef = useRef(true);
  const count = messages.length;
  const lastContent = messages[count - 1]?.content ?? "";

  // Read the body font + available width off the live scroll container, so the
  // estimate matches whatever the active theme renders, and re-read on resize.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      const weight = cs.fontWeight && cs.fontWeight !== "400" && cs.fontWeight !== "normal" ? `${cs.fontWeight} ` : "";
      const fontSize = parseFloat(cs.fontSize) || 15;
      const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
      const width = Math.max(1, el.clientWidth - 48); // px-6 gutters
      setMetrics({ font: `${weight}${cs.fontSize} ${cs.fontFamily}`, lineHeight, width });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    overscan: 6,
    getItemKey: (i) => messages[i].id,
    estimateSize: (i) => {
      const m = messages[i];
      const spacing = i === 0 ? 0 : messages[i - 1].role === m.role ? 6 : 24;
      if (!metrics) return 64 + spacing;
      const block = measureBlock(
        m.content || " ",
        metrics.font,
        metrics.width * ROLE_WIDTH_FACTOR[m.role],
        metrics.lineHeight,
      );
      const textHeight = block?.height ?? metrics.lineHeight;
      return Math.ceil(textHeight + ROLE_CHROME[m.role] + spacing);
    },
  });

  // Re-seed estimates once the font/width resolve or change.
  useLayoutEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  // Bottom-anchor: land at the newest message on mount, and stay pinned as the
  // thread grows / streams — but only if the user hasn't scrolled up to read.
  useLayoutEffect(() => {
    if (pinnedRef.current && count > 0) {
      virtualizer.scrollToIndex(count - 1, { align: "end" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, lastContent, metrics]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto py-6"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
    >
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {items.map((vi) => {
          const m = messages[vi.index];
          // Spacing lives as padding INSIDE the measured row so the virtualizer
          // accounts for it (a margin would fall outside the measured box).
          const sameAsPrev = vi.index > 0 && messages[vi.index - 1].role === m.role;
          const spacing = vi.index === 0 ? "" : sameAsPrev ? "pt-1.5" : "pt-6";
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
            >
              <div className={spacing}>
                <ChatMessage
                  role={m.role}
                  content={m.content}
                  model={m.model}
                  timestamp={m.timestamp}
                  streaming={m.streaming}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ChatTimeline;
