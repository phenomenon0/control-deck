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
import { SSEParser } from "@/lib/agui/sse";
import type { AGUIEvent } from "@/lib/agui/events";

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

    // fetch + SSEParser (not EventSource) so the stream goes through the one
    // shared codec; reconnect mirrors EventSource's auto-retry.
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let abort: AbortController | null = null;

    const handle = (evt: AGUIEvent) => {
      switch (evt.type) {
        case "RunStarted":
          dispatch({ type: "RUN_STARTED", runId: evt.runId, thinking: evt.thinking, model: evt.model });
          break;
        case "RunFinished":
          dispatch({ type: "RUN_FINISHED", runId: evt.runId, threadTitle: evt.threadTitle });
          break;
        case "RunError":
          dispatch({ type: "RUN_ERROR", runId: evt.runId, error: evt.error?.message ?? "Unknown error" });
          break;
        case "TextMessageStart":
          dispatch({ type: "TEXT_START", messageId: evt.messageId });
          break;
        case "TextMessageContent":
          dispatch({ type: "TEXT_DELTA", delta: evt.delta });
          break;
        case "TextMessageEnd":
          dispatch({ type: "TEXT_END" });
          break;
        case "ToolCallStart":
          dispatch({ type: "TOOL_START", toolCallId: evt.toolCallId, toolName: evt.toolName });
          break;
        case "ToolCallResult":
          dispatch({
            type: "TOOL_RESULT",
            toolCallId: evt.toolCallId,
            result: { success: evt.success ?? true },
            durationMs: evt.durationMs,
          });
          break;
        default:
          break;
      }
    };

    const connect = async () => {
      const ctrl = new AbortController();
      abort = ctrl;
      const parser = new SSEParser();
      try {
        const res = await fetch(`/api/agui/stream?threadId=${encodeURIComponent(threadId)}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) throw new Error(`agui stream HTTP ${res.status}`);
        if (!closed) setIsConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const evt of parser.feed(decoder.decode(value, { stream: true }))) handle(evt);
        }
        for (const evt of parser.flush()) handle(evt);
      } catch {
        // Aborted during teardown or a transient failure — retry unless closed.
      }
      if (closed) return;
      setIsConnected(false);
      retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    void connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      abort?.abort();
      setIsConnected(false);
    };
  }, [threadId]);

  return { state, isConnected };
}
