/**
 * AG-UI Dojo Types - Complete Protocol Implementation
 * Based on https://docs.ag-ui.com/concepts/events
 * 
 * This extends the base events.ts with full AG-UI protocol support including:
 * - All 16+ standard event types
 * - State management (JSON Patch)
 * - Activity messages
 * - Reasoning events (draft)
 * - Interrupts (draft)
 * - Generative UI (draft)
 * - Meta events (draft)
 */

import type { DeckPayload } from "../payload";

// =============================================================================
// JSON Patch (RFC 6902)
// =============================================================================

export type JsonPatchOp = "add" | "remove" | "replace" | "move" | "copy" | "test";

export interface JsonPatchOperation {
  op: JsonPatchOp;
  path: string;
  value?: unknown;
  from?: string;
}

// =============================================================================
// Message Types
// =============================================================================

export type MessageRole = "user" | "assistant" | "system" | "tool" | "activity" | "developer" | "reasoning";

export interface BaseMessage {
  id: string;
  role: MessageRole;
  content?: string;
  name?: string;
}

/** Text input content */
export interface TextInputContent {
  type: "text";
  text: string;
}

/** Binary input content (images, audio, files) */
export interface BinaryInputContent {
  type: "binary";
  mimeType: string;
  id?: string;
  url?: string;
  data?: string; // base64
  filename?: string;
}

export type InputContent = TextInputContent | BinaryInputContent;

/** User message - supports multimodal */
export interface UserMessage extends Omit<BaseMessage, "content"> {
  role: "user";
  content: string | InputContent[];
}

/** Tool call within assistant message */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Assistant message with optional tool calls */
export interface AssistantMessage extends BaseMessage {
  role: "assistant";
  content?: string;
  toolCalls?: ToolCall[];
}

/** System instruction message */
export interface SystemMessage extends BaseMessage {
  role: "system";
  content: string;
}

/** Tool result message */
export interface ToolMessage extends BaseMessage {
  role: "tool";
  content: string;
  toolCallId: string;
}

/** Activity message - frontend-only UI state */
export interface ActivityMessage extends Omit<BaseMessage, "content"> {
  role: "activity";
  activityType: string;
  content: Record<string, unknown>;
}

/** Developer/debug message */
export interface DeveloperMessage extends BaseMessage {
  role: "developer";
  content: string;
}

/** Reasoning message (draft) */
export interface ReasoningMessage extends Omit<BaseMessage, "content"> {
  role: "reasoning";
  content: string[];
  encryptedContent?: string;
}

export type Message = 
  | UserMessage 
  | AssistantMessage 
  | SystemMessage 
  | ToolMessage 
  | ActivityMessage 
  | DeveloperMessage
  | ReasoningMessage;

// =============================================================================
// Tool Definitions
// =============================================================================

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

// =============================================================================
// Extended Event Types (Full AG-UI Protocol)
// =============================================================================

export interface AGUIEventBase {
  type: string;
  timestamp?: string;
  threadId: string;
  runId?: string;
}

// --- Lifecycle Events ---

export interface RunStartedEvent extends AGUIEventBase {
  type: "RUN_STARTED";
  runId: string;
  parentRunId?: string;
  input?: DeckPayload;
}

export interface RunFinishedEvent extends AGUIEventBase {
  type: "RUN_FINISHED";
  runId: string;
  result?: unknown;
  outcome?: "success" | "interrupt";
  interrupt?: {
    id?: string;
    reason?: string;
    payload?: unknown;
  };
}

export interface RunErrorEvent extends AGUIEventBase {
  type: "RUN_ERROR";
  message: string;
  code?: string;
}

export interface StepStartedEvent extends AGUIEventBase {
  type: "STEP_STARTED";
  stepName: string;
}

export interface StepFinishedEvent extends AGUIEventBase {
  type: "STEP_FINISHED";
  stepName: string;
}

// --- Text Message Events ---

export interface TextMessageStartEvent extends AGUIEventBase {
  type: "TEXT_MESSAGE_START";
  messageId: string;
  role: MessageRole;
}

