"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { DojoEvent } from "@/lib/agui/dojo";

// =============================================================================
// Types
// =============================================================================

interface EventViewerProps {
  events: DojoEvent[];
  isRunning: boolean;
}

// =============================================================================
// Event Type Colors
// =============================================================================

const EVENT_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  // Run lifecycle
  RUN_STARTED: { bg: "rgba(59, 130, 246, 0.15)", text: "#60a5fa", icon: "▶" },
  RUN_FINISHED: { bg: "rgba(34, 197, 94, 0.15)", text: "#4ade80", icon: "✓" },
  RUN_ERROR: { bg: "rgba(239, 68, 68, 0.15)", text: "#f87171", icon: "✕" },

  // Messages
  TEXT_MESSAGE_START: { bg: "rgba(139, 92, 246, 0.15)", text: "#a78bfa", icon: "◀" },
  TEXT_MESSAGE_CONTENT: { bg: "rgba(139, 92, 246, 0.1)", text: "#c4b5fd", icon: "…" },
  TEXT_MESSAGE_END: { bg: "rgba(139, 92, 246, 0.15)", text: "#a78bfa", icon: "▶" },

  // State
  STATE_SNAPSHOT: { bg: "rgba(245, 158, 11, 0.15)", text: "#fbbf24", icon: "📸" },
  STATE_DELTA: { bg: "rgba(245, 158, 11, 0.1)", text: "#fcd34d", icon: "Δ" },

  // Tools
  TOOL_CALL_START: { bg: "rgba(16, 185, 129, 0.15)", text: "#34d399", icon: "🔧" },
  TOOL_CALL_ARGS: { bg: "rgba(16, 185, 129, 0.1)", text: "#6ee7b7", icon: "…" },
  TOOL_CALL_END: { bg: "rgba(16, 185, 129, 0.15)", text: "#34d399", icon: "✓" },

  // Activity
  ACTIVITY_PLAN: { bg: "rgba(99, 102, 241, 0.15)", text: "#818cf8", icon: "📋" },
  ACTIVITY_PROGRESS: { bg: "rgba(99, 102, 241, 0.1)", text: "#a5b4fc", icon: "⏳" },
  ACTIVITY_CHECKLIST: { bg: "rgba(99, 102, 241, 0.1)", text: "#a5b4fc", icon: "☑" },
  ACTIVITY_SEARCH: { bg: "rgba(99, 102, 241, 0.1)", text: "#a5b4fc", icon: "🔍" },

  // Reasoning
  REASONING_START: { bg: "rgba(236, 72, 153, 0.15)", text: "#f472b6", icon: "🧠" },
  REASONING_CONTENT: { bg: "rgba(236, 72, 153, 0.1)", text: "#f9a8d4", icon: "💭" },
  REASONING_END: { bg: "rgba(236, 72, 153, 0.15)", text: "#f472b6", icon: "✓" },

  // Interrupt
  INTERRUPT_REQUEST: { bg: "rgba(251, 146, 60, 0.15)", text: "#fb923c", icon: "✋" },
  INTERRUPT_RESPONSE: { bg: "rgba(251, 146, 60, 0.15)", text: "#fdba74", icon: "👆" },

  // Generative UI
  GENERATIVE_UI_FORM: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", icon: "📝" },

  // Meta
  META_THUMBS_UP: { bg: "rgba(34, 197, 94, 0.15)", text: "#4ade80", icon: "👍" },
  META_THUMBS_DOWN: { bg: "rgba(239, 68, 68, 0.15)", text: "#f87171", icon: "👎" },
  META_TAG: { bg: "rgba(168, 162, 158, 0.15)", text: "#a8a29e", icon: "🏷" },
};

const DEFAULT_COLOR = { bg: "rgba(113, 113, 122, 0.15)", text: "#a1a1aa", icon: "●" };

// =============================================================================
// EventViewer Component
// =============================================================================

export function EventViewer({ events, isRunning }: EventViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<string>("");

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  // Handle scroll to detect manual scrolling
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  // Toggle event expansion
  const toggleExpand = (index: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Filter events
  const filteredEvents = filter
    ? events.filter((e) => e.type.toLowerCase().includes(filter.toLowerCase()))
    : events;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter */}
      <div className="p-2 border-b border-[var(--border)]">
        <input
          type="text"
          placeholder="Filter events..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input text-xs py-1"
        />
      </div>

      {/* Event List */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-2 space-y-1"
      >
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            {isRunning ? (
              <>
                <div className="tool-spinner mb-2" />
                <span className="text-xs">Waiting for events...</span>
              </>
            ) : (
              <>
                <span className="text-2xl mb-2">📡</span>
                <span className="text-xs">Run a demo to see events</span>
              </>
            )}
          </div>
        ) : (
          filteredEvents.map((event, index) => (
            <EventRow
              key={index}
              event={event}
              index={index}
              isExpanded={expandedEvents.has(index)}
              onToggle={() => toggleExpand(index)}
            />
          ))
        )}
      </div>

      {/* Status Bar */}
      <div className="px-3 py-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-muted)]">
        <span>
          {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
          {filter && ` (filtered)`}
        </span>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1">
              <span className="status-dot status-dot-pending" />
              Streaming
            </span>
          )}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-0.5 rounded text-[10px] ${
              autoScroll
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            }`}
          >
            Auto-scroll
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// EventRow Component
// =============================================================================

interface EventRowProps {
  event: DojoEvent;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function EventRow({ event, index, isExpanded, onToggle }: EventRowProps) {
  const color = EVENT_COLORS[event.type] || DEFAULT_COLOR;
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Get preview of event data
  const getPreview = (): string => {
    const e = event as unknown as Record<string, unknown>;
    if (e.delta && typeof e.delta === "string") {
      return e.delta.slice(0, 40) + (e.delta.length > 40 ? "..." : "");
    }
    if (e.content && typeof e.content === "string") {
      return e.content.slice(0, 40) + (e.content.length > 40 ? "..." : "");
    }
    if (e.name) return String(e.name);
    if (e.title) return String(e.title);
    if (e.error) return String(e.error).slice(0, 40);
    return "";
  };

  const preview = getPreview();

  return (
    <div
      className="rounded-md overflow-hidden animate-fade-in"
      style={{ backgroundColor: color.bg }}
    >
      <button
        onClick={onToggle}
        className="w-full px-2 py-1.5 flex items-center gap-2 text-left hover:bg-black/5 transition-colors"
      >
        {/* Icon */}
        <span className="text-xs">{color.icon}</span>

        {/* Index */}
        <span className="text-[10px] font-mono text-[var(--text-muted)] w-5 flex-shrink-0">
          {index + 1}
        </span>

        {/* Event Type */}
        <span
          className="text-xs font-mono font-medium flex-shrink-0"
          style={{ color: color.text }}
        >
          {event.type}
        </span>

        {/* Preview */}
        {preview && !isExpanded && (
          <span className="text-[10px] text-[var(--text-muted)] truncate flex-1 ml-1">
            {preview}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-[9px] font-mono text-[var(--text-muted)] flex-shrink-0 ml-auto">
          {timestamp}
        </span>

        {/* Expand Chevron */}
        <ChevronRight
          className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-2 pb-2">
          <pre className="text-[10px] font-mono p-2 bg-[var(--bg-primary)] rounded border border-[var(--border)] overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
