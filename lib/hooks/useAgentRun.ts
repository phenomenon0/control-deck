/**
 * useAgentRun — Unified hook for agent run state management
 *
 * Replaces the split useSendMessage + useSSE coordination with a single
 * state machine driven by useReducer. This is Phase 1 of the chat surface
 * redesign (SURFACE.md §5.2).
 *
 * This file contains:
 *   1. agentRunReducer — pure reducer function (testable, no side effects)
 *   2. useAgentRun — React hook that wires the reducer to SSE events + fetch
 *
 * The hook is NOT wired into the UI yet. ChatPaneV2 continues to use the
 * old hooks. ChatSurface (Phase 2) will consume this hook.
 */

import { useReducer, useCallback, useRef } from "react";
import type {
  AgentRunState,
  RunAction,
  TimelineSegment,
  ActivityStep,
  AgentActivitySegment,
  AgentMessageSegment,
  AgentReasoningSegment,
} from "@/lib/types/agentRun";
import { INITIAL_AGENT_RUN_STATE } from "@/lib/types/agentRun";

// =============================================================================
// Helpers
// =============================================================================

let _segmentCounter = 0;
function nextSegmentId(): string {
  return `seg_${Date.now()}_${++_segmentCounter}`;
}

/** Extract runId from current state, defaulting to empty string if not available */
function getRunId(runState: AgentRunState["runState"]): string {
  if ("runId" in runState && runState.runId) return runState.runId;
  return "";
}

/** Find the last segment of a given type */
function findLastOfType<T extends TimelineSegment>(
  segments: TimelineSegment[],
  type: T["type"]
): T | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].type === type) return segments[i] as T;
  }
  return undefined;
}

/** Immutably update the last segment matching a predicate */
function updateLastSegment(
  segments: TimelineSegment[],
  predicate: (s: TimelineSegment) => boolean,
  updater: (s: TimelineSegment) => TimelineSegment
): TimelineSegment[] {
  const idx = segments.findLastIndex(predicate);
  if (idx === -1) return segments;
  const copy = [...segments];
  copy[idx] = updater(copy[idx]);
  return copy;
}

/** Update a specific step within the last activity segment */
function updateToolStep(
  segments: TimelineSegment[],
  toolCallId: string,
  updater: (step: ActivityStep) => ActivityStep
): TimelineSegment[] {
  return updateLastSegment(
    segments,
    (s): s is AgentActivitySegment =>
      s.type === "agent-activity" &&
      (s as AgentActivitySegment).steps.some((st) => st.toolCallId === toolCallId),
    (s) => {
      const seg = s as AgentActivitySegment;
      return {
        ...seg,
        steps: seg.steps.map((st) =>
          st.toolCallId === toolCallId ? updater(st) : st
        ),
      };
    }
  );
}

// =============================================================================
// Pure Reducer
// =============================================================================

