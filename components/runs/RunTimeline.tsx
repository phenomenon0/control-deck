"use client";

import { useState, useMemo, type ReactElement } from "react";
import { ChevronRight, MessageSquare, Wrench, AlertCircle, Play, CheckCircle2 } from "lucide-react";
import { PayloadViewer } from "@/components/inspector/PayloadViewer";
import type { DeckPayload } from "@/lib/agui/payload";

interface RunEvent {
  type: string;
  timestamp: string;
  toolCallId?: string;
  toolName?: string;
  args?: DeckPayload;
  result?: DeckPayload;
  success?: boolean;
  messageId?: string;
  delta?: string;
  error?: { message: string; code?: string };
  [key: string]: unknown;
}

type Step =
  | {
      kind: "tool";
      id: string;
      name: string;
      startedAt: number;
      endedAt?: number;
      args?: DeckPayload;
      result?: DeckPayload;
      success?: boolean;
    }
  | {
      kind: "message";
      id: string;
      startedAt: number;
      endedAt?: number;
      text: string;
    }
  | { kind: "run_started"; at: number; model?: string }
  | { kind: "run_finished"; at: number }
  | { kind: "run_error"; at: number; message: string };

function fmtRelative(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(2)}s`;
  return `+${(ms / 60_000).toFixed(1)}m`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Fold raw AG-UI events into higher-level "steps" the user reasons about:
 * assistant messages, tool calls, and run lifecycle markers. Drops the
 * per-delta text fragments (collapsed into the message) and the per-arg
 * tool deltas (collapsed into the tool step).
 */
function buildSteps(events: RunEvent[]): Step[] {
  const byMessage: Record<string, { startedAt: number; endedAt?: number; text: string }> = {};
  const byTool: Record<
    string,
    { name: string; startedAt: number; endedAt?: number; args?: DeckPayload; result?: DeckPayload; success?: boolean }
  > = {};
  const steps: Step[] = [];

  for (const evt of events) {
    const t = new Date(evt.timestamp).getTime();
    switch (evt.type) {
      case "RunStarted":
        steps.push({ kind: "run_started", at: t, model: (evt as RunEvent & { model?: string }).model });
        break;
      case "RunFinished":
        steps.push({ kind: "run_finished", at: t });
        break;
      case "RunError":
        steps.push({ kind: "run_error", at: t, message: evt.error?.message ?? "error" });
        break;
      case "TextMessageStart":
        if (evt.messageId) byMessage[evt.messageId] = { startedAt: t, text: "" };
        break;
      case "TextMessageContent":
        if (evt.messageId && byMessage[evt.messageId] && evt.delta) {
          byMessage[evt.messageId].text += evt.delta;
        }
        break;
      case "TextMessageEnd":
        if (evt.messageId && byMessage[evt.messageId]) {
          byMessage[evt.messageId].endedAt = t;
          const m = byMessage[evt.messageId];
          steps.push({ kind: "message", id: evt.messageId, startedAt: m.startedAt, endedAt: t, text: m.text });
        }
        break;
      case "ToolCallStart":
        if (evt.toolCallId) byTool[evt.toolCallId] = { name: evt.toolName ?? "unknown", startedAt: t };
        break;
      case "ToolCallArgs":
        if (evt.toolCallId && byTool[evt.toolCallId]) byTool[evt.toolCallId].args = evt.args;
        break;
      case "ToolCallResult":
        if (evt.toolCallId && byTool[evt.toolCallId]) {
          const tc = byTool[evt.toolCallId];
          tc.endedAt = t;
          tc.result = evt.result;
          tc.success = evt.success;
          steps.push({
            kind: "tool",
            id: evt.toolCallId,
            name: tc.name,
            startedAt: tc.startedAt,
            endedAt: t,
            args: tc.args,
            result: tc.result,
            success: tc.success,
          });
        }
        break;
    }
  }

  // Any messages/tools that never completed still render, in order
  for (const [id, m] of Object.entries(byMessage)) {
    if (!steps.some((s) => s.kind === "message" && s.id === id)) {
      steps.push({ kind: "message", id, startedAt: m.startedAt, text: m.text });
    }
  }
  for (const [id, tc] of Object.entries(byTool)) {
    if (!steps.some((s) => s.kind === "tool" && s.id === id)) {
      steps.push({
        kind: "tool",
        id,
        name: tc.name,
        startedAt: tc.startedAt,
        args: tc.args,
      });
    }
  }

  return steps.sort((a, b) => {
    const at = "at" in a ? a.at : a.startedAt;
    const bt = "at" in b ? b.at : b.startedAt;
    return at - bt;
  });
}

export function RunTimeline({ events }: { events: RunEvent[] }) {
  const steps = useMemo(() => buildSteps(events), [events]);
  const origin = steps.length > 0 ? ("at" in steps[0] ? steps[0].at : steps[0].startedAt) : 0;

  if (steps.length === 0) {
    return <div className="text-sm text-[var(--text-muted)]">No timeline events.</div>;
  }

  return (
    <ol className="relative border-l border-[var(--border)] ml-2 space-y-4">
      {steps.map((step, i) => (
        <TimelineRow key={`${i}-${step.kind}`} step={step} origin={origin} />
      ))}
    </ol>
  );
}

function TimelineRow({ step, origin }: { step: Step; origin: number }) {
  const [open, setOpen] = useState(step.kind === "tool" && step.success === false);

  const start = "at" in step ? step.at : step.startedAt;
  const end = "at" in step ? step.at : step.endedAt;
  const relative = fmtRelative(start - origin);
  const duration = end && end > start ? fmtDuration(end - start) : null;

  const marker = markerFor(step);

  return (
    <li className="ml-4 pl-2">
      <span
        className={`absolute -left-[7px] w-3 h-3 rounded-full border border-[var(--bg-primary)] ${marker.dot}`}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left flex items-center gap-2 py-1 group"
      >
        <ChevronRight
          className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${open ? "rotate-90" : ""}`}
        />
        {marker.icon}
        <span className="text-sm text-[var(--text-primary)] truncate">{summaryFor(step)}</span>
        <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)] whitespace-nowrap">
          {relative}
          {duration ? ` · ${duration}` : ""}
        </span>
      </button>
      {open && <div className="mt-2 ml-5 space-y-2">{detailFor(step)}</div>}
    </li>
  );
}

