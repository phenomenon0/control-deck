/**
 * React hook for Agent-GO run management
 * 
 * Handles:
 * - Starting runs
 * - Streaming events via SSE
 * - Managing approval dialogs
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  startRun,
  startRunWithStream,
  streamEvents,
  approveRun,
  rejectRun,
  getRunStatus,
  type StartRunRequest,
  type AgentGoEvent,
  type RunStatus,
} from "./client";

export interface UseAgentGoRunOptions {
  /** Auto-start streaming when runId is set */
  autoStream?: boolean;
  /** Use fetch streaming for text (like ChatPaneV2) instead of SSE-only */
  useTextStream?: boolean;
  /** Callback when an event is received */
  onEvent?: (event: AgentGoEvent) => void;
  /** Callback when an interrupt is requested */
  onInterrupt?: (event: AgentGoEvent) => void;
  /** Callback when run completes */
  onComplete?: () => void;
  /** Callback when text chunk is received (for streaming) */
  onTextChunk?: (chunk: string, fullText: string) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export interface PendingInterrupt {
  runId: string;
  requestId?: string;
  toolName: string;
  args: unknown;
  timestamp: string;
}

export interface UseAgentGoRunReturn {
  /** Current run ID */
  runId: string | null;
  /** Run status */
  status: "idle" | "running" | "completed" | "failed";
  /** All events received */
  events: AgentGoEvent[];
  /** Accumulated assistant text (from streaming) */
  assistantText: string;
  /** Is text currently streaming */
  isTextStreaming: boolean;
  /** Pending interrupt (if any) */
  pendingInterrupt: PendingInterrupt | null;
  /** Is currently streaming (SSE events) */
  isStreaming: boolean;
  /** Start a new run */
  start: (req: StartRunRequest) => Promise<string>;
  /** Stop streaming */
  stop: () => void;
  /** Approve pending interrupt */
  approve: () => Promise<void>;
  /** Reject pending interrupt */
  reject: (reason?: string) => Promise<void>;
  /** Clear state */
  reset: () => void;
}