export interface TextMessageContentEvent extends AGUIEventBase {
  type: "TEXT_MESSAGE_CONTENT";
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent extends AGUIEventBase {
  type: "TEXT_MESSAGE_END";
  messageId: string;
}

export interface TextMessageChunkEvent extends AGUIEventBase {
  type: "TEXT_MESSAGE_CHUNK";
  messageId?: string;
  role?: MessageRole;
  delta?: string;
}

// --- Tool Call Events ---

export interface ToolCallStartEvent extends AGUIEventBase {
  type: "TOOL_CALL_START";
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
}

export interface ToolCallArgsEvent extends AGUIEventBase {
  type: "TOOL_CALL_ARGS";
  toolCallId: string;
  delta: string;
}

export interface ToolCallEndEvent extends AGUIEventBase {
  type: "TOOL_CALL_END";
  toolCallId: string;
}

export interface ToolCallResultEvent extends AGUIEventBase {
  type: "TOOL_CALL_RESULT";
  messageId: string;
  toolCallId: string;
  content: string;
  role?: "tool";
}

export interface ToolCallChunkEvent extends AGUIEventBase {
  type: "TOOL_CALL_CHUNK";
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  delta?: string;
}

// --- State Management Events ---

export interface StateSnapshotEvent extends AGUIEventBase {
  type: "STATE_SNAPSHOT";
  snapshot: unknown;
}

export interface StateDeltaEvent extends AGUIEventBase {
  type: "STATE_DELTA";
  delta: JsonPatchOperation[];
}

export interface MessagesSnapshotEvent extends AGUIEventBase {
  type: "MESSAGES_SNAPSHOT";
  messages: Message[];
}

// --- Activity Events ---

export interface ActivitySnapshotEvent extends AGUIEventBase {
  type: "ACTIVITY_SNAPSHOT";
  messageId: string;
  activityType: string;
  content: Record<string, unknown>;
  replace?: boolean;
}

export interface ActivityDeltaEvent extends AGUIEventBase {
  type: "ACTIVITY_DELTA";
  messageId: string;
  activityType: string;
  patch: JsonPatchOperation[];
}

// --- Special Events ---

export interface RawEvent extends AGUIEventBase {
  type: "RAW";
  event: unknown;
  source?: string;
}

export interface CustomEvent extends AGUIEventBase {
  type: "CUSTOM";
  name: string;
  value: unknown;
}

// --- Reasoning Events (Draft) ---

export interface ReasoningStartEvent extends AGUIEventBase {
  type: "REASONING_START";
  messageId: string;
  encryptedContent?: string;
}

export interface ReasoningMessageStartEvent extends AGUIEventBase {
  type: "REASONING_MESSAGE_START";
  messageId: string;
  role: "assistant";
}

export interface ReasoningMessageContentEvent extends AGUIEventBase {
  type: "REASONING_MESSAGE_CONTENT";
  messageId: string;
  delta: string;
}

export interface ReasoningMessageEndEvent extends AGUIEventBase {
  type: "REASONING_MESSAGE_END";
  messageId: string;
}

export interface ReasoningMessageChunkEvent extends AGUIEventBase {
  type: "REASONING_MESSAGE_CHUNK";
  messageId?: string;
  delta?: string;
}

export interface ReasoningEndEvent extends AGUIEventBase {
  type: "REASONING_END";
  messageId: string;
}

// --- Meta Events (Draft) ---

export interface MetaEvent extends AGUIEventBase {
  type: "META";
  metaType: string;
  payload: Record<string, unknown>;
}

// =============================================================================
// Event Union
// =============================================================================

export type DojoEvent =
  // Lifecycle
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  // Text Messages
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | TextMessageChunkEvent
  // Tool Calls
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | ToolCallChunkEvent
  // State
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent
  // Activity
  | ActivitySnapshotEvent
  | ActivityDeltaEvent
  // Special
  | RawEvent
  | CustomEvent
  // Reasoning (Draft)
  | ReasoningStartEvent
  | ReasoningMessageStartEvent
  | ReasoningMessageContentEvent
  | ReasoningMessageEndEvent
  | ReasoningMessageChunkEvent
  | ReasoningEndEvent
  // Meta (Draft)
  | MetaEvent;

export type DojoEventType = DojoEvent["type"];

// =============================================================================
// Interrupt Types
// =============================================================================

export interface InterruptRequest {
  id: string;
  reason: string;
  payload: unknown;
}

export interface InterruptResponse {
  interruptId: string;
  payload: unknown;
}

// =============================================================================
// Generative UI Types
// =============================================================================

export interface GenerateUIRequest {
  description: string;
  data?: Record<string, unknown>;
  output?: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeneratedUI {
  jsonSchema?: Record<string, unknown>;
  uiSchema?: Record<string, unknown>;
  initialData?: Record<string, unknown>;
  component?: string; // React component code
}

// =============================================================================
// Run Input
// =============================================================================

export interface RunAgentInput {
  threadId: string;
  runId?: string;
  messages: Message[];
  tools?: Tool[];
  context?: Record<string, unknown>;
  resume?: InterruptResponse;
}
