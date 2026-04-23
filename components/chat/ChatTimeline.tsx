"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TimelineSegment as TSegment } from "@/lib/types/agentRun";
import { TimelineSegment } from "./TimelineSegment";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

interface ChatTimelineProps {
  segments: TSegment[];
  /** Whether the agent is currently producing output (enables auto-scroll) */
  isStreaming?: boolean;
  /** Render when timeline is empty */
  emptyState?: React.ReactNode;
  /** Callback when user clicks Retry on an error segment */
  onRetry?: () => void;
  /** Callback to TTS-play a specific message on demand */
  onSpeak?: (text: string) => void;
}

/** Distance from bottom (px) within which auto-scroll stays active */
const SCROLL_THRESHOLD = 100;

export function ChatTimeline({ segments, isStreaming = false, emptyState, onRetry, onSpeak }: ChatTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollPill, setShowScrollPill] = useState(false);
  const reducedMotion = useReducedMotion();

  /** Scroll behavior: "auto" (instant) when reduced motion active (BEHAVIOR.md §8) */
  const scrollBehavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";

  // Track whether user is near the bottom
  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, []);

  // Auto-scroll when new content arrives and user is near bottom
  useEffect(() => {
    if (isStreaming && isNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: scrollBehavior });
    }
  }, [segments, isStreaming, isNearBottom, scrollBehavior]);

  // Scroll to bottom on initial load
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Monitor scroll position for pill visibility
  const handleScroll = useCallback(() => {
    setShowScrollPill(!isNearBottom());
  }, [isNearBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: scrollBehavior });
  }, [scrollBehavior]);

  // Empty state
  if (segments.length === 0) {
    return (
      <div ref={scrollRef} className="chat-timeline-empty">
        {emptyState ?? (
          <div className="chat-timeline-empty-text">
            What&apos;s on your mind?
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="chat-timeline-wrapper">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        className="chat-timeline-scroll"
      >
        <div className="chat-timeline-column">
          {segments.map((segment, idx) => (
            <TimelineSegment
              key={segment.id}
              segment={segment}
              isLast={idx === segments.length - 1}
              onRetry={segment.type === "error" ? onRetry : undefined}
              onSpeak={onSpeak}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {showScrollPill && (
        <button
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          className="scroll-pill-enter chat-scroll-pill"
        >
          <ChevronDown size={14} />
          New content below
        </button>
      )}
    </div>
  );
}