function markerFor(step: Step): { dot: string; icon: ReactElement } {
  switch (step.kind) {
    case "tool":
      return {
        dot:
          step.success === false
            ? "bg-[var(--error)]"
            : step.endedAt
              ? "bg-[var(--success)]"
              : "bg-[var(--accent)]",
        icon: <Wrench className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      };
    case "message":
      return {
        dot: step.endedAt ? "bg-[var(--text-secondary)]" : "bg-[var(--accent)]",
        icon: <MessageSquare className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      };
    case "run_started":
      return { dot: "bg-[var(--accent)]", icon: <Play className="w-3.5 h-3.5 text-[var(--text-muted)]" /> };
    case "run_finished":
      return { dot: "bg-[var(--success)]", icon: <CheckCircle2 className="w-3.5 h-3.5 text-[var(--text-muted)]" /> };
    case "run_error":
      return { dot: "bg-[var(--error)]", icon: <AlertCircle className="w-3.5 h-3.5 text-[var(--error)]" /> };
  }
}

function summaryFor(step: Step): string {
  switch (step.kind) {
    case "tool":
      return step.name;
    case "message":
      return step.text.slice(0, 80) || "(assistant message)";
    case "run_started":
      return `Run started${step.model ? ` · ${step.model}` : ""}`;
    case "run_finished":
      return "Run finished";
    case "run_error":
      return `Run error: ${step.message}`;
  }
}

function detailFor(step: Step): ReactElement | null {
  switch (step.kind) {
    case "tool":
      return (
        <>
          {step.args && <PayloadViewer payload={step.args} label="Args" maxPreviewLines={3} />}
          {step.result && (
            <PayloadViewer payload={step.result} label="Result" defaultExpanded maxPreviewLines={8} />
          )}
          {!step.args && !step.result && <div className="text-xs text-[var(--text-muted)]">Executing...</div>}
        </>
      );
    case "message":
      return (
        <pre className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap font-sans">{step.text}</pre>
      );
    case "run_error":
      return <div className="text-sm text-[var(--error)]">{step.message}</div>;
    default:
      return null;
  }
}