export function agentRunReducer(
  state: AgentRunState,
  action: RunAction
): AgentRunState {
  const now = Date.now();

  switch (action.type) {
    // ── User submits ──
    case "SUBMIT": {
      const userSeg: TimelineSegment = {
        id: nextSegmentId(),
        type: "user-message",
        timestamp: now,
        content: action.content,
        uploads: action.uploads,
      };
      return {
        ...state,
        runState: { phase: "submitted", startedAt: now },
        segments: [...state.segments, userSeg],
      };
    }

    // ── Server acknowledges the run ──
    case "RUN_STARTED": {
      return {
        ...state,
        runState: {
          phase: action.thinking ? "thinking" : "streaming",
          runId: action.runId,
          startedAt: now,
          ...(action.thinking ? {} : { messageId: "" }),
        } as AgentRunState["runState"],
      };
    }

    // ── Run completes ──
    case "RUN_FINISHED": {
      // Finalize any streaming segments
      let segs = state.segments;
      segs = updateLastSegment(
        segs,
        (s) => s.type === "agent-message" && (s as AgentMessageSegment).isStreaming,
        (s) => ({ ...s, isStreaming: false } as AgentMessageSegment)
      );
      segs = updateLastSegment(
        segs,
        (s) => s.type === "agent-reasoning" && (s as AgentReasoningSegment).isStreaming,
        (s) => ({ ...s, isStreaming: false } as AgentReasoningSegment)
      );
      return {
        ...state,
        runState: { phase: "idle" },
        segments: segs,
        threadTitle: action.threadTitle ?? state.threadTitle,
      };
    }

    // ── Run error ──
    case "RUN_ERROR": {
      let segs = state.segments;
      segs = updateLastSegment(
        segs,
        (s) => s.type === "agent-message" && (s as AgentMessageSegment).isStreaming,
        (s) => ({ ...s, isStreaming: false } as AgentMessageSegment)
      );
      return {
        ...state,
        runState: { phase: "error", runId: action.runId, error: action.error },
        segments: segs,
      };
    }

    // ── Reasoning / thinking ──
    case "REASONING_START": {
      const seg: TimelineSegment = {
        id: nextSegmentId(),
        type: "agent-reasoning",
        timestamp: now,
        content: "",
        isStreaming: true,
      };
      return {
        ...state,
        runState: state.runState.phase === "submitted" || state.runState.phase === "thinking"
          ? { ...state.runState, phase: "thinking" } as AgentRunState["runState"]
          : state.runState,
        segments: [...state.segments, seg],
      };
    }

    case "REASONING_DELTA": {
      return {
        ...state,
        segments: updateLastSegment(
          state.segments,
          (s) => s.type === "agent-reasoning" && (s as AgentReasoningSegment).isStreaming,
          (s) => ({
            ...s,
            content: (s as AgentReasoningSegment).content + action.delta,
          } as AgentReasoningSegment)
        ),
      };
    }

    case "REASONING_END": {
      return {
        ...state,
        segments: updateLastSegment(
          state.segments,
          (s) => s.type === "agent-reasoning" && (s as AgentReasoningSegment).isStreaming,
          (s) => ({ ...s, isStreaming: false } as AgentReasoningSegment)
        ),
      };
    }

    // ── Text streaming ──
    case "TEXT_START": {
      const seg: TimelineSegment = {
        id: nextSegmentId(),
        type: "agent-message",
        timestamp: now,
        messageId: action.messageId,
        content: "",
        isStreaming: true,
      };
      const runId = getRunId(state.runState);
      return {
        ...state,
        runState: { phase: "streaming", runId, messageId: action.messageId, startedAt: now },
        segments: [...state.segments, seg],
      };
    }

    case "TEXT_DELTA": {
      return {
        ...state,
        segments: updateLastSegment(
          state.segments,
          (s) => s.type === "agent-message" && (s as AgentMessageSegment).isStreaming,
          (s) => ({
            ...s,
            content: (s as AgentMessageSegment).content + action.delta,
          } as AgentMessageSegment)
        ),
      };
    }

    case "TEXT_END": {
      return {
        ...state,
        segments: updateLastSegment(
          state.segments,
          (s) => s.type === "agent-message" && (s as AgentMessageSegment).isStreaming,
          (s) => ({ ...s, isStreaming: false } as AgentMessageSegment)
        ),
      };
    }

    // ── Tool execution ──
    case "TOOL_START": {
      const step: ActivityStep = {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        status: "running",
        startedAt: now,
      };

      // Append to existing activity block or create new one
      const lastActivity = findLastOfType<AgentActivitySegment>(state.segments, "agent-activity");
      const isOngoingActivity =
        lastActivity && lastActivity.steps.some((s) => s.status === "running");

      let segs: TimelineSegment[];
      if (isOngoingActivity && lastActivity) {
        segs = updateLastSegment(
          state.segments,
          (s) => s === lastActivity,
          (s) => ({
            ...s,
            steps: [...(s as AgentActivitySegment).steps, step],
          } as AgentActivitySegment)
        );
      } else {
        const newBlock: TimelineSegment = {
          id: nextSegmentId(),
          type: "agent-activity",
          timestamp: now,
          steps: [step],
        };
        segs = [...state.segments, newBlock];
      }

      const runId = getRunId(state.runState);
      return {
        ...state,
        runState: {
          phase: "executing",
          runId,
          toolCallId: action.toolCallId,
          toolName: action.toolName,
          startedAt: now,
        },
        segments: segs,
      };
    }

    case "TOOL_ARGS": {
      return {
        ...state,
        segments: updateToolStep(state.segments, action.toolCallId, (step) => ({
          ...step,
          args: action.args,
        })),
      };
    }

    case "TOOL_RESULT": {
      const segs = updateToolStep(state.segments, action.toolCallId, (step) => ({
        ...step,
        status: action.result?.success !== false ? "complete" : "error",
        result: action.result,
        durationMs: action.durationMs,
      }));

      const runId = getRunId(state.runState);
      return {
        ...state,
        runState: { phase: "resuming", runId, startedAt: now },
        segments: segs,
      };
    }

    // ── Artifacts ──
    case "ARTIFACT_CREATED": {
      const seg: TimelineSegment = {
        id: nextSegmentId(),
        type: "artifact",
        timestamp: now,
        artifact: action.artifact,
        toolCallId: action.toolCallId,
      };
      return {
        ...state,
        segments: [...state.segments, seg],
      };
    }

    // ── Load existing thread history ──
    case "LOAD_HISTORY": {
      return {
        ...state,
        runState: { phase: "idle" },
        segments: action.segments,
      };
    }

    // ── User stops the run ──
    case "STOP": {
      let segs = state.segments;
      segs = updateLastSegment(
        segs,
        (s) => s.type === "agent-message" && (s as AgentMessageSegment).isStreaming,
        (s) => ({ ...s, isStreaming: false } as AgentMessageSegment)
      );
      segs = updateLastSegment(
        segs,
        (s) => s.type === "agent-reasoning" && (s as AgentReasoningSegment).isStreaming,
        (s) => ({ ...s, isStreaming: false } as AgentReasoningSegment)
      );
      return {
        ...state,
        runState: { phase: "idle" },
        segments: segs,
      };
    }

    default:
      return state;
  }
}

