"use client";

import type {
  TimelineSegment as TSegment,
  UserMessageSegment,
  AgentReasoningSegment,
  AgentActivitySegment,
  AgentMessageSegment,
  ArtifactSegment,
} from "@/lib/types/agentRun";
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
}

export function TimelineSegment({ segment, isLast = false }: TimelineSegmentProps) {
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
    <div
      className="timeline-enter-user"
      style={{
        maxWidth: "85%",
        marginLeft: "auto",
        background: "rgba(94, 106, 210, 0.08)",
        border: "1px solid rgba(94, 106, 210, 0.12)",
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
    </div>
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
    <div
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
    </div>
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
