/**
 * AG-UI Dojo — REFERENCE IMPLEMENTATION (kept in-tree intentionally).
 *
 * Not the default path — see `../README.md` and `../events.ts` for the
 * canonical AG-UI event protocol used by the main deck surface. This
 * dojo is a richer, more experimental implementation we plan to mine
 * as those features mature (generative UI, reasoning traces,
 * activity messages, meta events). Do NOT import from production
 * paths; treat it as a staging area.
 *
 * Full AG-UI protocol implementation including:
 * - All 16+ standard event types
 * - State management with JSON Patch
 * - Activity messages for streaming UI
 * - Tools system with frontend execution
 * - Reasoning events (draft)
 * - Interrupts/human-in-the-loop (draft)
 * - Generative UI (draft)
 * - Meta events (draft)
 *
 * @see https://docs.ag-ui.com
 */

// Types
export * from "./types";

// State Management
export * from "./state";

// Activity System
export * from "./activity";

// Tools System
export * from "./tools";

// Reasoning
export * from "./reasoning";

// Interrupts
export * from "./interrupts";

// Generative UI
export * from "./generative-ui";

// Meta Events
export * from "./meta";

import { createStateStore, type StateStore } from "./state";
import { createActivityStore, type ActivityStore } from "./activity";
import { createToolRegistry, createToolCallManager, type ToolRegistry, type ToolCallManager } from "./tools";
import { createReasoningStore, createThinkingIndicator, type ReasoningStore } from "./reasoning";
import { createInterruptStore, type InterruptStore } from "./interrupts";
import { createMetaEventStore, type MetaEventStore } from "./meta";
import type { DojoEvent, Message } from "./types";

export interface DojoStore {
  // Core state
  state: StateStore;
  messages: Message[];
  
  // Subsystems
  activities: ActivityStore;
  tools: ToolRegistry;
  toolCalls: ToolCallManager;
  reasoning: ReasoningStore;
  interrupts: InterruptStore;
  meta: MetaEventStore;
  thinking: ReturnType<typeof createThinkingIndicator>;
  
  // Event handling
  processEvent(event: DojoEvent): void;
  
  // Cleanup
  destroy(): void;
}

/**
 * Create a unified Dojo store with all subsystems
 */
export function createDojoStore(initialState: Record<string, unknown> = {}): DojoStore {
  const state = createStateStore(initialState);
  const activities = createActivityStore();
  const tools = createToolRegistry();
  const toolCalls = createToolCallManager();
  const reasoning = createReasoningStore();
  const interrupts = createInterruptStore();
  const meta = createMetaEventStore();
  const thinking = createThinkingIndicator();
  
  const messages: Message[] = [];
  
  const store: DojoStore = {
    state,
    messages,
    activities,
    tools,
    toolCalls,
    reasoning,
    interrupts,
    meta,
    thinking,
    
    processEvent: (event: DojoEvent) => {
      switch (event.type) {
        // State events
        case "STATE_SNAPSHOT":
          state.setState(event.snapshot as Record<string, unknown>);
          break;
        
        case "STATE_DELTA":
          state.applyDelta(event.delta);
          break;
        
        // Activity events
        case "ACTIVITY_SNAPSHOT":
          activities.set(event.messageId, {
            id: event.messageId,
            role: "activity",
            activityType: event.activityType,
            content: event.content,
          });
          break;
        
        case "ACTIVITY_DELTA":
          activities.update(event.messageId, event.patch);
          break;
        
        // Tool events
        case "TOOL_CALL_START":
          toolCalls.start(event.toolCallId, event.toolCallName);
          break;
        
        case "TOOL_CALL_ARGS":
          toolCalls.appendArgs(event.toolCallId, event.delta);
          break;
        
        case "TOOL_CALL_END":
          toolCalls.finishArgs(event.toolCallId);
          break;
        
        case "TOOL_CALL_RESULT":
          toolCalls.setResult(event.toolCallId, event.content);
          break;
        
        // Reasoning events
        case "REASONING_START":
          reasoning.start(event.messageId, event.encryptedContent);
          thinking.start("Thinking...");
          break;
        
        case "REASONING_MESSAGE_START":
          reasoning.startMessage(event.messageId);
          break;
        
        case "REASONING_MESSAGE_CONTENT":
          reasoning.appendContent(event.messageId, event.delta);
          break;
        
        case "REASONING_MESSAGE_END":
          reasoning.endMessage(event.messageId);
          break;
        
        case "REASONING_END":
          reasoning.end(event.messageId);
          thinking.stop();
          break;
        
        // Meta events
        case "META":
          meta.add(event);
          break;
        
        // Lifecycle events
        case "RUN_STARTED":
          thinking.start();
          break;
        
        case "RUN_FINISHED":
          thinking.stop();
          // Check for interrupt
          if (event.outcome === "interrupt" && event.interrupt) {
            interrupts.create(
              event.threadId,
              event.runId!,
              event.interrupt.reason || "unknown",
              event.interrupt.payload as Record<string, unknown>
            );
          }
          break;
        
        case "RUN_ERROR":
          thinking.stop();
          break;
      }
    },
    
    destroy: () => {
      // Cleanup subscriptions if needed
    },
  };
  
  return store;
}

export type DojoEventHandler = (event: DojoEvent) => void;

export interface DojoEventEmitter {
  emit(event: DojoEvent): void;
  on(handler: DojoEventHandler): () => void;
  off(handler: DojoEventHandler): void;
}

/**
 * Create an event emitter for Dojo events
 */
export function createDojoEventEmitter(): DojoEventEmitter {
  const handlers = new Set<DojoEventHandler>();
  
  return {
    emit: (event: DojoEvent) => {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (e) {
          console.error("[DojoEmitter] Handler error:", e);
        }
      }
    },
    
    on: (handler: DojoEventHandler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    
    off: (handler: DojoEventHandler) => {
      handlers.delete(handler);
    },
  };
}
