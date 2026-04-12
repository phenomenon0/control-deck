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
    <article aria-label="Your message" className="timeline-enter-user tl-user-msg">
      {hasUploads && (
        <div className="tl-user-uploads">
          {segment.uploads!.map((upload) => (
            <span key={upload.id} className="tl-user-upload-tag">
              {upload.name}
            </span>
          ))}
        </div>
      )}
      <div className="tl-user-text">{segment.content}</div>
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
    <div className="timeline-enter-assistant tl-reasoning">
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
    <article aria-label="Agent response" className="timeline-enter-assistant tl-agent-msg">
      <RichText content={segment.content} />
      {segment.isStreaming && isLast && (
        <span className="animate-thinking-pulse tl-streaming-cursor" />
      )}
      {segment.complete && !segment.isStreaming && (
        <div className="run-complete-indicator tl-complete-label">
          <Check size={12} />
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
    <div className="timeline-enter-artifact tl-artifact">
      <div className="tl-artifact-card">
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
    <div role="alert" className="timeline-enter-assistant tl-error">
      <AlertCircle size={16} className="tl-error-icon" />
      <span className="tl-error-text">{segment.error}</span>
      {segment.retryable && onRetry && (
        <button onClick={onRetry} className="tl-error-retry">
          <RotateCcw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}
