/**
 * AG-UI Event Types — canonical event protocol for Control-Deck.
 *
 * Structurally aligned with the AG-UI spec
 * (https://docs.ag-ui.com/concepts/events), the open agent-to-UI
 * interaction protocol adopted by LangGraph, CrewAI, Mastra, AG2,
 * Pydantic AI, LlamaIndex, Google ADK, MS Agent Framework, and AWS
 * Strands. This module is the source of truth for every event that
 * flows through the deck's SSE/WS pipeline.
 *
 * Deck-specific extensions (not in the base spec):
 *   • `DeckPayload` envelope wraps all payload fields (JSON or GLYPH-
 *     compressed) so downstream code can decode uniformly. See
 *     `lib/agui/payload.ts`.
 *   • `ArtifactCreated` — deck surfaces tool outputs (images, audio,
 *     3D models, files) as first-class events.
 *   • `CostIncurred` — token/cost telemetry per run.
 *
 * The `@/lib/agentgo` module mirrors this union with the Agent-GO wire
 * format (no DeckPayload envelope, flat fields) — keep the two in sync
 * when adding event types.
 *
 * Schema Version 2: All payload fields use DeckPayload envelope.
 */

import type { DeckPayload } from "./payload";
import { jsonPayload, isDeckPayload } from "./payload";

/**
 * Current schema version - increment on breaking changes
 */
export const AGUI_SCHEMA_VERSION = 2;

export type SchemaVersion = 1 | 2;

export interface AGUIBase {
  type: string;
  timestamp: string;
  threadId: string;
  runId?: string;
  schemaVersion: SchemaVersion;
}

export interface RunStarted extends AGUIBase {
  type: "RunStarted";
  runId: string;
  model?: string;
  input?: DeckPayload;
  thinking?: boolean;
}

export interface RunFinished extends AGUIBase {
  type: "RunFinished";
  runId: string;
  output?: DeckPayload;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** LLM-generated thread title (SURFACE.md §6.2) */
  threadTitle?: string;
}

export interface RunError extends AGUIBase {
  type: "RunError";
  runId: string;
  error: { 
    message: string; 
    stack?: string;
    code?: string;
  };
}

export interface TextMessageStart extends AGUIBase {
  type: "TextMessageStart";
  runId: string;
  messageId: string;
  role: "assistant" | "user" | "system";
}

export interface TextMessageContent extends AGUIBase {
  type: "TextMessageContent";
  runId: string;
  messageId: string;
  delta: string;
}

export interface TextMessageEnd extends AGUIBase {
  type: "TextMessageEnd";
  runId: string;
  messageId: string;
}

