"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { PayloadViewer } from "@/components/inspector/PayloadViewer";
import type { ToolCall } from "./types";

export function ToolCallDetail({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(true);

  const duration = toolCall.endedAt
    ? ((new Date(toolCall.endedAt).getTime() - new Date(toolCall.startedAt).getTime()) / 1000).toFixed(2)
    : null;

  return (
    <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2.5 bg-[rgba(255,255,255,0.04)] cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <ChevronRight
            className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-150 ease-[cubic-bezier(0,0,0.2,1)] ${expanded ? "rotate-90" : ""}`}
          />
          <span className="text-sm font-medium text-[var(--text-primary)]">{toolCall.name}</span>

          {toolCall.status === "running" && (
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--accent)]" />
          )}
          {toolCall.status === "complete" && (
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--success)]" />
          )}
          {toolCall.status === "error" && (
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--error)]" />
          )}

          {toolCall.result && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                toolCall.result.kind === "glyph"
                  ? "bg-purple-500/20 text-purple-400"
                  : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {toolCall.result.kind.toUpperCase()}
              {toolCall.result.kind === "glyph" && toolCall.result.approxBytes && (() => {
                const glyph = toolCall.result as { kind: "glyph"; glyph: string; approxBytes: number };
                return (
                  <span className="ml-1 opacity-75">
                    {Math.round((1 - glyph.glyph.length / glyph.approxBytes) * 100)}%
                  </span>
                );
              })()}
            </span>
          )}
        </div>

        {duration && <span className="text-xs text-[var(--text-muted)]">{duration}s</span>}
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          {toolCall.args && (
            <PayloadViewer payload={toolCall.args} label="Args" defaultExpanded={false} maxPreviewLines={3} />
          )}
          {toolCall.result && (
            <PayloadViewer payload={toolCall.result} label="Result" defaultExpanded={true} maxPreviewLines={8} />
          )}
          {!toolCall.args && !toolCall.result && toolCall.status === "running" && (
            <div className="text-sm text-[var(--text-muted)]">Executing...</div>
          )}
        </div>
      )}
    </div>
  );
}
