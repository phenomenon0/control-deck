"use client";

import { X } from "lucide-react";
import { RunTimeline } from "@/components/runs/RunTimeline";
import { ToolCallDetail } from "./ToolCallDetail";
import type { RunEvent, ToolCall } from "./types";

export function RunDetailPanel({
  runId,
  runEvents,
  toolCallList,
  loadingEvents,
  onClose,
}: {
  runId: string;
  runEvents: RunEvent[];
  toolCallList: ToolCall[];
  loadingEvents: boolean;
  onClose: () => void;
}) {
  return (
    <div className="runs-trace flex flex-col animate-fade-in">
      <div className="sticky top-0 z-10 bg-[var(--bg-secondary)] flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-sm font-semibold tracking-tight">Run Details</span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all duration-[240ms]"
        >
          <X className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loadingEvents ? (
          <div className="text-center text-[var(--text-muted)] py-8">Loading events...</div>
        ) : (
          <div className="space-y-5">
            <div>
              <h4 className="section-title mb-1">Run ID</h4>
              <code className="text-xs text-[var(--text-secondary)]">{runId}</code>
            </div>

            {toolCallList.length > 0 && (
              <div>
                <h4 className="section-title mb-3">Tool Calls ({toolCallList.length})</h4>
                <div className="space-y-3">
                  {toolCallList.map((tc) => (
                    <ToolCallDetail key={tc.id} toolCall={tc} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="section-title mb-3">Timeline ({runEvents.length} events)</h4>
              <RunTimeline events={runEvents} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