export interface ToolCallStart extends AGUIBase {
  type: "ToolCallStart";
  runId: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolCallArgs extends AGUIBase {
  type: "ToolCallArgs";
  runId: string;
  toolCallId: string;
  /** Streaming args delta (JSON string fragment) */
  delta: string;
  /** Complete args - always JSON for tool input */
  args?: DeckPayload;
}

export interface ToolCallResult extends AGUIBase {
  type: "ToolCallResult";
  runId: string;
  toolCallId: string;
  /** Tool execution result - DeckPayload envelope (may be JSON or GLYPH) */
  result: DeckPayload;
  /** Did the tool succeed? */
  success?: boolean;
  /** Execution duration in ms */
  durationMs?: number;
}

export interface ArtifactCreated extends AGUIBase {
  type: "ArtifactCreated";
  runId: string;
  toolCallId?: string;
  artifactId: string;
  mimeType: string;
  url: string;
  name: string;
  originalPath?: string;
  localPath?: string;
  /** Artifact metadata - accepts DeckPayload or plain object for convenience */
  meta?: DeckPayload | Record<string, unknown>;
}

export interface CostIncurred extends AGUIBase {
  type: "CostIncurred";
  runId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

export interface InterruptRequested extends AGUIBase {
  type: "InterruptRequested";
  runId: string;
  toolCallId: string;
  toolName: string;
  args?: DeckPayload;
}

export interface InterruptResolved extends AGUIBase {
  type: "InterruptResolved";
  runId: string;
  toolCallId?: string;
  approved: boolean;
  reason?: string;
}

/**
 * AG-UI spec lifecycle events — surfaces the agent's plan / step
 * boundaries so UIs can render progress.
 */
export interface StepStarted extends AGUIBase {
  type: "StepStarted";
  runId: string;
  stepIndex: number;
  /** Human-readable description of what this step does */
  description?: string;
  /** Optional stable id the agent assigns to the step */
  stepId?: string;
}

export interface StepFinished extends AGUIBase {
  type: "StepFinished";
  runId: string;
  stepIndex: number;
  stepId?: string;
  /** Did the step succeed? (undefined = unknown / partial) */
  success?: boolean;
  result?: DeckPayload;
}

export type AGUIEvent =
  | RunStarted
  | RunFinished
  | RunError
  | TextMessageStart
  | TextMessageContent
  | TextMessageEnd
  | ToolCallStart
  | ToolCallArgs
  | ToolCallResult
  | ArtifactCreated
  | CostIncurred
  | InterruptRequested
  | InterruptResolved
  | StepStarted
  | StepFinished;

export type AGUIEventType = AGUIEvent["type"];

/**
 * Create a new AG-UI event with automatic timestamp and schema version
 */
export function createEvent<T extends AGUIEvent>(
  type: T["type"],
  threadId: string,
  data: Omit<T, "type" | "timestamp" | "threadId" | "schemaVersion">
): T {
  return {
    type,
    timestamp: new Date().toISOString(),
    threadId,
    schemaVersion: AGUI_SCHEMA_VERSION,
    ...data,
  } as T;
}

/**
 * Generate a unique ID (UUID v4)
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Wrap any value in DeckPayload if not already wrapped
 * Use when creating events with payload fields
 */
export function wrapPayload(value: unknown): DeckPayload {
  if (isDeckPayload(value)) {
    return value;
  }
  return jsonPayload(value);
}

/**
 * Normalize an event loaded from DB to current schema
 * Wraps raw values in DeckPayload envelopes
 */
export function normalizeEvent(raw: unknown): AGUIEvent {
  const event = raw as Record<string, unknown>;
  
  // Add schema version if missing (v1)
  if (!event.schemaVersion) {
    event.schemaVersion = 1;
  }
  
  // If v1, migrate payload fields
  if (event.schemaVersion === 1) {
    event.schemaVersion = 2;
    
    // Migrate based on event type
    switch (event.type) {
      case "RunStarted":
        if (event.input !== undefined && !isDeckPayload(event.input)) {
          event.input = jsonPayload(event.input);
        }
        break;
      
      case "RunFinished":
        if (event.output !== undefined && !isDeckPayload(event.output)) {
          event.output = jsonPayload(event.output);
        }
        break;
      
      case "ToolCallArgs":
        if (event.args !== undefined && !isDeckPayload(event.args)) {
          event.args = jsonPayload(event.args);
        }
        break;
      
      case "ToolCallResult":
        if (event.result !== undefined && !isDeckPayload(event.result)) {
          event.result = jsonPayload(event.result);
        }
        break;
      
      case "ArtifactCreated":
        if (event.meta !== undefined && !isDeckPayload(event.meta)) {
          event.meta = jsonPayload(event.meta);
        }
        break;
    }
  }
  
  // Cast through unknown to satisfy TypeScript
  return event as unknown as AGUIEvent;
}

export function isRunStarted(e: AGUIEvent): e is RunStarted {
  return e.type === "RunStarted";
}

export function isRunFinished(e: AGUIEvent): e is RunFinished {
  return e.type === "RunFinished";
}

export function isRunError(e: AGUIEvent): e is RunError {
  return e.type === "RunError";
}

export function isTextMessageStart(e: AGUIEvent): e is TextMessageStart {
  return e.type === "TextMessageStart";
}

export function isTextMessageContent(e: AGUIEvent): e is TextMessageContent {
  return e.type === "TextMessageContent";
}

export function isTextMessageEnd(e: AGUIEvent): e is TextMessageEnd {
  return e.type === "TextMessageEnd";
}

export function isToolCallStart(e: AGUIEvent): e is ToolCallStart {
  return e.type === "ToolCallStart";
}

export function isToolCallArgs(e: AGUIEvent): e is ToolCallArgs {
  return e.type === "ToolCallArgs";
}

export function isToolCallResult(e: AGUIEvent): e is ToolCallResult {
  return e.type === "ToolCallResult";
}

export function isArtifactCreated(e: AGUIEvent): e is ArtifactCreated {
  return e.type === "ArtifactCreated";
}

export function isCostIncurred(e: AGUIEvent): e is CostIncurred {
  return e.type === "CostIncurred";
}

export function isInterruptRequested(e: AGUIEvent): e is InterruptRequested {
  return e.type === "InterruptRequested";
}

export function isInterruptResolved(e: AGUIEvent): e is InterruptResolved {
  return e.type === "InterruptResolved";
}

export function isStepStarted(e: AGUIEvent): e is StepStarted {
  return e.type === "StepStarted";
}

export function isStepFinished(e: AGUIEvent): e is StepFinished {
  return e.type === "StepFinished";
}
