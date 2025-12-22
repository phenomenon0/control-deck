"use client";

import { useState } from "react";

// =============================================================================
// Types
// =============================================================================

export interface ToolCallCardProps {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  status: "pending" | "running" | "success" | "error";
  duration?: number;
  error?: string;
  isCollapsible?: boolean;
}

// =============================================================================
// Status Styles
// =============================================================================

const STATUS_STYLES = {
  pending: {
    border: "border-gray-500/30",
    bg: "bg-gray-500/5",
    dot: "bg-gray-400",
    text: "text-gray-400",
  },
  running: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    dot: "bg-blue-400 animate-pulse",
    text: "text-blue-400",
  },
  success: {
    border: "border-green-500/30",
    bg: "bg-green-500/5",
    dot: "bg-green-400",
    text: "text-green-400",
  },
  error: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    dot: "bg-red-400",
    text: "text-red-400",
  },
};

// =============================================================================
// ToolCallCard Component
// =============================================================================

export function ToolCallCard({
  name,
  args,
  result,
  status,
  duration,
  error,
  isCollapsible = true,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(!isCollapsible);
  const styles = STATUS_STYLES[status];

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div
      className={`rounded-lg border ${styles.border} ${styles.bg} overflow-hidden max-w-md animate-fade-in`}
    >
      {/* Header */}
      <button
        onClick={() => isCollapsible && setIsExpanded(!isExpanded)}
        className={`w-full flex items-center gap-2 p-3 text-left ${
          isCollapsible ? "hover:bg-black/5" : ""
        }`}
        disabled={!isCollapsible}
      >
        {/* Status Dot */}
        <span className={`w-2 h-2 rounded-full ${styles.dot}`} />

        {/* Tool Icon */}
        <span className="text-lg">🔧</span>

        {/* Name */}
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {name}
        </span>

        {/* Status */}
        <span className={`text-xs ${styles.text} ml-auto`}>
          {status === "running" && "Running..."}
          {status === "success" && "Completed"}
          {status === "error" && "Failed"}
          {status === "pending" && "Pending"}
        </span>

        {/* Duration */}
        {duration !== undefined && status !== "running" && (
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {formatDuration(duration)}
          </span>
        )}

        {/* Spinner or Chevron */}
        {status === "running" ? (
          <div className="tool-spinner" />
        ) : isCollapsible ? (
          <svg
            className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        ) : null}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-[var(--border)]">
          {/* Arguments */}
          {args && Object.keys(args).length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Arguments
              </div>
              <pre className="text-xs font-mono p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] overflow-x-auto">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {result && (
            <div>
              <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Result
              </div>
              <div className="text-sm p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)]">
                {result}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div>
              <div className="text-[10px] font-medium text-red-400 uppercase tracking-wide mb-1">
                Error
              </div>
              <div className="text-sm p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400">
                {error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
