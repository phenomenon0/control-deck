"use client";

import { useEffect, useRef, useCallback } from "react";
import type { DemoInfo } from "./DemoCard";
import type { DojoEvent } from "@/lib/agui/dojo";

// =============================================================================
// Types
// =============================================================================

interface DemoRunnerProps {
  demo: DemoInfo;
  onEvent: (event: DojoEvent) => void;
  onComplete: () => void;
}

// =============================================================================
// DemoRunner Component
// =============================================================================

/**
 * DemoRunner - Invisible component that handles demo execution
 * 
 * 1. Creates a unique threadId for the demo
 * 2. Connects to SSE stream at /api/dojo/stream
 * 3. Triggers demo via POST /api/dojo/demo
 * 4. Forwards all events to parent
 * 5. Cleans up on unmount or completion
 */
export function DemoRunner({ demo, onEvent, onComplete }: DemoRunnerProps) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const threadIdRef = useRef<string>(`dojo_${demo.id}_${Date.now()}`);
  const completedRef = useRef(false);

  // Handle incoming SSE events
  const handleMessage = useCallback(
    (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as DojoEvent;
        onEvent(event);

        // Check for completion events
        if (
          event.type === "RUN_FINISHED" ||
          event.type === "RUN_ERROR"
        ) {
          completedRef.current = true;
          onComplete();
        }
      } catch (err) {
        console.error("[DemoRunner] Failed to parse event:", err);
      }
    },
    [onEvent, onComplete]
  );

  // Connect and run demo
  useEffect(() => {
    const threadId = threadIdRef.current;
    completedRef.current = false;

    // 1. Connect to SSE stream
    const eventSource = new EventSource(`/api/dojo/stream?threadId=${threadId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = async () => {
      // 2. Trigger the demo
      try {
        const response = await fetch("/api/dojo/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            demo: demo.id,
            model: demo.model || "llama3.2",
            input: getDemoInput(demo.id),
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[DemoRunner] Demo trigger failed:", errorText);
          onEvent({
            type: "RUN_ERROR",
            threadId,
            runId: `run_${threadId}`,
            message: `Failed to start demo: ${errorText}`,
          } as DojoEvent);
          onComplete();
        }
      } catch (err) {
        console.error("[DemoRunner] Demo request failed:", err);
        onEvent({
          type: "RUN_ERROR",
          threadId,
          runId: `run_${threadId}`,
          message: `Network error: ${err}`,
        } as DojoEvent);
        onComplete();
      }
    };

    eventSource.onmessage = handleMessage;

    eventSource.onerror = () => {
      if (!completedRef.current) {
        console.error("[DemoRunner] SSE connection error");
        onComplete();
      }
      eventSource.close();
    };

    // Cleanup
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [demo.id, demo.model, handleMessage, onEvent, onComplete]);

  // This component renders nothing - it's purely for side effects
  return null;
}

// =============================================================================
// Demo Input Helpers
// =============================================================================

function getDemoInput(demoId: string): string {
  const inputs: Record<string, string> = {
    shared_state: "Initialize counter",
    tool_calling: "Search for weather in Tokyo",
    activity: "Create a project plan",
    reasoning: "Explain quantum entanglement",
    interrupt: "Delete user data",
    generative_ui: "Create a booking form",
    meta_events: "Generate a helpful response",
    multimodal: "Describe this image",
    poetry: "Write a haiku about coding at midnight",
    travel: "Plan a week-long trip to Japan",
    research: "What are the latest advances in AI?",
    approval: "Transfer $500 to external account",
    form: "Collect user contact information",
  };
  return inputs[demoId] || "Run demo";
}
