// AG-UI Event Types - aligned with https://docs.ag-ui.com/concepts/events

export interface AGUIBase {
  type: string;
  timestamp: string;
  threadId: string;
  runId?: string;
}

// Lifecycle Events
export interface RunStarted extends AGUIBase {
  type: "RunStarted";
  runId: string;
  model?: string;
  input?: unknown;
  thinking?: boolean; // Whether reasoning mode is enabled
}

export interface RunFinished extends AGUIBase {
  type: "RunFinished";
  runId: string;
  output?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface RunError extends AGUIBase {
  type: "RunError";
  runId: string;
  error: { message: string; stack?: string };
}

// Text Message Events
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

// Tool Events
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
  delta: string;
}

export interface ToolCallResult extends AGUIBase {
  type: "ToolCallResult";
  runId: string;
  toolCallId: string;
  result: unknown;
}

// Artifact Events
export interface ArtifactCreated extends AGUIBase {
  type: "ArtifactCreated";
  runId: string;
  toolCallId?: string;
  artifactId: string;
  mimeType: string; // "image/png", "audio/wav", "model/glb", etc.
  url: string; // proxied URL from deck
  name: string; // human-readable label
  originalPath?: string; // path in source system (e.g., ComfyUI output)
  localPath?: string; // path in deck storage after copy
  meta?: Record<string, unknown>; // width, height, seed, prompt_id, duration, etc.
}

// Cost Events
export interface CostIncurred extends AGUIBase {
  type: "CostIncurred";
  runId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
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
  | CostIncurred;

export function createEvent<T extends AGUIEvent>(
  type: T["type"],
  threadId: string,
  data: Omit<T, "type" | "timestamp" | "threadId">
): T {
  return {
    type,
    timestamp: new Date().toISOString(),
    threadId,
    ...data,
  } as T;
}

export function generateId(): string {
  return crypto.randomUUID();
}
