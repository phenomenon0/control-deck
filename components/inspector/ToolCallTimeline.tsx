"use client";

import React, { useState } from "react";
import { ChevronRight, X, Check } from "lucide-react";
import type { DeckPayload } from "@/lib/agui/payload";
import { PayloadViewer } from "./PayloadViewer";

export interface ToolCallEvent {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  startedAt: number;
  completedAt?: number;
  /** Tool call arguments (DeckPayload) */
  args?: DeckPayload;
  /** Tool execution result (DeckPayload - may be JSON or GLYPH) */
  result?: DeckPayload;
  /** Legacy result format for backwards compatibility */
  legacyResult?: {
    success: boolean;
    message?: string;
    error?: string;
  };
}

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

function ToolCallItem({ event, isLast }: { event: ToolCallEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  
  const duration = event.completedAt
    ? ((event.completedAt - event.startedAt) / 1000).toFixed(1)
    : null;

  // Check if we have payload data to show
  const hasDetails = event.args || event.result;

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
        {/* Header row - clickable if we have details */}
        <div 
          className={`flex items-center justify-between gap-2 ${hasDetails ? 'cursor-pointer' : ''}`}
          onClick={() => hasDetails && setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Expand arrow if we have details */}
            {hasDetails && (
              <ChevronRight
                className={`w-3 h-3 text-[var(--text-muted)] transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
              />
            )}
            
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
              {event.name}
            </span>
            
            {/* Payload type badge with savings */}
            {event.result && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                event.result.kind === "glyph" 
                  ? "bg-purple-500/20 text-purple-400" 
                  : "bg-blue-500/20 text-blue-400"
              }`}>
                {event.result.kind.toUpperCase()}
                {event.result.kind === "glyph" && event.result.approxBytes && (
                  <span className="ml-1 opacity-75">
                    {Math.round((1 - event.result.glyph.length / event.result.approxBytes) * 100)}%
                  </span>
                )}
              </span>
            )}
          </div>
          
          {duration && (
            <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
              {duration}s
            </span>
          )}
        </div>

        {/* Status text */}
        {event.status === "running" && (
          <div className="text-xs text-blue-400 mt-0.5">Running...</div>
        )}

        {event.status === "error" && event.legacyResult?.error && (
          <div className="text-xs text-red-400 mt-0.5 truncate" title={event.legacyResult.error}>
            {event.legacyResult.error}
          </div>
        )}

        {event.status === "complete" && event.legacyResult?.message && !expanded && (
          <div className="text-xs text-[var(--text-muted)] mt-0.5 truncate" title={event.legacyResult.message}>
            {event.legacyResult.message}
          </div>
        )}

        {/* Expanded details */}
        {expanded && hasDetails && (
          <div className="mt-3 space-y-3">
            {/* Args */}
            {event.args && (
              <PayloadViewer 
                payload={event.args} 
                label="Args"
                defaultExpanded={false}
                maxPreviewLines={3}
              />
            )}
            
            {/* Result */}
            {event.result && (
              <PayloadViewer 
                payload={event.result} 
                label="Result"
                defaultExpanded={true}
                maxPreviewLines={5}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
        <X className="w-3 h-3 text-red-400" />
      </div>
    );
  }

  return (
    <div className={`${baseClasses} bg-green-500/20`}>
      <Check className="w-3 h-3 text-green-400" />
    </div>
  );
}
