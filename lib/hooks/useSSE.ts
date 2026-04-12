"use client";

import { useState, useEffect, useRef } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";
import type { InterruptRequest } from "@/components/chat/InterruptDialog";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface UseSSEOptions {
  threadId: string; // effectiveThreadId (activeThreadId || fallbackThreadId)
  canvas: { openCode: (...args: any[]) => string; updateTab: (...args: any[]) => void };
  onArtifactAttach: (artifact: Artifact) => void; // callback to attach artifacts to messages
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlanStep = { id: string; label: string; status: "pending" | "active" | "complete" | "error" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = { title: string; steps: PlanStep[] };

type Progress = { title: string; current: number; total: number; message?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Card = { type: "sports" | "weather" | "info"; data: any };

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export function useSSE({ threadId, canvas, onArtifactAttach }: UseSSEOptions) {
  // ---- State ----------------------------------------------------------------

  // Tool tracking
  const [toolCallStates, setToolCallStates] = useState<Map<string, ToolCallData>>(new Map());
  const [artifactsByRun, setArtifactsByRun] = useState<Record<string, Artifact[]>>({});

  // Thinking mode indicator
  const [isThinking, setIsThinking] = useState(false);

  // AG-UI Reasoning state
  const [reasoningContent, setReasoningContent] = useState<string>("");
  const [isReasoning, setIsReasoning] = useState(false);

  // AG-UI Activity state
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [currentProgress, setCurrentProgress] = useState<Progress | null>(null);

  // AG-UI Info Cards state (sports scores, weather, etc.)
  const [currentCards, setCurrentCards] = useState<Card[]>([]);

  // Agent-GO interrupt/approval state
  const [pendingInterrupt, setPendingInterrupt] = useState<InterruptRequest | null>(null);

  // ---- Refs -----------------------------------------------------------------

  const eventSourceRef = useRef<EventSource | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

  // Stable-ref wrappers so we never add callbacks to the useEffect dep array
  // (which would cause SSE reconnections every render).
  const onArtifactAttachRef = useRef(onArtifactAttach);
  onArtifactAttachRef.current = onArtifactAttach;
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  // ---- SSE Effect (lines 360-651 of ChatPaneV2) -----------------------------

  useEffect(() => {
    if (!threadId) return;

    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isCleaningUp = false;
    let isMounted = true;

    const createEventSource = () => {
      if (isCleaningUp) return;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      console.log("[SSE] Connecting to thread:", threadId);
      const eventSource = new EventSource(`/api/agui/stream?threadId=${threadId}`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (e) => {
        if (!isMounted) return;
        try {
          const event = JSON.parse(e.data);
          console.log("[SSE] Event received:", event.type, event);

          // ------------------------------------------------------------------
          // RunStarted
          // ------------------------------------------------------------------
          if (event.type === "RunStarted") {
            currentRunIdRef.current = event.runId;
            setIsThinking(event.thinking ?? false);
            // Reset reasoning/activity state for new run
            // NOTE: Don't clear cards here - they're fetched before the run starts
            // and attached to the message directly
            setReasoningContent("");
            setIsReasoning(false);
            setCurrentPlan(null);
            setCurrentProgress(null);
            console.log("[SSE] RunStarted - captured runId:", event.runId, "thinking:", event.thinking);
          }

          // ------------------------------------------------------------------
          // RunFinished / RunError
          // ------------------------------------------------------------------
          if (event.type === "RunFinished" || event.type === "RunError") {
            setIsThinking(false);
            setIsReasoning(false);
          }

          // ------------------------------------------------------------------
          // AG-UI Reasoning events
          // ------------------------------------------------------------------
          if (event.type === "ReasoningStart") {
            setIsReasoning(true);
            setReasoningContent("");
            console.log("[SSE] ReasoningStart");
          }

          if (event.type === "ReasoningMessageContent" || event.type === "ReasoningContent") {
            // Accumulate reasoning content
            setReasoningContent(prev => prev + (event.content || event.delta || ""));
            console.log("[SSE] ReasoningContent:", event.content || event.delta);
          }

          if (event.type === "ReasoningEnd") {
            setIsReasoning(false);
            console.log("[SSE] ReasoningEnd");
          }

          // ------------------------------------------------------------------
          // AG-UI Activity events
          // ------------------------------------------------------------------
          if (event.type === "ActivityPlan") {
            setCurrentPlan({
              title: event.title || "Plan",
              steps: (event.steps || []).map((s: { id?: string; label: string; status?: string }, idx: number) => ({
                id: s.id || `step-${idx}`,
                label: s.label,
                status: s.status || "pending",
              })),
            });
            console.log("[SSE] ActivityPlan:", event.title, event.steps);
          }

          if (event.type === "ActivityStepUpdate") {
            // Update a specific step in the current plan
            setCurrentPlan(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                steps: prev.steps.map(s =>
                  s.id === event.stepId ? { ...s, status: event.status } : s
                ),
              };
            });
            console.log("[SSE] ActivityStepUpdate:", event.stepId, event.status);
          }

          if (event.type === "ActivityProgress") {
            setCurrentProgress({
              title: event.title || "Progress",
              current: event.current || 0,
              total: event.total || 100,
              message: event.message,
            });
            console.log("[SSE] ActivityProgress:", event.current, "/", event.total);
          }

          if (event.type === "ActivityEnd") {
            // Clear activities when done
            setCurrentPlan(null);
            setCurrentProgress(null);
            console.log("[SSE] ActivityEnd");
          }

          // ------------------------------------------------------------------
          // AG-UI Info Card events (sports scores, weather, etc.)
          // ------------------------------------------------------------------
          if (event.type === "InfoCard" || event.type === "Card") {
            const cardType = (event.cardType || event.card?.type || "info") as "sports" | "weather" | "info";
            const cardData = {
              type: cardType,
              data: event.data || event.card?.data || event,
            };
            setCurrentCards(prev => [...prev, cardData]);
            console.log("[SSE] InfoCard:", cardData.type, cardData.data);
          }

          // ------------------------------------------------------------------
          // ToolCallStart
          // ------------------------------------------------------------------
          if (event.type === "ToolCallStart") {
            setToolCallStates((prev) => {
              const next = new Map(prev);
              next.set(event.toolCallId, {
                id: event.toolCallId,
                name: event.toolName,
                status: "running",
                startedAt: Date.now(),
              });
              return next;
            });
          }

          // ------------------------------------------------------------------
          // ToolCallArgs
          // ------------------------------------------------------------------
          if (event.type === "ToolCallArgs") {
            setToolCallStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(event.toolCallId);
              if (existing) {
                // Extract args from DeckPayload
                const args = event.args?.kind === "json" ? event.args.data : event.args;
                next.set(event.toolCallId, {
                  ...existing,
                  args: args as Record<string, unknown> | undefined,
                });
              }
              return next;
            });
          }

          // ------------------------------------------------------------------
          // ToolCallResult
          // ------------------------------------------------------------------
          if (event.type === "ToolCallResult") {
            setToolCallStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(event.toolCallId);
              if (existing) {
                // success is now at event level, result is DeckPayload
                const success = event.success ?? true; // default to success if not specified
                // Extract data from DeckPayload for UI display
                // Handle both JSON and GLYPH payloads
                let resultData: unknown;
                if (event.result?.kind === "json") {
                  resultData = event.result.data;
                } else if (event.result?.kind === "glyph") {
                  // Store GLYPH string with marker for UI to display specially
                  resultData = { _glyph: event.result.glyph, _approxBytes: event.result.approxBytes };
                } else if (event.result?.kind === "text") {
                  resultData = { message: event.result.text };
                } else {
                  resultData = event.result;
                }
                next.set(event.toolCallId, {
                  ...existing,
                  status: success ? "complete" : "error",
                  result: typeof resultData === "object" && resultData !== null
                    ? resultData as { success: boolean; message?: string; error?: string; data?: Record<string, unknown> }
                    : { success, message: String(resultData ?? "") },
                  durationMs: event.durationMs,
                });

                // Auto-open canvas for execute_code results
                if (existing.name === "execute_code" && success) {
                  const args = existing.args as { language?: string; code?: string } | undefined;
                  const result = resultData as { stdout?: string; stderr?: string; exitCode?: number; preview?: { bundled?: string }; images?: Array<{ name: string; mimeType: string; data: string }> } | undefined;

                  if (args?.code) {
                    // Open code in canvas with execution results
                    const tabId = canvasRef.current.openCode(
                      args.code,
                      args.language || "python",
                      `Code Execution`
                    );

                    // Update with execution results
                    canvasRef.current.updateTab(tabId, {
                      output: {
                        stdout: result?.stdout,
                        stderr: result?.stderr,
                        exitCode: result?.exitCode,
                        durationMs: event.durationMs,
                      },
                      preview: result?.preview,
                      images: result?.images,
                      isRunning: false,
                    });

                    console.log("[SSE] Auto-opened execute_code result in canvas:", tabId);
                  }
                }
              }
              return next;
            });
          }

          // ------------------------------------------------------------------
          // Agent-GO Interrupt events (approval workflow)
          // ------------------------------------------------------------------
          if (event.type === "InterruptRequested") {
            console.log("[SSE] InterruptRequested:", event.toolName, event.args);
            setPendingInterrupt({
              runId: event.runId || currentRunIdRef.current || "",
              toolCallId: event.toolCallId || "",
              toolName: event.toolName || "unknown",
              args: event.args?.kind === "json" ? event.args.data : event.args,
            });
          }

          if (event.type === "InterruptResolved") {
            console.log("[SSE] InterruptResolved:", event.approved);
            setPendingInterrupt(null);
          }

          // ------------------------------------------------------------------
          // ArtifactCreated
          // ------------------------------------------------------------------
          if (event.type === "ArtifactCreated") {
            console.log("[SSE] ArtifactCreated - runId:", event.runId, "currentRunId:", currentRunIdRef.current);
            const artifact: Artifact = {
              id: event.artifactId,
              url: event.url,
              name: event.name,
              mimeType: event.mimeType,
            };

            // Add to run artifacts (for streaming updates)
            setArtifactsByRun((prev) => ({
              ...prev,
              [event.runId]: [...(prev[event.runId] ?? []), artifact],
            }));

            // Attach artifact to the last assistant message via callback
            onArtifactAttachRef.current(artifact);
          }
        } catch (err) {
          console.warn("[SSE] Failed to parse event:", err);
        }
      };

      // Handle SSE errors with automatic reconnection
      eventSource.onerror = (e) => {
        console.error("[SSE] Connection error, readyState:", eventSource.readyState);
        // EventSource will automatically try to reconnect for CONNECTING state
        // But if it's in CLOSED state, we need to manually reconnect
        if (eventSource.readyState === EventSource.CLOSED && !isCleaningUp) {
          console.log("[SSE] Connection closed, reconnecting in 1s...");
          eventSource.close();
          eventSourceRef.current = null;
          reconnectTimeout = setTimeout(createEventSource, 1000);
        }
      };
    };

    createEventSource();

    return () => {
      isMounted = false;
      isCleaningUp = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [threadId]);

  // ---- Helpers --------------------------------------------------------------

  const resetForNewRun = () => {
    setToolCallStates(new Map());
    setArtifactsByRun({});
    currentRunIdRef.current = null;
    setReasoningContent("");
    setIsReasoning(false);
    setCurrentPlan(null);
    setCurrentProgress(null);
    setCurrentCards([]);
  };

  // ---- Return ---------------------------------------------------------------

  return {
    // Tool tracking
    toolCallStates,
    setToolCallStates,
    artifactsByRun,
    setArtifactsByRun,

    // Thinking / Reasoning
    isThinking,
    reasoningContent,
    isReasoning,

    // Activity
    currentPlan,
    currentProgress,

    // Info cards
    currentCards,
    setCurrentCards,

    // Interrupts
    pendingInterrupt,
    setPendingInterrupt,

    // Refs
    currentRunIdRef,

    // Actions
    resetForNewRun,
  };
}
