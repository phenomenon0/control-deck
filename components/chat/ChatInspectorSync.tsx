"use client";

/**
 * useChatInspectorSync — push chat run state into the inspector rail.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Single update replaces the 6 push effects the pre-redesign pane needed
 * (SURFACE.md §5.4).
 */

import { useEffect } from "react";
import { useChatInspectorUpdate } from "@/lib/hooks/useChatInspector";
import type { Message } from "@/lib/chat/helpers";
import type { UseAgentRunReturn } from "@/lib/hooks/useAgentRun";
import type { AgentActivitySegment, TimelineSegment } from "@/lib/types/agentRun";

interface UseChatInspectorSyncOptions {
  activeThreadId: string | null;
  selectedModel: string;
  isRunning: boolean;
  messages: Message[];
  segments: TimelineSegment[];
  resolvedModel: UseAgentRunReturn["state"]["resolvedModel"];
}

export function useChatInspectorSync({
  activeThreadId,
  selectedModel,
  isRunning,
  messages,
  segments,
  resolvedModel,
}: UseChatInspectorSyncOptions): void {
  const updateInspector = useChatInspectorUpdate();

  useEffect(() => {
    const toolCalls = segments
      .filter((s) => s.type === "agent-activity")
      .flatMap((s) => (s as AgentActivitySegment).steps)
      .map((step) => ({
        id: step.toolCallId,
        name: step.toolName,
        status: step.status === "running" ? "running" as const : step.status === "complete" ? "complete" as const : "error" as const,
        args: step.args,
        result: step.result ? { success: step.result.success, message: step.result.message, error: step.result.error } : undefined,
        durationMs: step.durationMs,
        startedAt: step.startedAt,
      }));
    // Truth-tell: prefer the server-confirmed model from RunStarted over
    // the composer's requested model. They match except when the server
    // snapped the resolver to a different installed model — in which case
    // the rail should show what actually answered.
    updateInspector({
      threadId: activeThreadId,
      model: resolvedModel ?? selectedModel,
      route: "local",
      isLoading: isRunning,
      artifacts: messages.flatMap((m) => m.artifacts || []),
      toolCalls,
    });
  }, [activeThreadId, selectedModel, isRunning, messages, segments, updateInspector, resolvedModel]);
}
