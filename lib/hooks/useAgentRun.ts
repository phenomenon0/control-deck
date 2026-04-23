import { useReducer, useCallback, useRef } from "react";
import type {
  AgentRunState,
  RunAction,
  TimelineSegment,
  ActivityStep,
  AgentActivitySegment,
  AgentMessageSegment,
  AgentReasoningSegment,
  ErrorSegment,
} from "@/lib/types/agentRun";
import { INITIAL_AGENT_RUN_STATE } from "@/lib/types/agentRun";

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
        // Clear resolvedModel so the rail/header fall back to the
        // requested model until the server's RunStarted confirms.
        resolvedModel: null,
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
        // Capture what the server actually picked. For free-mode runs
        // this may differ from prefs.model.
        resolvedModel: action.model ?? state.resolvedModel,
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
      // Mark the last agent-message as complete (BEHAVIOR.md §3.4 step 5)
      segs = updateLastSegment(
        segs,
        (s) => s.type === "agent-message",
        (s) => ({ ...s, complete: true } as AgentMessageSegment)
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
      // Append inline error segment (BEHAVIOR.md §7.1)
      const errorSeg: ErrorSegment = {
        id: nextSegmentId(),
        type: "error",
        timestamp: now,
        error: action.error,
        retryable: !action.error.toLowerCase().includes("fatal"),
      };
      segs = [...segs, errorSeg];
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

    // ── User stops the run (BEHAVIOR.md §7.3) ──
    case "STOP": {
      let segs = state.segments;
      segs = updateLastSegment(
        segs,
        (s) => s.type === "agent-message" && (s as AgentMessageSegment).isStreaming,
        (s) => ({ ...s, isStreaming: false, stopped: true } as AgentMessageSegment)
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

function dispatchSSEEvent(
  dispatch: React.Dispatch<RunAction>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
): void {
  switch (event.type) {
    case "RunStarted":
      dispatch({
        type: "RUN_STARTED",
        runId: event.runId,
        thinking: event.thinking,
        model: typeof event.model === "string" ? event.model : undefined,
      });
      break;

    case "TextMessageStart":
      dispatch({ type: "TEXT_START", messageId: event.messageId });
      break;

    case "TextMessageContent":
      dispatch({ type: "TEXT_DELTA", delta: event.delta ?? "" });
      break;

    case "TextMessageEnd":
      dispatch({ type: "TEXT_END" });
      break;

    // Reasoning events (from Agent-GO extended protocol)
    case "ReasoningStart":
      dispatch({ type: "REASONING_START" });
      break;

    case "ReasoningMessageContent":
    case "ReasoningContent":
      dispatch({ type: "REASONING_DELTA", delta: event.content || event.delta || "" });
      break;

    case "ReasoningEnd":
      dispatch({ type: "REASONING_END" });
      break;

    case "ToolCallStart":
      dispatch({
        type: "TOOL_START",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
      break;

    case "ToolCallArgs": {
      // Unwrap DeckPayload envelope
      const args = event.args?.kind === "json" ? event.args.data : event.args;
      if (args && event.toolCallId) {
        dispatch({ type: "TOOL_ARGS", toolCallId: event.toolCallId, args });
      }
      break;
    }

    case "ToolCallResult": {
      const success = event.success ?? true;
      // Extract result data from DeckPayload
      let resultData: Record<string, unknown> | undefined;
      if (event.result?.kind === "json") {
        resultData = event.result.data as Record<string, unknown>;
      } else if (event.result?.kind === "glyph") {
        resultData = { _glyph: event.result.glyph, _approxBytes: event.result.approxBytes };
      } else if (event.result?.kind === "text") {
        resultData = { message: event.result.text };
      } else if (event.result && typeof event.result === "object") {
        resultData = event.result;
      }

      dispatch({
        type: "TOOL_RESULT",
        toolCallId: event.toolCallId,
        result: {
          success,
          message: resultData?.message as string | undefined,
          error: success ? undefined : ((resultData?.error as string) ?? "Tool execution failed"),
          data: resultData,
        },
        durationMs: event.durationMs,
      });
      break;
    }

    case "ArtifactCreated":
      dispatch({
        type: "ARTIFACT_CREATED",
        artifact: {
          id: event.artifactId,
          url: event.url,
          name: event.name,
          mimeType: event.mimeType,
        },
        toolCallId: event.toolCallId,
      });
      break;

    case "RunFinished":
      dispatch({ type: "RUN_FINISHED", runId: event.runId, threadTitle: event.threadTitle });
      break;

    case "RunError":
      dispatch({
        type: "RUN_ERROR",
        runId: event.runId ?? "",
        error: event.error?.message ?? "Unknown error",
      });
      break;
  }
}

export interface InterruptRequest {
  runId: string;
  toolCallId: string;
  toolName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any;
}

export interface UseAgentRunOptions {
  /** Called when Agent-GO requests tool approval */
  onInterrupt?: (request: InterruptRequest) => void;
  /** Called when an interrupt is resolved */
  onInterruptResolved?: () => void;
}

export interface UseAgentRunReturn {
  /** Full state: runState + segments + threadTitle */
  state: AgentRunState;
  /** Dispatch an action to the state machine */
  dispatch: React.Dispatch<RunAction>;
  /** Send a message to start a new run */
  send: (
    content: string,
    options: {
      messages: Array<{ role: string; content: string }>;
      threadId: string;
      model: string;
      uploadIds?: string[];
      routeMode?: "local" | "free";
    }
  ) => Promise<SendResult>;
  /** Stop the current run */
  stop: () => void;
  /** Whether a run is currently in progress */
  isRunning: boolean;
}

export interface SendResult {
  /** Thread ID (may be from response headers if server assigned one) */
  threadId: string;
  /** Run ID from response headers */
  runId: string | null;
  /** Message ID from response headers */
  messageId: string | null;
  /** Full assistant text accumulated during the run */
  fullText: string;
  /** Whether the run completed without error */
  ok: boolean;
}

/**
 * Unified hook for agent run state management.
 *
 * Consumes the SSE event stream from POST /api/chat directly,
 * replacing the dual useSendMessage + useSSE pattern.
 */
export function useAgentRun(options?: UseAgentRunOptions): UseAgentRunReturn {
  const [state, dispatch] = useReducer(agentRunReducer, INITIAL_AGENT_RUN_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const isRunningRef = useRef(false);

  // Stable refs for callbacks
  const onInterruptRef = useRef(options?.onInterrupt);
  onInterruptRef.current = options?.onInterrupt;
  const onInterruptResolvedRef = useRef(options?.onInterruptResolved);
  onInterruptResolvedRef.current = options?.onInterruptResolved;

  const send = useCallback(
    async (
      content: string,
      opts: {
        messages: Array<{ role: string; content: string }>;
        threadId: string;
        model: string;
        uploadIds?: string[];
        routeMode?: "local" | "free";
      }
    ): Promise<SendResult> => {
      if (isRunningRef.current) {
        return { threadId: opts.threadId, runId: null, messageId: null, fullText: "", ok: false };
      }

      isRunningRef.current = true;

      // Dispatch user message to the timeline
      dispatch({ type: "SUBMIT", content });

      const controller = new AbortController();
      abortRef.current = controller;

      let fullText = "";
      let runId: string | null = null;
      let messageId: string | null = null;
      let threadId = opts.threadId;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(opts.routeMode ? { "x-deck-route-mode": opts.routeMode } : {}),
          },
          body: JSON.stringify({
            messages: opts.messages,
            model: opts.model,
            threadId: opts.threadId,
            uploadIds: opts.uploadIds,
          }),
          signal: controller.signal,
        });

        // Extract IDs from response headers
        threadId = res.headers.get("X-Thread-Id") ?? opts.threadId;
        runId = res.headers.get("X-Run-Id");
        messageId = res.headers.get("X-Message-Id");

        if (!res.ok) {
          const errorText = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(errorText);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);

              // Track full text for message persistence
              if (event.type === "TextMessageContent" && event.delta) {
                fullText += event.delta;
              }

              // Handle interrupt events via callbacks (not reducer state)
              if (event.type === "InterruptRequested") {
                onInterruptRef.current?.({
                  runId: event.runId ?? "",
                  toolCallId: event.toolCallId ?? "",
                  toolName: event.toolName ?? "unknown",
                  args: event.args?.kind === "json" ? event.args.data : event.args,
                });
              } else if (event.type === "InterruptResolved") {
                onInterruptResolvedRef.current?.();
              } else {
                // Dispatch all other events to the state machine
                dispatchSSEEvent(dispatch, event);
              }
            } catch (err) {
              console.warn("[useAgentRun] Malformed SSE line:", line, err);
            }
          }
        }

        return { threadId, runId, messageId, fullText, ok: true };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User-initiated stop — already dispatched via stop()
        } else {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          dispatch({ type: "RUN_ERROR", runId: runId ?? "", error: errMsg });
        }
        return { threadId, runId, messageId, fullText, ok: false };
      } finally {
        abortRef.current = null;
        isRunningRef.current = false;
      }
    },
    []
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "STOP" });
  }, []);

  const isRunning = state.runState.phase !== "idle" && state.runState.phase !== "error";

  return { state, dispatch, send, stop, isRunning };
}
