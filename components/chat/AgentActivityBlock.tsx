"use client";

import { useState } from "react";
import { ChevronDown, Wrench, Search, Code, Image, Volume2, Sparkles, Check, Play } from "lucide-react";
import type { ActivityStep, AgentActivitySegment } from "@/lib/types/agentRun";
import { formatDuration } from "@/lib/constants/status";
import { truncate } from "@/lib/utils";

// =============================================================================
// Tool display config — lucide icons, no emoji (DESIGN.md §6)
// =============================================================================

const TOOL_ICONS: Record<string, { icon: typeof Wrench; label: string }> = {
  generate_image: { icon: Image, label: "Image" },
  edit_image: { icon: Image, label: "Edit Image" },
  generate_audio: { icon: Volume2, label: "Audio" },
  image_to_3d: { icon: Play, label: "3D Model" },
  analyze_image: { icon: Image, label: "Vision" },
  web_search: { icon: Search, label: "Search" },
  glyph_motif: { icon: Sparkles, label: "Glyph" },
  execute_code: { icon: Code, label: "Code" },
  vector_search: { icon: Search, label: "Lookup" },
  vector_store: { icon: Search, label: "Store" },
};

function getToolConfig(toolName: string) {
  return TOOL_ICONS[toolName] ?? { icon: Wrench, label: toolName };
}

// =============================================================================
// Status badge
// =============================================================================

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

// =============================================================================
// Single step row
// =============================================================================

function ActivityStepRow({ step }: { step: ActivityStep }) {
  const config = getToolConfig(step.toolName);
  const Icon = config.icon;
  const mainArg = step.args ? getMainArg(step.args) : null;

  const iconClass = `activity-step-icon${
    step.status === "running" ? " activity-step-icon--running" :
    step.status === "error" ? " activity-step-icon--error" : ""
  }`;

  return (
    <div className="activity-step">
      <Icon size={14} className={iconClass} />
      <span className="activity-step-label">{config.label}</span>
      {mainArg && (
        <span className="activity-step-arg">
          &ldquo;{truncate(mainArg, 50)}&rdquo;
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
  );
}

// =============================================================================
// AgentActivityBlock — grouped tool executions as one unit of work
// =============================================================================

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
          {steps.map((step) => (
            <ActivityStepRow key={step.toolCallId} step={step} />
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const PROMPT_KEYS = ["prompt", "query", "instruction", "code", "text", "question", "message"];

function getMainArg(args: Record<string, unknown>): string | null {
  for (const key of PROMPT_KEYS) {
    if (args[key] && typeof args[key] === "string") {
      return args[key] as string;
    }
  }
  return null;
}

