"use client";

/**
 * ToolActivityBlock (v2) — renders an AgentActivitySegment: the tool calls the
 * agent ran, with per-step status (running/complete/error), args preview, and
 * duration. Multi-step blocks collapse with a summary. execute_code steps expose
 * Run / Open-in-canvas. Token-driven; lean-lifted from AgentActivityBlock +
 * ToolCallCard. This is the heart of "review what the agent did".
 */

import { useState } from "react";
import {
  ChevronDown, ChevronRight, CircleCheck, CircleX, FileText, FilePen,
  Search, SquareTerminal, Wrench, type LucideIcon,
} from "lucide-react";
import type { ActivityStep } from "@/lib/types/agentRun";

import { Button } from "./ui";

export interface ToolActivityBlockProps {
  steps: ActivityStep[];
  /** Run an execute_code step (bash etc.) in the terminal. */
  onRun?: (code: string, language?: string) => void;
  /** Open a step's code/result in the canvas. */
  onOpenCanvas?: (code: string, language?: string) => void;
  defaultExpanded?: boolean;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;
const TOOL_ICON: Record<string, LucideIcon> = {
  execute_code: SquareTerminal,
  run_command: SquareTerminal,
  web_search: Search,
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
};
const STATUS_COLOR: Record<ActivityStep["status"], string> = {
  running: "var(--warn, #fbbf24)",
  complete: "var(--ok, #34d399)",
  error: "var(--err, #f87171)",
};

function argPreview(args?: Record<string, unknown>): string {
  if (!args) return "";
  for (const k of ["prompt", "query", "command", "path", "file", "code", "url"]) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").slice(0, 80);
  }
  return "";
}

export function ToolActivityBlock({ steps, onRun, onOpenCanvas, defaultExpanded }: ToolActivityBlockProps) {
  const anyRunning = steps.some((s) => s.status === "running");
  const anyError = steps.some((s) => s.status === "error");
  const multi = steps.length > 1;
  const [expanded, setExpanded] = useState(defaultExpanded ?? (!multi || anyRunning));

  const summary = anyRunning
    ? `${steps.filter((s) => s.status === "running").length} running · ${steps.filter((s) => s.status === "complete").length} done`
    : anyError
      ? `${steps.length} tools · with errors`
      : `${steps.length} tool${steps.length === 1 ? "" : "s"} done`;

  return (
    <div className="cd-activity rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
      {multi && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
          style={MONO}
        >
          <Wrench size={13} />
          <span>{summary}</span>
          <span className="ml-auto">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        </button>
      )}
      {expanded && (
        <div className={multi ? "border-t px-1.5 py-1" : "px-1.5 py-1"} style={multi ? { borderColor: "var(--border-subtle)" } : undefined}>
          {steps.map((step) => (
            <StepRow key={step.toolCallId} step={step} onRun={onRun} onOpenCanvas={onOpenCanvas} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step, onRun, onOpenCanvas }: { step: ActivityStep; onRun?: ToolActivityBlockProps["onRun"]; onOpenCanvas?: ToolActivityBlockProps["onOpenCanvas"] }) {
  const Icon = TOOL_ICON[step.toolName] ?? Wrench;
  const preview = argPreview(step.args);
  const code = typeof step.args?.code === "string" ? (step.args.code as string) : undefined;
  const language = typeof step.args?.language === "string" ? (step.args.language as string) : undefined;
  const isCode = step.toolName === "execute_code" && code;

  return (
    <div className="px-1 py-1">
      <div className="flex items-center gap-2" style={MONO}>
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full${step.status === "running" ? " animate-pulse" : ""}`}
          style={{ background: STATUS_COLOR[step.status] }}
          aria-hidden="true"
        />
        <Icon size={13} className="shrink-0 text-[var(--text-secondary)]" />
        <span className="text-[var(--text-primary)]">{step.toolName}</span>
        {preview && <span className="min-w-0 truncate text-[var(--text-muted)]">{preview}</span>}
        {typeof step.durationMs === "number" && (
          <span className="ml-auto shrink-0 text-[var(--text-muted)]" style={{ opacity: 0.7 }}>
            {step.durationMs}ms
          </span>
        )}
        <span className="shrink-0" style={{ color: STATUS_COLOR[step.status] }} aria-label={`status ${step.status}`}>
          {step.status === "complete" ? <CircleCheck size={13} /> : step.status === "error" ? <CircleX size={13} /> : null}
        </span>
      </div>

      {isCode && (
        <div className="mt-1 ml-5">
          <pre
            className="overflow-x-auto rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-secondary)]"
            style={{ background: "var(--bg-inset, var(--bg))", ...MONO }}
          >
            <code>{code.length > 400 ? code.slice(0, 400) + "\n…" : code}</code>
          </pre>
          <div className="mt-1 flex gap-1">
            {onRun && (
              <Button variant="outline" size="sm" onClick={() => onRun(code, language)} style={{ ...MONO }}>
                run
              </Button>
            )}
            {onOpenCanvas && (
              <Button variant="outline" size="sm" onClick={() => onOpenCanvas(code, language)} style={{ ...MONO }}>
                canvas
              </Button>
            )}
          </div>
        </div>
      )}

      {step.result && (step.result.error || step.result.message) && (
        <div className="mt-1 ml-5 text-[var(--text-secondary)]" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>
          {step.result.error ? (
            <span style={{ color: "var(--err, #f87171)" }}>{step.result.error}</span>
          ) : (
            <span>{step.result.message}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolActivityBlock;
