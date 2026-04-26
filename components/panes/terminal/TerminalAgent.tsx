"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TerminalSession, TerminalSessionStatus } from "@/lib/terminal/types";

const TIMELINE_MIN = 220;
const TIMELINE_MAX = 720;

/**
 * Agent-integrated terminal layout: V2 of the wireframes.
 *
 * Split view with the terminal screen on the left (injected as `screen`) and
 * an AG-UI-style event timeline on the right. The mode strip above lets the
 * user pick manual / assist / autonomous approval behavior; `autoApprove`
 * drives the status chip in the topbar.
 */

export type AgentAutonomy = "manual" | "assist" | "autonomous";

export interface AgentTimelineEvent {
  id: string;
  t: string;
  kind: "user" | "plan" | "tool" | "await" | "deny" | "result" | "system";
  label: string;
  body?: string;
  result?: string;
}

export function TerminalAgent({
  session,
  status,
  autonomy,
  onAutonomyChange,
  threadId,
  stepCount,
  tokenCount,
  events,
  footprint,
  screen,
  proposedCommand,
  timelineWidth,
  onTimelineWidthChange,
}: {
  session: TerminalSession | null;
  status: TerminalSessionStatus | null;
  autonomy: AgentAutonomy;
  onAutonomyChange: (next: AgentAutonomy) => void;
  threadId: string | null;
  stepCount: number;
  tokenCount: number;
  events: AgentTimelineEvent[];
  footprint: { artifacts: number; writes: number; net: number };
  screen: ReactNode;
  proposedCommand?: {
    command: string;
    side_effects: string;
    onApprove: () => void;
    onEdit?: () => void;
    onDeny: () => void;
  } | null;
  timelineWidth: number;
  onTimelineWidthChange: (next: number) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const startDrag = useStartDrag(bodyRef, timelineWidth, onTimelineWidthChange);

  return (
    <>
      <div className="tp2-mode-strip">
        <span className="tp2-mode-label">Mode</span>
        <div className="tp2-mode-toggle">
          {(["manual", "assist", "autonomous"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`tp2-mode-opt${autonomy === mode ? " tp2-mode-opt--on" : ""}`}
              onClick={() => onAutonomyChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <span className="tp2-mode-spacer" />
        {threadId && <span className="tp2-chip tp2-chip--mono">thread: {threadId.slice(0, 6)}</span>}
        <span className="tp2-chip tp2-chip--mono">steps {stepCount}</span>
        <span className="tp2-chip tp2-chip--mono">
          tokens {tokenCount < 1000 ? tokenCount : `${(tokenCount / 1000).toFixed(1)}k`}
        </span>
      </div>
      <div ref={bodyRef} className="tp2-body tp2-body--agent">
        <div className="tp2-screen-wrap tp2-screen-wrap--agent">
          {screen}
          {proposedCommand && <ProposedCommandCard proposal={proposedCommand} />}
        </div>
        <div
          className="tp2-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agent timeline"
          aria-valuenow={timelineWidth}
          aria-valuemin={TIMELINE_MIN}
          aria-valuemax={TIMELINE_MAX}
          onMouseDown={startDrag}
          onDoubleClick={() => onTimelineWidthChange(300)}
        />
        <aside className="tp2-timeline" style={{ width: timelineWidth }}>
          <div className="tp2-timeline-head">
            <span className="tp2-rail-label">Agent Timeline</span>
            <span className={`tp2-chip tp2-chip--mono${status === "running" ? " tp2-chip--live" : ""}`}>
              {status === "running" ? "live" : status ?? "idle"}
            </span>
          </div>
          <div className="tp2-timeline-body">
            {events.length === 0 ? (
              <div className="tp2-timeline-empty">
                {session
                  ? "Agent events will stream here as the session speaks."
                  : "No agent session. Launch Claude or OpenCode from the tab bar."}
              </div>
            ) : (
              events.map((ev, i) => (
                <TimelineRow key={ev.id} event={ev} isLast={i === events.length - 1} />
              ))
            )}
          </div>
          <div className="tp2-timeline-foot">
            <span>artifacts {footprint.artifacts}</span>
            <span>·</span>
            <span>writes {footprint.writes}</span>
            <span>·</span>
            <span>net {footprint.net}</span>
          </div>
        </aside>
      </div>
    </>
  );
}

function TimelineRow({ event, isLast }: { event: AgentTimelineEvent; isLast: boolean }) {
  const dotCls =
    event.kind === "user"
      ? "tp2-t-dot tp2-t-dot--user"
      : event.kind === "await"
        ? "tp2-t-dot tp2-t-dot--await"
        : event.kind === "deny"
          ? "tp2-t-dot tp2-t-dot--deny"
          : "tp2-t-dot";
  const boxCls =
    event.kind === "await"
      ? "tp2-t-box tp2-t-box--await"
      : event.kind === "deny"
        ? "tp2-t-box tp2-t-box--deny"
        : "tp2-t-box";
  return (
    <div className="tp2-t-row">
      <div className="tp2-t-time">{event.t}</div>
      <div className="tp2-t-spine">
        <div className={dotCls} />
        {!isLast && <div className="tp2-t-line" />}
      </div>
      <div className={boxCls}>
        <div className="tp2-t-label">{event.label}</div>
        {event.body && <div className="tp2-t-body">{event.body}</div>}
        {event.result && <div className="tp2-t-result">→ {event.result}</div>}
      </div>
    </div>
  );
}

function ProposedCommandCard({
  proposal,
}: {
  proposal: NonNullable<Parameters<typeof TerminalAgent>[0]["proposedCommand"]>;
}) {
  return (
    <div className="tp2-proposal">
      <div className="tp2-proposal-head">
        <span className="tp2-chip tp2-chip--solid">PROPOSED</span>
        <span className="tp2-proposal-label">agent wants to run</span>
        <span className="tp2-proposal-grow" />
        <span className="tp2-proposal-label">awaits approval</span>
      </div>
      <div className="tp2-proposal-cmd">$ {proposal.command}</div>
      <div className="tp2-proposal-actions">
        <button type="button" className="tp2-btn tp2-btn--primary" onClick={proposal.onApprove}>
          approve <kbd className="tp2-kbd tp2-kbd--on-dark">⏎</kbd>
        </button>
        {proposal.onEdit && (
          <button type="button" className="tp2-btn" onClick={proposal.onEdit}>
            edit <kbd className="tp2-kbd">⌘E</kbd>
          </button>
        )}
        <button type="button" className="tp2-btn" onClick={proposal.onDeny}>
          deny <kbd className="tp2-kbd">⎋</kbd>
        </button>
        <span className="tp2-proposal-grow" />
        <span className="tp2-proposal-label">{proposal.side_effects}</span>
      </div>
    </div>
  );
}

/**
 * Derive a rolling timeline from terminal output. Lossy — we don't parse
 * claude/opencode TUI for semantic events yet. This keeps the timeline
 * alive with session-lifecycle + size markers so the UI is honest rather
 * than faked.
 */
export function useAgentTimeline(
  session: TerminalSession | null,
  lastChunkAt: number | null,
  chunkCount: number,
): { events: AgentTimelineEvent[]; stepCount: number; tokenCount: number } {
  const [events, setEvents] = useState<AgentTimelineEvent[]>([]);
  const openedFor = useRef<string | null>(null);
  const tickFor = useRef<{ id: string; count: number } | null>(null);

  useEffect(() => {
    if (!session) {
      setEvents([]);
      openedFor.current = null;
      tickFor.current = null;
      return;
    }
    if (openedFor.current !== session.id) {
      openedFor.current = session.id;
      tickFor.current = { id: session.id, count: 0 };
      setEvents([
        {
          id: `${session.id}:start`,
          t: "0s",
          kind: "system",
          label: "session start",
          body: `${session.profile} · ${session.label}`,
        },
      ]);
    }
  }, [session]);

  useEffect(() => {
    if (!session || !lastChunkAt) return;
    const tick = tickFor.current;
    if (!tick || tick.id !== session.id) return;
    tick.count = chunkCount;
    // Heartbeat every 10 output chunks so the timeline shows activity
    // without swamping — coarse by design.
    if (chunkCount > 0 && chunkCount % 10 === 0) {
      setEvents((prev) => [
        ...prev.slice(-40),
        {
          id: `${session.id}:tick:${chunkCount}`,
          t: formatTick(session.startedAt),
          kind: "result",
          label: "output",
          body: `${chunkCount} chunks streamed`,
        },
      ]);
    }
  }, [session, lastChunkAt, chunkCount]);

  useEffect(() => {
    if (!session) return;
    if (session.status === "exited" || session.status === "error") {
      setEvents((prev) => [
        ...prev,
        {
          id: `${session.id}:end:${session.lastActiveAt}`,
          t: formatTick(session.startedAt),
          kind: session.status === "error" ? "deny" : "system",
          label: session.status === "error" ? "session error" : "session end",
          body: session.error ?? (session.exitCode !== null ? `exit ${session.exitCode}` : undefined),
        },
      ]);
    }
  }, [session]);

  return { events, stepCount: events.length, tokenCount: chunkCount * 48 };
}

function useStartDrag(
  bodyRef: React.RefObject<HTMLDivElement | null>,
  width: number,
  onChange: (next: number) => void,
) {
  const widthRef = useRef(width);
  useEffect(() => { widthRef.current = width; }, [width]);

  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const body = bodyRef.current;
      if (!body) return;
      const right = body.getBoundingClientRect().right;

      const handleMove = (ev: MouseEvent) => {
        const next = Math.min(TIMELINE_MAX, Math.max(TIMELINE_MIN, right - ev.clientX));
        onChange(next);
      };
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [bodyRef, onChange],
  );
}

function formatTick(startedAt: string): string {
  const delta = Math.max(0, Date.now() - Date.parse(startedAt));
  if (delta < 1000) return `${delta}ms`;
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)}s`;
  return `${Math.floor(delta / 60_000)}m`;
}