export function useAgentGoRun(options: UseAgentGoRunOptions = {}): UseAgentGoRunReturn {
  const { 
    autoStream = true, 
    useTextStream = true,
    onEvent, 
    onInterrupt, 
    onComplete, 
    onTextChunk,
    onError 
  } = options;

  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [events, setEvents] = useState<AgentGoEvent[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [isTextStreaming, setIsTextStreaming] = useState(false);
  const [pendingInterrupt, setPendingInterrupt] = useState<PendingInterrupt | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef<(() => void) | null>(null);
  const textAbortRef = useRef<AbortController | null>(null);

  // Handle incoming events
  const handleEvent = useCallback((event: AgentGoEvent) => {
    setEvents((prev) => [...prev, event]);
    onEvent?.(event);

    // Handle specific event types
    switch (event.type) {
      case "RunStarted":
        setStatus("running");
        break;

      case "RunFinished":
        setStatus("completed");
        onComplete?.();
        break;

      case "RunError":
        setStatus("failed");
        onError?.(new Error(event.error?.message || "Run failed"));
        break;

      case "InterruptRequested": {
        const interrupt: PendingInterrupt = {
          runId: event.runId,
          requestId: event.requestId,
          toolName: event.toolName || "unknown",
          args: event.args,
          timestamp: event.timestamp,
        };
        setPendingInterrupt(interrupt);
        onInterrupt?.(event);
        break;
      }

      case "InterruptResolved":
        setPendingInterrupt(null);
        break;

      // Handle text message events (SSE fallback if not using fetch stream)
      case "TextMessageContent":
        if (!useTextStream) {
          const delta = event.delta || "";
          setAssistantText(prev => prev + delta);
          onTextChunk?.(delta, ""); // fullText not available in SSE mode
        }
        break;

      case "TextMessageStart":
        if (!useTextStream) {
          setIsTextStreaming(true);
        }
        break;

      case "TextMessageEnd":
        if (!useTextStream) {
          setIsTextStreaming(false);
        }
        break;
    }
  }, [onEvent, onInterrupt, onComplete, onError, useTextStream, onTextChunk]);

  // Start streaming events
  const startStreaming = useCallback((id: string) => {
    if (abortRef.current) {
      abortRef.current();
    }

    setIsStreaming(true);

    abortRef.current = streamEvents(id, {
      onEvent: handleEvent,
      onError: (err) => {
        setIsStreaming(false);
        onError?.(err);
      },
      onDone: () => {
        setIsStreaming(false);
      },
    });
  }, [handleEvent, onError]);

  // Stop streaming
  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    if (textAbortRef.current) {
      textAbortRef.current.abort();
      textAbortRef.current = null;
    }
    setIsStreaming(false);
    setIsTextStreaming(false);
  }, []);

  // Start a new run
  const start = useCallback(async (req: StartRunRequest): Promise<string> => {
    try {
      // Reset state
      setEvents([]);
      setAssistantText("");
      setPendingInterrupt(null);
      setStatus("idle");
      setIsTextStreaming(false);
      stop();

      // Cancel any pending text stream
      if (textAbortRef.current) {
        textAbortRef.current.abort();
        textAbortRef.current = null;
      }

      let id: string;

      if (useTextStream) {
        // Option B: Fetch stream for text (ChatPaneV2 pattern)
        textAbortRef.current = new AbortController();
        
        const { runId: streamRunId, reader } = await startRunWithStream(
          req, 
          textAbortRef.current.signal
        );
        id = streamRunId;
        setRunId(id);
        setStatus("running");
        setIsTextStreaming(true);

        // Auto-start SSE for tools/artifacts
        if (autoStream) {
          startStreaming(id);
        }

        // Stream text in parallel (non-blocking)
        const decoder = new TextDecoder();
        (async () => {
          let fullText = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const chunk = decoder.decode(value, { stream: true });
              fullText += chunk;
              setAssistantText(fullText);
              onTextChunk?.(chunk, fullText);
            }
          } catch (err) {
            // Ignore abort errors
            if (err instanceof Error && err.name !== "AbortError") {
              console.error("[AgentGo] Text stream error:", err);
              onError?.(err);
            }
          } finally {
            setIsTextStreaming(false);
          }
        })();
      } else {
        // Original: SSE-only mode
        id = await startRun(req);
        setRunId(id);
        setStatus("running");

        // Auto-start streaming
        if (autoStream) {
          startStreaming(id);
        }
      }

      return id;
    } catch (err) {
      setStatus("failed");
      setIsTextStreaming(false);
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
      throw error;
    }
  }, [autoStream, useTextStream, startStreaming, stop, onError, onTextChunk]);

  // Approve pending interrupt
  const approve = useCallback(async () => {
    if (!runId || !pendingInterrupt) return;

    try {
      await approveRun(runId, pendingInterrupt.requestId);
      setPendingInterrupt(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
      throw error;
    }
  }, [runId, pendingInterrupt, onError]);

  // Reject pending interrupt
  const reject = useCallback(async (reason?: string) => {
    if (!runId || !pendingInterrupt) return;

    try {
      await rejectRun(runId, reason, pendingInterrupt.requestId);
      setPendingInterrupt(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
      throw error;
    }
  }, [runId, pendingInterrupt, onError]);

  // Reset state
  const reset = useCallback(() => {
    stop();
    setRunId(null);
    setStatus("idle");
    setEvents([]);
    setAssistantText("");
    setPendingInterrupt(null);
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current();
      }
      if (textAbortRef.current) {
        textAbortRef.current.abort();
      }
    };
  }, []);

  return {
    runId,
    status,
    events,
    assistantText,
    isTextStreaming,
    pendingInterrupt,
    isStreaming,
    start,
    stop,
    approve,
    reject,
    reset,
  };
}