// =============================================================================
// React Hook
// =============================================================================

export interface UseAgentRunOptions {
  threadId: string;
  model?: string;
}

export interface UseAgentRunReturn {
  /** Current run phase (idle, submitted, thinking, streaming, executing, resuming, error) */
  state: AgentRunState;
  /** Dispatch an action to the state machine */
  dispatch: React.Dispatch<RunAction>;
  /** Send a message to start a new run */
  send: (content: string, uploads?: { id: string; name: string; url?: string }[]) => void;
  /** Stop the current run */
  stop: () => void;
}

/**
 * Unified hook for agent run state management.
 *
 * Phase 1: Exposes reducer + dispatch. Does NOT manage SSE or fetch yet.
 * Phase 2 will wire this to the actual /api/chat endpoint and SSE stream,
 * replacing useSendMessage and useSSE.
 */
export function useAgentRun({ threadId, model }: UseAgentRunOptions): UseAgentRunReturn {
  const [state, dispatch] = useReducer(agentRunReducer, INITIAL_AGENT_RUN_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    (content: string, uploads?: { id: string; name: string; url?: string }[]) => {
      dispatch({ type: "SUBMIT", content, uploads });
      // Phase 2: This will POST to /api/chat and subscribe to SSE events,
      // dispatching RUN_STARTED, TEXT_DELTA, TOOL_START, etc. as they arrive.
      // For now, ChatSurface can call dispatch directly to wire into the
      // existing useSendMessage/useSSE event flow.
    },
    [dispatch]
  );

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    dispatch({ type: "STOP" });
  }, [dispatch]);

  return { state, dispatch, send, stop };
}
