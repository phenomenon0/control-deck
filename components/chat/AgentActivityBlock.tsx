"use client";

import { useState } from "react";
import {
  ChevronDown,
  Wrench,
  Search,
  Code,
  Image,
  Volume2,
  Sparkles,
  Check,
  Play,
  Terminal as TerminalIcon,
  FileText,
  FileEdit,
  FolderOpen,
  Mouse,
  Globe,
} from "lucide-react";
import type { ActivityStep, AgentActivitySegment } from "@/lib/types/agentRun";
import { formatDuration } from "@/lib/constants/status";
import { truncate } from "@/lib/utils";
import { openCanvas } from "@/lib/canvas";

const TOOL_ICONS: Record<string, { icon: typeof Wrench; label: string }> = {
  generate_image: { icon: Image, label: "Image" },
  edit_image: { icon: Image, label: "Edit image" },
  generate_audio: { icon: Volume2, label: "Audio" },
  image_to_3d: { icon: Play, label: "3D model" },
  analyze_image: { icon: Image, label: "Vision" },
  web_search: { icon: Globe, label: "Search" },
  glyph_motif: { icon: Sparkles, label: "Glyph" },
  execute_code: { icon: Code, label: "Run code" },
  vector_search: { icon: Search, label: "Lookup" },
  vector_store: { icon: Search, label: "Store" },
  bash: { icon: TerminalIcon, label: "Shell" },
  sh: { icon: TerminalIcon, label: "Shell" },
  read: { icon: FileText, label: "Read" },
  write: { icon: FileEdit, label: "Write" },
  edit: { icon: FileEdit, label: "Edit" },
  glob: { icon: FolderOpen, label: "Glob" },
  grep: { icon: Search, label: "Grep" },
  skill_view: { icon: Sparkles, label: "Skill" },
  workspace_list_panes: { icon: FolderOpen, label: "Panes" },
  workspace_pane_call: { icon: Mouse, label: "Pane" },
  workspace_open_pane: { icon: FolderOpen, label: "Open pane" },
  workspace_focus_pane: { icon: Mouse, label: "Focus pane" },
};

function getToolConfig(toolName: string) {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName];
  if (toolName.startsWith("native_")) return { icon: Mouse, label: toolName.replace("native_", "") };
  if (toolName.startsWith("workspace_")) return { icon: FolderOpen, label: toolName.replace("workspace_", "") };
  return { icon: Wrench, label: toolName };
}

function StepStatusBadge({ status }: { status: ActivityStep["status"] }) {
  const label = status === "complete" ? "done" : status;
  return (
    <span
      className={`activity-badge activity-badge--${status}${status === "running" ? " activity-badge-shimmer" : ""}`}
    >
      {label}
    </span>
  );
}

