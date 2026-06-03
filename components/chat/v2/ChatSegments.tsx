"use client";

/**
 * ChatSegments (v2) — the rich agent-run renderer: dispatches a TimelineSegment[]
 * (the deck's canonical agent model from lib/types/agentRun.ts, produced by
 * agentRunReducer) to the v2 leaves. This is the rich path (reasoning, tool
 * activity, artifacts, errors) that sits alongside the plain ChatTimeline.
 *
 * Pure/presentational + token-driven; Storybook feeds it mock segments (or a
 * reduced mock RunAction[] replay) to exercise every state with no live agent.
 */

import type { Artifact } from "@/lib/types/chat";
import type { TimelineSegment } from "@/lib/types/agentRun";

import { AgentMessage } from "./AgentMessage";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolActivityBlock } from "./ToolActivityBlock";
import { ArtifactBlock } from "./ArtifactBlock";
import { ErrorBlock } from "./ErrorBlock";
import { ApprovalRequest, type ApprovalStatus } from "./ApprovalRequest";

/** A pending human-in-the-loop tool approval (AGUI InterruptRequested). */
export interface PendingApproval {
  toolName: string;
  args?: Record<string, unknown>;
  message?: string;
  status?: ApprovalStatus;
  busy?: boolean;
  error?: string | null;
}

export interface ChatSegmentsProps {
  segments: TimelineSegment[];
  onRetry?: () => void;
  onSpeak?: (text: string) => void;
  onRun?: (code: string, language?: string) => void;
  onOpenCanvas?: (code: string, language?: string) => void;
  onSaveArtifact?: (artifact: Artifact) => void;
  /** When set, renders the approval gate at the end of the run. */
  pendingApproval?: PendingApproval;
  onApprove?: () => void;
  onReject?: (reason?: string) => void;
}

const META = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function ChatSegments({ segments, onRetry, onSpeak, onRun, onOpenCanvas, onSaveArtifact, pendingApproval, onApprove, onReject }: ChatSegmentsProps) {
  return (
    <div className="cd-segments flex flex-col gap-3" role="log" aria-live="polite">
      {segments.map((seg) => (
        <div key={seg.id} className="cd-segment">
          {seg.type === "user-message" ? (
            <UserBlock content={seg.content} uploads={seg.uploads} />
          ) : seg.type === "agent-reasoning" ? (
            <ReasoningBlock content={seg.content} isStreaming={seg.isStreaming} />
          ) : seg.type === "agent-activity" ? (
            <ToolActivityBlock steps={seg.steps} onRun={onRun} onOpenCanvas={onOpenCanvas} />
          ) : seg.type === "agent-message" ? (
            <AgentMessage content={seg.content} isStreaming={seg.isStreaming} complete={seg.complete} stopped={seg.stopped} onSpeak={onSpeak} onRun={onRun} onOpenCanvas={onOpenCanvas} />
          ) : seg.type === "artifact" ? (
            <ArtifactBlock artifact={seg.artifact} onSave={onSaveArtifact} />
          ) : seg.type === "error" ? (
            <ErrorBlock error={seg.error} retryable={seg.retryable} onRetry={onRetry} />
          ) : null}
        </div>
      ))}
      {pendingApproval && (
        <ApprovalRequest
          toolName={pendingApproval.toolName}
          args={pendingApproval.args}
          message={pendingApproval.message}
          status={pendingApproval.status}
          busy={pendingApproval.busy}
          error={pendingApproval.error}
          onApprove={() => onApprove?.()}
          onReject={(reason) => onReject?.(reason)}
        />
      )}
    </div>
  );
}

function UserBlock({ content, uploads }: { content: string; uploads?: { id: string; name: string; url?: string }[] }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {uploads && uploads.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {uploads.map((u) => (
            <span key={u.id} className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)", ...META }}>
              {u.name}
            </span>
          ))}
        </div>
      )}
      <div
        className="max-w-[85%] rounded-[var(--radius)] px-3 py-1.5 text-[var(--text-primary)]"
        style={{ background: "var(--bg-secondary)", fontFamily: "var(--font-sans)", fontSize: "var(--font-size-base)", lineHeight: "var(--lh-body, 1.5)" }}
      >
        {content}
      </div>
    </div>
  );
}

export default ChatSegments;
