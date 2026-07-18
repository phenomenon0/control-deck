"use client";

/**
 * useChatHistorySync — convert persisted thread messages → timeline segments.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Fires on thread change and replays the persisted message log into the
 * agent-run reducer via LOAD_HISTORY so the timeline renders prior turns.
 */

import { useEffect } from "react";
import type { Message } from "@/lib/chat/helpers";
import type { UseAgentRunReturn } from "@/lib/hooks/useAgentRun";
import type { ActivityStep, TimelineSegment } from "@/lib/types/agentRun";

interface UseChatHistorySyncOptions {
  messages: Message[];
  effectiveThreadId: string;
  agentDispatch: UseAgentRunReturn["dispatch"];
}

export function useChatHistorySync({
  messages,
  effectiveThreadId,
  agentDispatch,
}: UseChatHistorySyncOptions): void {
  useEffect(() => {
    if (!messages.length) {
      agentDispatch({ type: "LOAD_HISTORY", segments: [] });
      return;
    }
    const historySegments: TimelineSegment[] = [];
    let segCounter = 0;
    const nextId = () => `seg_hist_${++segCounter}`;

    for (const msg of messages) {
      if (msg.role === "user") {
        const uploads = msg.artifacts?.map((a) => ({
          id: a.id,
          name: a.name || "attachment",
          url: a.url,
        }));
        historySegments.push({
          id: nextId(),
          type: "user-message",
          timestamp: 0,
          content: msg.content,
          uploads: uploads?.length ? uploads : undefined,
        });
      } else if (msg.role === "assistant") {
        // Reconstruct tool activity from persisted metadata (before text)
        const toolCalls = msg.metadata?.toolCalls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          historySegments.push({
            id: nextId(),
            type: "agent-activity",
            timestamp: 0,
            steps: toolCalls.map((tc: { toolCallId?: string; toolName: string; args?: Record<string, unknown>; status?: string; durationMs?: number; success?: boolean; error?: string }) => ({
              toolCallId: tc.toolCallId || crypto.randomUUID(),
              toolName: tc.toolName,
              args: tc.args,
              status: (tc.status === "error" ? "error" : "complete") as ActivityStep["status"],
              result: {
                success: tc.success ?? true,
                error: tc.error,
              },
              durationMs: tc.durationMs,
              startedAt: 0,
            })),
          });
        }
        historySegments.push({
          id: nextId(),
          type: "agent-message",
          timestamp: 0,
          messageId: msg.id,
          content: msg.content || "",
          isStreaming: false,
        });
        if (msg.artifacts?.length) {
          for (const artifact of msg.artifacts) {
            historySegments.push({
              id: nextId(),
              type: "artifact",
              timestamp: 0,
              artifact,
            });
          }
        }
      }
    }
    agentDispatch({ type: "LOAD_HISTORY", segments: historySegments });
  }, [effectiveThreadId]); // eslint-disable-line react-hooks/exhaustive-deps
}
