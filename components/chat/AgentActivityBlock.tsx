"use client";

import { useState } from "react";
import { ChevronDown, Wrench, Search, Code, Image, Volume2, Sparkles, Check, AlertCircle, Play } from "lucide-react";
import type { ActivityStep, AgentActivitySegment } from "@/lib/types/agentRun";
import { formatDuration } from "@/lib/constants/status";

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
  const config = {
    running: {
      bg: "var(--accent-muted)",
      color: "var(--accent)",
      label: "running",
      animate: true,
    },
    complete: {
      bg: "var(--success-muted)",
      color: "var(--success)",
      label: "done",
      animate: false,
    },
    error: {
      bg: "var(--error-muted)",
      color: "var(--error)",
      label: "error",
      animate: false,
    },
  }[status];

  return (
    <span
      className={config.animate ? "activity-badge-shimmer" : ""}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 500,
        background: config.bg,
        color: config.color,
        transition: "background var(--t-fast, 150ms) ease, color var(--t-fast, 150ms) ease",
      }}
    >
      {config.label}
    </span>
  );
}

// =============================================================================
// Single step row
// =============================================================================

function ActivityStepRow({ step }: { step: ActivityStep }) {
  const config = getToolConfig(step.toolName);
  const Icon = config.icon;
  const mainArg = step.args
    ? getMainArg(step.args)
    : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
      }}
    >
      <Icon
        size={14}
        style={{
          color:
            step.status === "running"
              ? "var(--agent-working)"
              : step.status === "error"
              ? "var(--error)"
              : "var(--text-secondary)",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-secondary)",
          flexShrink: 0,
        }}
      >
        {config.label}
      </span>
      {mainArg && (
        <span
          style={{
            fontSize: 12,
            color: "var(--text-tertiary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono)",
          }}
        >
          &ldquo;{truncate(mainArg, 50)}&rdquo;
        </span>
      )}
      <span style={{ flexShrink: 0, marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        {step.durationMs != null && step.status !== "running" && (
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-tertiary)",
            }}
          >
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

  const borderColor = hasError
    ? "var(--error)"
    : !allDone
    ? "var(--accent)"
    : "var(--border-bright)";

  return (
    <div
      style={{
        background: "var(--agent-surface)",
        borderLeft: `2px solid ${borderColor}`,
        borderRadius: "0 var(--radius-md, 6px) var(--radius-md, 6px) 0",
        padding: "var(--sp-3, 12px) var(--sp-4, 16px)",
        margin: "var(--sp-3, 12px) 0",
        transition: "border-color var(--t-fast, 150ms) ease",
      }}
    >
      {/* Collapsible header for multi-step blocks */}
      {hasMultiple && allDone && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
            marginBottom: isExpanded ? 4 : 0,
          }}
        >
          <Check
            size={14}
            style={{ color: hasError ? "var(--error)" : "var(--success)", flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-secondary)",
              flex: 1,
            }}
          >
            {summaryText}
          </span>
          <ChevronDown
            size={14}
            style={{
              color: "var(--text-tertiary)",
              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform var(--t-fast, 150ms) cubic-bezier(0, 0, 0.2, 1)",
            }}
          />
        </button>
      )}

      {/* Step list */}
      {isExpanded && (
        <div>
          {steps.map((step) => (
            <ActivityStepRow key={step.toolCallId} step={step} />
          ))}
        </div>
      )}

      {/* Single-step collapsed summary (when collapsed and single step) */}
      {!isExpanded && !hasMultiple && steps[0] && (
        <ActivityStepRow step={steps[0]} />
      )}
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

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + "...";
}
