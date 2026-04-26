/**
 * Wire types for the Agent-GO HTTP/SSE protocol.
 *
 * Mirrors the Go server in `cmd/agentgo-server/main.go` byte-for-byte so the
 * existing Next.js consumer (`app/api/chat/route.ts`, `lib/agentgo/client.ts`)
 * doesn't change. Only payload shape — no behavior.
 */

export type AgentMode = "PLAN" | "BUILD" | "AUTO";

export interface ChatMessageWire {
  role: string;
  content: string;
}

export interface LLMOverrideWire {
  provider?: string;
  base_url?: string;
  model?: string;
  api_key?: string;
}

export interface StartRunRequestWire {
  query?: string;
  messages?: ChatMessageWire[];
  thread_id?: string;
  workspace_root?: string;
  mode?: AgentMode | string;
  max_steps?: number;
  llm?: LLMOverrideWire;
  tool_bridge_url?: string;
}

export interface StartRunResponseWire {
  run_id: string;
}

export type RunStatus =
  | "running"
  | "paused"
  | "paused_requested"
  | "needs_review"
  | "completed"
  | "failed"
  | "queued";

export interface HealthResponseWire {
  status: string;
  time: string;
  llm: { base_url: string; model: string; status: string };
  broker: { pending_requests: number; active_runs: number };
}

/** AG-UI event base — matches `mapToAGUI` in the Go server. */
export interface AGUIEventBase {
  threadId: string;
  runId: string;
  timestamp: string;
  schemaVersion: 2;
  seq?: number;
}

export type AGUIEventType =
  | "RunStarted"
  | "RunFinished"
  | "RunError"
  | "ToolCallStart"
  | "ToolCallResult"
  | "InterruptRequested"
  | "InterruptResolved"
  | "StepStarted"
  | "StepCompleted"
  | "TextMessageStart"
  | "TextMessageContent"
  | "TextMessageEnd"
  | "ArtifactCreated";

export interface AGUIEvent extends AGUIEventBase {
  type: AGUIEventType;
  /** Per-type fields, see `mapToAGUI` reference. */
  [key: string]: unknown;
}

export function nowRFC3339(): string {
  return new Date().toISOString();
}
