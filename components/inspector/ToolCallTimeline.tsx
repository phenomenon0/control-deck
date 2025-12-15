"use client";

import React from "react";

// =============================================================================
// Types
// =============================================================================

export interface ToolCallEvent {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  startedAt: number;
  completedAt?: number;
  result?: {
    success: boolean;
    message?: string;
    error?: string;
  };
}

// =============================================================================
// ToolCallTimeline
// =============================================================================

interface ToolCallTimelineProps {
  events: ToolCallEvent[];
}

export function ToolCallTimeline({ events }: ToolCallTimelineProps) {
  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <ToolCallItem key={event.id} event={event} isLast={index === events.length - 1} />
      ))}
    </div>
  );
}

// =============================================================================
// ToolCallItem
// =============================================================================

function ToolCallItem({ event, isLast }: { event: ToolCallEvent; isLast: boolean }) {
  const duration = event.completedAt
    ? ((event.completedAt - event.startedAt) / 1000).toFixed(1)
    : null;

  return (
    <div className="relative flex gap-3">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[9px] top-[20px] w-0.5 h-[calc(100%+8px)] bg-[var(--border)]" />
      )}

      {/* Status indicator */}
      <div className="relative z-10 flex-shrink-0">
        <StatusDot status={event.status} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {event.name}
          </span>
          {duration && (
            <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
              {duration}s
            </span>
          )}
        </div>

        {event.status === "running" && (
          <div className="text-xs text-blue-400 mt-0.5">Running...</div>
        )}

        {event.status === "error" && event.result?.error && (
          <div className="text-xs text-red-400 mt-0.5 truncate" title={event.result.error}>
            {event.result.error}
          </div>
        )}

        {event.status === "complete" && event.result?.message && (
          <div className="text-xs text-[var(--text-muted)] mt-0.5 truncate" title={event.result.message}>
            {event.result.message}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// StatusDot
// =============================================================================

function StatusDot({ status }: { status: "running" | "complete" | "error" }) {
  const baseClasses = "w-[18px] h-[18px] rounded-full flex items-center justify-center";

  if (status === "running") {
    return (
      <div className={`${baseClasses} bg-blue-500/20`}>
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={`${baseClasses} bg-red-500/20`}>
        <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`${baseClasses} bg-green-500/20`}>
      <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}
