"use client";

/**
 * useThreadStream — subscribe to an AG-UI SSE stream for any threadId
 * and reduce events into TimelineSegment[].
 *
 * Reuses agentRunReducer so rendering is identical to the main chat surface.
 * Supports both chat UUIDs and terminal:<id>.
 */

import { useEffect, useReducer, useState } from "react";
import { agentRunReducer } from "@/lib/hooks/useAgentRun";
import { INITIAL_AGENT_RUN_STATE } from "@/lib/types/agentRun";
import type { AgentRunState } from "@/lib/types/agentRun";

export interface UseThreadStreamResult {
  state: AgentRunState;
  isConnected: boolean;
}

const RECONNECT_DELAY_MS = 3000;

export function useThreadStream(threadId: string | null): UseThreadStreamResult {
  const [state, dispatch] = useReducer(agentRunReducer, INITIAL_AGENT_RUN_STATE);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!threadId) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      es?.close();
      es = new EventSource(
        `/api/agui/stream?threadId=${encodeURIComponent(threadId)}`,
      );

      es.onopen = () => {
        if (!cancelled) setIsConnected(true);
      };

      es.onmessage = (e: MessageEvent) => {
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(e.data as string) as Record<string, unknown>;
        } catch {
          return;
        }
        switch (evt.type) {
          case "RunStarted":
            dispatch({
              type: "RUN_STARTED",
              runId: evt.runId as string,
              thinking: evt.thinking as boolean | undefined,
              model: evt.model as string | undefined,
            });
            break;
          case "RunFinished":
            dispatch({
              type: "RUN_FINISHED",
              runId: evt.runId as string,
              threadTitle: evt.threadTitle as string | undefined,
            });
            break;
          case "RunError":
            dispatch({
              type: "RUN_ERROR",
              runId: evt.runId as string,
              error:
                (evt.error as { message: string } | undefined)?.message ??
                "Unknown error",
            });
            break;
          case "TextMessageStart":
            dispatch({ type: "TEXT_START", messageId: evt.messageId as string });
            break;
          case "TextMessageContent":
            dispatch({ type: "TEXT_DELTA", delta: evt.delta as string });
            break;
          case "TextMessageEnd":
            dispatch({ type: "TEXT_END" });
            break;
          case "ToolCallStart":
            dispatch({
              type: "TOOL_START",
              toolCallId: evt.toolCallId as string,
              toolName: evt.toolName as string,
            });
            break;
          case "ToolCallResult":
            dispatch({
              type: "TOOL_RESULT",
              toolCallId: evt.toolCallId as string,
              result: { success: (evt.success as boolean | undefined) ?? true },
              durationMs: evt.durationMs as number | undefined,
            });
            break;
          case "Connected":
          default:
            break;
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        setIsConnected(false);
        es?.close();
        es = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      setIsConnected(false);
    };
  }, [threadId]);

  return { state, isConnected };
}