function ActivityStepRow({ step, count }: { step: ActivityStep; count?: number }) {
  const config = getToolConfig(step.toolName);
  const Icon = config.icon;
  const detail = step.args ? getStepDetail(step.toolName, step.args) : null;

  const iconClass = `activity-step-icon${
    step.status === "running" ? " activity-step-icon--running" :
    step.status === "error" ? " activity-step-icon--error" : ""
  }`;

  // execute_code gets a code-block preview + a Play button. The agent
  // already ran it server-side; clicking Play re-runs the same source in
  // the Canvas surface so the user can iterate on it.
  const codeArg =
    step.toolName === "execute_code" && step.args && typeof step.args.code === "string"
      ? (step.args.code as string)
      : null;
  const languageArg =
    step.args && typeof step.args.language === "string"
      ? (step.args.language as string)
      : "python";

  return (
    <div className="activity-step-wrap">
      <div className="activity-step">
        <Icon size={14} className={iconClass} />
        <span className="activity-step-label">{config.label}</span>
        {count && count > 1 && (
          <span className="activity-step-count">×{count}</span>
        )}
        {detail && !codeArg && (
          <span className={`activity-step-arg${detail.mono ? " activity-step-arg--mono" : ""}`}>
            {detail.text.length > 60 ? truncate(detail.text, 60) : detail.text}
          </span>
        )}
        <span className="activity-step-meta">
          {step.durationMs != null && step.status !== "running" && (
            <span className="activity-step-duration">
              {formatDuration(step.durationMs)}
            </span>
          )}
          <StepStatusBadge status={step.status} />
        </span>
      </div>

      {codeArg && (
        <div className="activity-codeblock">
          <div className="activity-codeblock-head">
            <span className="activity-codeblock-lang">{languageArg}</span>
            <button
              type="button"
              className="activity-codeblock-play"
              title="Run this code in Canvas"
              onClick={() => {
                openCanvas({
                  language: languageArg,
                  code: codeArg,
                  title: `${languageArg} from chat`,
                  autoRun: true,
                });
              }}
            >
              <Play size={12} /> Run in Canvas
            </button>
          </div>
          <pre className="activity-codeblock-body">
            <code>{codeArg}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

interface AgentActivityBlockProps {
  segment: AgentActivitySegment;
}

export function AgentActivityBlock({ segment }: AgentActivityBlockProps) {
  const { steps } = segment;
  const hasMultiple = steps.length > 1;
  const allDone = steps.every((s) => s.status === "complete" || s.status === "error");
  const hasError = steps.some((s) => s.status === "error");
  const runningCount = steps.filter((s) => s.status === "running").length;

  // Collapsed by default when all done and multiple steps
  const [isExpanded, setIsExpanded] = useState(!allDone || !hasMultiple);

  // Summary line when collapsed
  const summaryText = allDone
    ? `${steps.length} tool${steps.length > 1 ? "s" : ""} completed${hasError ? " (with errors)" : ""}`
    : `${runningCount} running, ${steps.length - runningCount} done`;

  const blockClass = `activity-block activity-block-enter${
    hasError ? " activity-block--error" : !allDone ? " activity-block--running" : ""
  }`;

  return (
    <div className={blockClass}>
      {/* Collapsible header for multi-step blocks */}
      {hasMultiple && allDone && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`activity-header${isExpanded ? " activity-header--open" : ""}`}
        >
          <Check
            size={14}
            className={`activity-header-icon${hasError ? " activity-header-icon--error" : ""}`}
          />
          <span className="activity-header-text">{summaryText}</span>
          <ChevronDown
            size={14}
            className={`activity-header-chevron${isExpanded ? " activity-header-chevron--open" : ""}`}
          />
        </button>
      )}

      {/* Step list — uses CSS grid trick for smooth height animation (BEHAVIOR.md §3.4) */}
      <div className={`activity-grid-collapse ${isExpanded ? "expanded" : ""}`}>
        <div>
          {collapseRepeats(steps).map((entry) => (
            <ActivityStepRow
              key={entry.step.toolCallId}
              step={entry.step}
              count={entry.count}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Order matters: most-specific first.
const PROMPT_KEYS = [
  "command",      // bash/sh
  "file_path",    // read/edit/write
  "path",         // alt path
  "prompt", "query", "instruction", "code", "text", "question", "message",
  "url",
  "capability",   // workspace_pane_call
  "pattern",      // grep
  "name",         // native_locate
];

const MONO_KEYS = new Set(["command", "file_path", "path", "url", "pattern"]);

function getStepDetail(
  toolName: string,
  args: Record<string, unknown>,
): { text: string; mono: boolean } | null {
  for (const key of PROMPT_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) {
      return { text: v, mono: MONO_KEYS.has(key) || toolName === "execute_code" };
    }
  }
  return null;
}

/**
 * Collapse consecutive identical (same tool + same status + same detail) rows
 * into one row with a "×N" count. Stops the "bash done · bash done · bash
 * done" stack when the agent fires the same surface call repeatedly.
 */
function collapseRepeats(steps: ActivityStep[]): { step: ActivityStep; count: number }[] {
  const out: { step: ActivityStep; count: number }[] = [];
  for (const step of steps) {
    const last = out[out.length - 1];
    const sameTool = last && last.step.toolName === step.toolName;
    const sameStatus = last && last.step.status === step.status;
    const lastDetail = last?.step.args ? getStepDetail(last.step.toolName, last.step.args)?.text : null;
    const thisDetail = step.args ? getStepDetail(step.toolName, step.args)?.text : null;
    const sameDetail = lastDetail === thisDetail;
    if (sameTool && sameStatus && sameDetail) {
      last!.count += 1;
    } else {
      out.push({ step, count: 1 });
    }
  }
  return out;
}

