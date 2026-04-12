/**
 * AG-UI Event Types - aligned with https://docs.ag-ui.com/concepts/events
 * 
 * Schema Version 2: All payload fields use DeckPayload envelope
 */

import type { DeckPayload } from "./payload";
import { jsonPayload, isDeckPayload } from "./payload";

// =============================================================================
// Schema Version
// =============================================================================

/**
 * Current schema version - increment on breaking changes
 */
export const AGUI_SCHEMA_VERSION = 2;

export type SchemaVersion = 1 | 2;

// =============================================================================
// Base Event
// =============================================================================

export interface AGUIBase {
  type: string;
  timestamp: string;
  threadId: string;
  runId?: string;
  schemaVersion: SchemaVersion;
}

// =============================================================================
// Lifecycle Events
// =============================================================================

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

// =============================================================================
// Text Message Events
// =============================================================================

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

// =============================================================================
// Tool Events
// =============================================================================

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

// =============================================================================
// Artifact Events
// =============================================================================

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

// =============================================================================
// Cost Events
// =============================================================================

export interface CostIncurred extends AGUIBase {
  type: "CostIncurred";
  runId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

// =============================================================================
// Interrupt Events (Agent-GO approval workflow)
// =============================================================================

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

// =============================================================================
// Event Union
// =============================================================================

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
  | InterruptResolved;

export type AGUIEventType = AGUIEvent["type"];

// =============================================================================
// Event Factory
// =============================================================================

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

// =============================================================================
// Payload Helpers
// =============================================================================

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

// =============================================================================
// Migration: V1 → V2
// =============================================================================

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

// =============================================================================
// Type Guards
// =============================================================================

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
