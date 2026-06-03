"use client";

/**
 * ChatSegments (v2) — the rich agent-run renderer: dispatches a TimelineSegment[]
 * (the deck's canonical agent model from lib/types/agentRun.ts, produced by
 * agentRunReducer) to the v2 leaves. This is the rich path (reasoning, tool
 * activity, artifacts, errors) that sits alongside the plain ChatTimeline.
 *
 * Pure/presentational + token-driven; Storybook feeds it mock segments (or a
 * reduced mock RunAction[] replay) to exercise every state with no live agent.
 *
 * Optional `virtualize`: for long live runs, window the transcript so only the
 * visible blocks mount. Unlike the prose ChatTimeline, segments aren't pure text
 * (tool activity, artifacts, code/chart blocks), so this is a HYBRID — Pretext
 * seeds an accurate height for the prose segments and a coarse constant for the
 * rich ones, then @tanstack/react-virtual's measured element heights correct
 * every row. Off by default (the non-virtual path is unchanged).
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { measureBlock } from "@/lib/text/measure";
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

interface SegmentHandlers {
  onRetry?: () => void;
  onSpeak?: (text: string) => void;
  onRun?: (code: string, language?: string) => void;
  onOpenCanvas?: (code: string, language?: string) => void;
  onSaveArtifact?: (artifact: Artifact) => void;
}

export interface ChatSegmentsProps extends SegmentHandlers {
  segments: TimelineSegment[];
  /** When set, renders the approval gate at the end of the run. */
  pendingApproval?: PendingApproval;
  onApprove?: () => void;
  onReject?: (reason?: string) => void;
  /** Window the transcript (only mount visible blocks). Owns its own scroll. */
  virtualize?: boolean;
  /** Sizing for the virtualized scroll container (e.g. "min-h-0 flex-1"). */
  className?: string;
}

const META = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

/** Dispatch one segment to its leaf — shared by the flow and virtualized paths. */
function renderSegment(seg: TimelineSegment, h: SegmentHandlers): ReactNode {
  switch (seg.type) {
    case "user-message":
      return <UserBlock content={seg.content} uploads={seg.uploads} />;
    case "agent-reasoning":
      return <ReasoningBlock content={seg.content} isStreaming={seg.isStreaming} />;
    case "agent-activity":
      return <ToolActivityBlock steps={seg.steps} onRun={h.onRun} onOpenCanvas={h.onOpenCanvas} />;
    case "agent-message":
      return (
        <AgentMessage
          content={seg.content}
          isStreaming={seg.isStreaming}
          complete={seg.complete}
          stopped={seg.stopped}
          onSpeak={h.onSpeak}
          onRun={h.onRun}
          onOpenCanvas={h.onOpenCanvas}
        />
      );
    case "artifact":
      return <ArtifactBlock artifact={seg.artifact} onSave={h.onSaveArtifact} />;
    case "error":
      return <ErrorBlock error={seg.error} retryable={seg.retryable} onRetry={h.onRetry} />;
    default:
      return null;
  }
}

export function ChatSegments(props: ChatSegmentsProps) {
  const { segments, pendingApproval, onApprove, onReject, virtualize, className, ...handlers } = props;

  const approval = pendingApproval && (
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
  );

  if (virtualize) {
    return (
      <VirtualSegments segments={segments} handlers={handlers} approval={approval} className={className} />
    );
  }

  return (
    <div className="cd-segments flex flex-col gap-3" role="log" aria-live="polite">
      {segments.map((seg) => (
        <div key={seg.id} className="cd-segment">
          {renderSegment(seg, handlers)}
        </div>
      ))}
      {approval}
    </div>
  );
}

// ── Virtualized transcript ───────────────────────────────────────────────────

interface RowMetrics {
  font: string;
  lineHeight: number;
  width: number;
}

const MAX_CONTENT_WIDTH = 768; // max-w-3xl

/** Coarse height seeds for non-prose segments (measured element corrects them). */
function seedHeight(seg: TimelineSegment, m: RowMetrics): number {
  const prose = (text: string, widthFactor = 1, chrome = 24) =>
    Math.ceil((measureBlock(text || " ", m.font, m.width * widthFactor, m.lineHeight)?.height ?? m.lineHeight) + chrome);
  switch (seg.type) {
    case "user-message":
      return prose(seg.content, 0.85, 32) + (seg.uploads?.length ? 28 : 0);
    case "agent-message":
      return prose(seg.content, 1, 24);
    case "agent-reasoning":
      return 80;
    case "agent-activity":
      return 40 + (seg.steps?.length ?? 1) * 30;
    case "artifact":
      return 220;
    case "error":
      return 52;
    default:
      return 60;
  }
}

function VirtualSegments({
  segments,
  handlers,
  approval,
  className,
}: {
  segments: TimelineSegment[];
  handlers: SegmentHandlers;
  approval: ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<RowMetrics | null>(null);
  const pinnedRef = useRef(true);

  const hasApproval = Boolean(approval);
  const count = segments.length + (hasApproval ? 1 : 0);
  const last = segments[segments.length - 1];
  // Re-anchor when the run grows or the streaming tail changes.
  const tailSig = `${segments.length}:${last?.type ?? ""}:${"content" in (last ?? {}) ? (last as { content?: string }).content?.length ?? 0 : 0}:${hasApproval}`;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      const weight = cs.fontWeight && cs.fontWeight !== "400" && cs.fontWeight !== "normal" ? `${cs.fontWeight} ` : "";
      const fontSize = parseFloat(cs.fontSize) || 15;
      const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
      const width = Math.max(1, Math.min(el.clientWidth, MAX_CONTENT_WIDTH) - 32); // px-4 gutters
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
    getItemKey: (i) => (i < segments.length ? segments[i].id : "approval"),
    estimateSize: (i) => {
      const gap = i === 0 ? 0 : 12; // gap-3 between blocks
      if (i >= segments.length) return 132 + gap; // approval gate
      if (!metrics) return 72 + gap;
      return seedHeight(segments[i], metrics) + gap;
    },
  });

  useLayoutEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  useLayoutEffect(() => {
    if (pinnedRef.current && count > 0) {
      virtualizer.scrollToIndex(count - 1, { align: "end" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailSig, metrics]);

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
      className={`cd-segments overflow-y-auto ${className ?? ""}`}
      role="log"
      aria-live="polite"
    >
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {items.map((vi) => {
          const isApproval = vi.index >= segments.length;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
            >
              {/* center + max-width like the non-virtual surface; gap-3 as padding inside the box */}
              <div className={`mx-auto max-w-3xl px-4 ${vi.index === 0 ? "pt-4" : "pt-3"} ${isApproval ? "pb-4" : ""}`}>
                <div className="cd-segment">{isApproval ? approval : renderSegment(segments[vi.index], handlers)}</div>
              </div>
            </div>
          );
        })}
      </div>
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
