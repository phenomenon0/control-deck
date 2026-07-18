/**
 * Wire types for the Agent-GO HTTP/SSE protocol.
 *
 * Mirrors the Go server in `cmd/agentgo-server/main.go` byte-for-byte so the
 * existing Next.js consumer (`app/api/chat/route.ts`, `lib/agentgo/client.ts`)
 * doesn't change. Only payload shape — no behavior.
 */

export type AgentMode = "PLAN" | "BUILD" | "AUTO";

/**
 * OpenAI-style tool call attached to an assistant turn. Lets the caller
 * replay prior tool exchanges so multi-turn context doesn't degrade —
 * without it the loop had to drop every tool call from history.
 */
export interface ChatMessageWireToolCall {
  id: string;
  name: string;
  /** Arguments as a JSON string or an already-parsed object. */
  arguments?: unknown;
}

export interface ChatMessageWire {
  role: string;
  content: string;
  /** Assistant role only: tool calls the model issued in that turn. */
  tool_calls?: ChatMessageWireToolCall[];
  /** tool / tool-result roles: id of the assistant tool call this answers. */
  tool_call_id?: string;
  /** tool / tool-result roles: originating tool name. */
  name?: string;
  /** tool / tool-result roles: true when the result is an error. */
  is_error?: boolean;
}

export interface LLMOverrideWire {
  provider?: string;
  base_url?: string;
  model?: string;
  api_key?: string;
}

/**
 * Complete LLM config resolved by the deck (Next). All four keys are part of
 * the pinned contract; `api_key` is null when the endpoint needs no auth.
 */
export interface LLMConfigWire {
  provider: string;
  model: string;
  base_url: string;
  api_key: string | null;
}

export interface StartRunRequestWire {
  query?: string;
  messages?: ChatMessageWire[];
  thread_id?: string;
  /**
   * Fully-assembled system prompt from the deck (memory, skill index,
   * workflow reference, thread persona, voice-mode prompt). Canon: Next
   * assembles, agent-ts obeys — when present this REPLACES the local
   * SYSTEM_PROMPT + bootstrap-file stack wholesale and is installed as the
   * run's real system prompt (pi-agent-core initialState.systemPrompt).
   * When absent, the bootstrap stack remains as the standalone-dev
   * fallback.
   */
  system_prompt?: string;
  /**
   * Caller-allocated AG-UI run id. When set, agent-ts uses this id for the
   * RunHandle and emits all events under it — that makes the deck-side
   * AG-UI `runId` canonical across Next and agent-ts, eliminating the
   * after-the-fact `setAgentRunId` reconciliation. When unset, agent-ts
   * generates one (existing behaviour).
   */
  run_id?: string;
  workspace_root?: string;
  mode?: AgentMode | string;
  max_steps?: number;
  /**
   * Fully-resolved LLM config from the deck (Next). Canon: Next resolves,
   * agent-ts obeys — when present this is used VERBATIM (base_url + model +
   * api_key straight onto the pi model config); the only local judgement is
   * an availability probe of `base_url + /models`, and a failure there fails
   * the run with a structured error instead of silently snapping to another
   * served model. When absent, the preset/env + snap stack remains as the
   * standalone-dev fallback (`resolveLLM` in server/llm.ts).
   */
  llm?: LLMConfigWire;
  tool_bridge_url?: string;
  /**
   * Absolute URL of the deck's /api/mcp/tools endpoint. When set, the loop
   * fetches the namespaced MCP tool list at run start and adds them to the
   * tool array; each call dispatches back via POST to the same URL.
   */
  mcp_url?: string;
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
  | "ArtifactCreated"
  | "LLMResolved";

export interface AGUIEvent extends AGUIEventBase {
  type: AGUIEventType;
  /** Per-type fields, see `mapToAGUI` reference. */
  [key: string]: unknown;
}

export function nowRFC3339(): string {
  return new Date().toISOString();
}
