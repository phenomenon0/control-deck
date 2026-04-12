"use client";

import type {
  TimelineSegment as TSegment,
  UserMessageSegment,
  AgentReasoningSegment,
  AgentActivitySegment,
  AgentMessageSegment,
  ArtifactSegment,
  ErrorSegment,
} from "@/lib/types/agentRun";
import { Check, AlertCircle, RotateCcw } from "lucide-react";
import { ReasoningBubble } from "./ReasoningDisplay";
import { AgentActivityBlock } from "./AgentActivityBlock";
import { ArtifactRenderer } from "./ArtifactRenderer";
import { RichText } from "./RichText";

// =============================================================================
// TimelineSegment — discriminated union router (SURFACE.md §5.1)
//
// Routes each segment type to the correct renderer. Handles entrance
// animations per BEHAVIOR.md §3.2. Pure presentational — no state
// management, no data fetching.
// =============================================================================

interface TimelineSegmentProps {
  segment: TSegment;
  /** Whether this is the most recent segment (affects streaming indicators) */
  isLast?: boolean;
  /** Callback when user clicks Retry on an error segment */
  onRetry?: () => void;
}

export function TimelineSegment({ segment, isLast = false, onRetry }: TimelineSegmentProps) {
  switch (segment.type) {
    case "user-message":
      return <UserMessageBlock segment={segment} />;
    case "agent-reasoning":
      return <AgentReasoningBlock segment={segment} isLast={isLast} />;
    case "agent-activity":
      return <AgentActivityBlock segment={segment} />;
    case "agent-message":
      return <AgentTextBlock segment={segment} isLast={isLast} />;
    case "artifact":
      return <ArtifactBlock segment={segment} />;
    case "error":
      return <ErrorBlock segment={segment} onRetry={onRetry} />;
    default:
      return null;
  }
}

// =============================================================================
// User Message — right-aligned subtle bubble (DESIGN.md §3.1)
// =============================================================================

function UserMessageBlock({ segment }: { segment: UserMessageSegment }) {
  const hasUploads = segment.uploads && segment.uploads.length > 0;

  return (
    <article
      aria-label="Your message"
      className="timeline-enter-user"
      style={{
        maxWidth: "85%",
        marginLeft: "auto",
        background: "rgba(var(--accent-rgb), 0.08)",
        border: "1px solid rgba(var(--accent-rgb), 0.12)",
        borderRadius: "var(--radius-lg, 10px) var(--radius-lg, 10px) var(--radius-sm, 4px) var(--radius-lg, 10px)",
        padding: "var(--sp-3, 12px) var(--sp-4, 16px)",
        marginBottom: "var(--sp-3, 12px)",
      }}
    >
      {/* Upload thumbnails */}
      {hasUploads && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {segment.uploads!.map((upload) => (
            <span
              key={upload.id}
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                background: "rgba(255, 255, 255, 0.04)",
                padding: "2px 8px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
              }}
            >
              {upload.name}
            </span>
          ))}
        </div>
      )}

      {/* Message text */}
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "var(--text-primary)",
        }}
      >
        {segment.content}
      </div>
    </article>
  );
}

// =============================================================================
// Agent Reasoning — collapsible thinking bubble (DESIGN.md §3.5)
// =============================================================================

function AgentReasoningBlock({
  segment,
  isLast,
}: {
  segment: AgentReasoningSegment;
  isLast: boolean;
}) {
  return (
    <div
      className="timeline-enter-assistant"
      style={{ marginBottom: "var(--sp-2, 8px)", maxWidth: "90%" }}
    >
      <ReasoningBubble
        content={segment.content}
        isStreaming={segment.isStreaming}
        defaultCollapsed={!isLast}
      />
    </div>
  );
}

// =============================================================================
// Agent Text — flat left-aligned text, streaming cursor (DESIGN.md §3.1)
// =============================================================================

function AgentTextBlock({
  segment,
  isLast,
}: {
  segment: AgentMessageSegment;
  isLast: boolean;
}) {
  return (
    <article
      aria-label="Agent response"
      className="timeline-enter-assistant"
      style={{
        maxWidth: "90%",
        marginBottom: "var(--sp-2, 8px)",
        padding: "var(--sp-2, 8px) 0",
      }}
    >
      <RichText content={segment.content} />
      {/* Streaming cursor */}
      {segment.isStreaming && isLast && (
        <span
          className="animate-thinking-pulse"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
            marginLeft: 4,
            verticalAlign: "middle",
          }}
        />
      )}
      {/* Completion indicator (BEHAVIOR.md §3.4 step 5) */}
      {segment.complete && !segment.isStreaming && (
        <div
          className="run-complete-indicator"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 8,
            fontSize: 11,
            color: "var(--text-tertiary)",
          }}
        >
          <Check
            size={12}
            style={{ color: "var(--agent-done)" }}
          />
          <span>Complete</span>
        </div>
      )}
    </article>
  );
}

// =============================================================================
// Artifact — prominent card (DESIGN.md §3.3)
// =============================================================================

function ArtifactBlock({ segment }: { segment: ArtifactSegment }) {
  return (
    <div
      className="timeline-enter-artifact"
      style={{
        marginBottom: "var(--sp-3, 12px)",
      }}
    >
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg, 10px)",
          overflow: "hidden",
        }}
      >
        <ArtifactRenderer artifact={segment.artifact} />
      </div>
    </div>
  );
}

// =============================================================================
// Error — inline error block with retry (BEHAVIOR.md §7.1)
// =============================================================================

function ErrorBlock({
  segment,
  onRetry,
}: {
  segment: ErrorSegment;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="timeline-enter-assistant"
      style={{
        background: "var(--error-muted)",
        borderLeft: "2px solid var(--error)",
        borderRadius: "0 var(--radius-md, 6px) var(--radius-md, 6px) 0",
        padding: "var(--sp-3, 12px) var(--sp-4, 16px)",
        margin: "var(--sp-3, 12px) 0",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <AlertCircle
        size={16}
        style={{ color: "var(--error)", flexShrink: 0 }}
      />
      <span
        style={{
          flex: 1,
          fontSize: 13,
          color: "var(--text-primary)",
          lineHeight: 1.5,
        }}
      >
        {segment.error}
      </span>
      {segment.retryable && onRetry && (
        <button
          onClick={onRetry}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--accent)",
            background: "var(--accent-muted)",
            border: "1px solid var(--border-accent)",
            borderRadius: 9999,
            cursor: "pointer",
            flexShrink: 0,
            transition: "background var(--t-micro, 80ms) ease",
          }}
        >
          <RotateCcw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}
