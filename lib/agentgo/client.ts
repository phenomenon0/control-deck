/**
 * Agent-GO Client
 * 
 * HTTP/SSE client for the Agent-GO server.
 * Connects to localhost:4243 by default.
 */

const AGENTGO_URL = process.env.AGENTGO_URL || "http://localhost:4243";

/**
 * Retry configuration for Agent-GO fetches.
 *
 * `attempts` counts the TOTAL tries (initial + retries). With defaults you
 * get 1 initial + 2 retries at ~1s and ~2s backoff. `baseDelayMs` is the
 * first retry delay; each subsequent retry doubles it. `maxDelayMs` caps
 * the final delay so we don't sit idle for minutes on a long backoff.
 */
export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_RETRY: Required<Omit<RetryOptions, "signal">> = {
  attempts: Number(process.env.AGENTGO_RETRY_ATTEMPTS ?? "3"),
  baseDelayMs: Number(process.env.AGENTGO_RETRY_BASE_MS ?? "1000"),
  maxDelayMs: Number(process.env.AGENTGO_RETRY_MAX_MS ?? "8000"),
};

export class AgentGoUnavailableError extends Error {
  readonly lastStatus?: number;
  readonly attempts: number;
  constructor(message: string, attempts: number, lastStatus?: number) {
    super(message);
    this.name = "AgentGoUnavailableError";
    this.attempts = attempts;
    this.lastStatus = lastStatus;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

/**
 * fetch() wrapper with exponential backoff for transient failures.
 *
 * Retries on:
 *   - network errors (TypeError from fetch)
 *   - HTTP 5xx responses
 *
 * Does NOT retry on 4xx — those are caller errors and retrying would mask
 * them. Honours AbortSignal at every awaited step.
 */
export async function retryingFetch(
  url: string,
  init?: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const cfg = { ...DEFAULT_RETRY, ...opts };
  const signal = opts.signal ?? init?.signal ?? undefined;
  let lastStatus: number | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= cfg.attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res; // success, or non-retryable client error
      }
      lastStatus = res.status;
      lastError = new Error(`${res.status} ${res.statusText}`);
      // drain body so the connection can be reused
      res.body?.cancel().catch(() => {});
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      lastError = err;
    }

    if (attempt < cfg.attempts) {
      const delay = Math.min(cfg.baseDelayMs * 2 ** (attempt - 1), cfg.maxDelayMs);
      console.warn(
        `[agentgo] fetch ${url} failed (attempt ${attempt}/${cfg.attempts}, status=${lastStatus ?? "net"}); retrying in ${delay}ms`
      );
      await sleep(delay, signal);
    }
  }

  throw new AgentGoUnavailableError(
    `Agent-GO unreachable after ${cfg.attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    cfg.attempts,
    lastStatus
  );
}

export interface StartRunRequest {
  query: string;
  workspace_root?: string;
  mode?: "PLAN" | "BUILD" | "AUTO";
  max_steps?: number;
}

export interface StartRunResponse {
  run_id: string;
}

export interface RunStatus {
  run_id: string;
  status: string;
  event_count: number;
  pending_approvals: number;
}

export interface HealthResponse {
  status: string;
  time: string;
  llm: {
    base_url: string;
    model: string;
    status: string;
  };
  broker: {
    pending_requests: number;
    active_runs: number;
  };
}

/**
 * AgentGoEvent — discriminated union of all events emitted by the Agent-GO
 * server on `/runs/:id/events`.
 *
 * Structurally aligned with the AG-UI protocol (see `lib/agui/events.ts`) but
 * uses the Agent-GO wire format directly — no `DeckPayload` envelope, raw
 * top-level fields. The `schemaVersion` field is always 2.
 *
 * When the server adds new event types, extend this union; consumers that
 * `switch` on `event.type` will narrow automatically and the compiler will
 * flag any missing cases.
 */

interface AgentGoEventBase {
  threadId: string;
  runId: string;
  timestamp: string;
  schemaVersion: number;
}

export interface AgentGoRunStartedEvent extends AgentGoEventBase {
  type: "RunStarted";
  model?: string;
  input?: unknown;
}

export interface AgentGoRunFinishedEvent extends AgentGoEventBase {
  type: "RunFinished";
  result?: unknown;
}

export interface AgentGoRunErrorEvent extends AgentGoEventBase {
  type: "RunError";
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface AgentGoToolCallStartEvent extends AgentGoEventBase {
  type: "ToolCallStart";
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

export interface AgentGoToolCallResultEvent extends AgentGoEventBase {
  type: "ToolCallResult";
  toolCallId: string;
  toolName?: string;
  result?: unknown;
  error?: string;
}

export interface AgentGoInterruptRequestedEvent extends AgentGoEventBase {
  type: "InterruptRequested";
  requestId?: string;
  toolName?: string;
  args?: unknown;
  toolCallId?: string;
}

export interface AgentGoInterruptResolvedEvent extends AgentGoEventBase {
  type: "InterruptResolved";
  requestId?: string;
  approved: boolean;
  reason?: string;
}

export interface AgentGoStepStartedEvent extends AgentGoEventBase {
  type: "STEP_STARTED";
  stepId?: string;
  stepName?: string;
}

export interface AgentGoStepCompletedEvent extends AgentGoEventBase {
  type: "STEP_COMPLETED";
  stepId?: string;
  stepName?: string;
  result?: unknown;
}

export interface AgentGoTextMessageStartEvent extends AgentGoEventBase {
  type: "TextMessageStart";
  messageId: string;
  role?: "assistant" | "user" | "system";
}

export interface AgentGoTextMessageContentEvent extends AgentGoEventBase {
  type: "TextMessageContent";
  messageId: string;
  delta: string;
}

export interface AgentGoTextMessageEndEvent extends AgentGoEventBase {
  type: "TextMessageEnd";
  messageId: string;
}

export type AgentGoEvent =
  | AgentGoRunStartedEvent
  | AgentGoRunFinishedEvent
  | AgentGoRunErrorEvent
  | AgentGoToolCallStartEvent
  | AgentGoToolCallResultEvent
  | AgentGoInterruptRequestedEvent
  | AgentGoInterruptResolvedEvent
  | AgentGoStepStartedEvent
  | AgentGoStepCompletedEvent
  | AgentGoTextMessageStartEvent
  | AgentGoTextMessageContentEvent
  | AgentGoTextMessageEndEvent;

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${AGENTGO_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Start a new agent run
 */
export async function startRun(req: StartRunRequest): Promise<string> {
  const res = await fetch(`${AGENTGO_URL}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || "Failed to start run");
  }

  const data: StartRunResponse = await res.json();
  return data.run_id;
}

/**
 * Start a new agent run with streaming text response
 * Returns runId and a readable stream for assistant text
 * 
 * This follows the ChatPaneV2 pattern: fetch stream for text, SSE for tools/artifacts
 */
export interface StreamingRunResult {
  runId: string;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  response: Response;
}

export async function startRunWithStream(
  req: StartRunRequest,
  signal?: AbortSignal
): Promise<StreamingRunResult> {
  const res = await fetch(`${AGENTGO_URL}/runs/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || "Failed to start run");
  }

  // Get run ID from headers (server should set X-Run-Id)
  const runId = res.headers.get("X-Run-Id") || "";
  
  if (!runId) {
    throw new Error("Server did not return run ID in X-Run-Id header");
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body for streaming");
  }

  return { runId, reader, response: res };
}

/**
 * Get run status
 */
export async function getRunStatus(runId: string): Promise<RunStatus> {
  const res = await fetch(`${AGENTGO_URL}/runs/${runId}`);
  if (!res.ok) {
    throw new Error(`Failed to get run status: ${res.statusText}`);
  }
  return res.json();
}

/**
 * List all runs
 */
export async function listRuns(status?: string): Promise<{ runs: RunStatus[] }> {
  const url = status 
    ? `${AGENTGO_URL}/runs?status=${status}`
    : `${AGENTGO_URL}/runs`;
  
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list runs: ${res.statusText}`);
  }
  return res.json();
}

export type EventCallback = (event: AgentGoEvent) => void;
export type ErrorCallback = (error: Error) => void;
export type DoneCallback = () => void;

export interface StreamOptions {
  fromSeq?: number;
  onEvent?: EventCallback;
  onError?: ErrorCallback;
  onDone?: DoneCallback;
}

/**
 * Stream events from a run using Server-Sent Events
 * Returns an abort function to stop streaming
 */
export function streamEvents(runId: string, options: StreamOptions = {}): () => void {
  const { fromSeq = 0, onEvent, onError, onDone } = options;
  
  const url = `${AGENTGO_URL}/runs/${runId}/events?from_seq=${fromSeq}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    try {
      const event: AgentGoEvent = JSON.parse(e.data);
      onEvent?.(event);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  eventSource.onerror = (e) => {
    onError?.(new Error("SSE connection error"));
    eventSource.close();
  };

  // Handle named events
  eventSource.addEventListener("done", () => {
    onDone?.();
    eventSource.close();
  });

  // Handle specific event types
  const eventTypes = [
    "RunStarted", "RunFinished", "RunError",
    "ToolCallStart", "ToolCallResult",
    "InterruptRequested", "InterruptResolved",
    "STEP_STARTED", "STEP_COMPLETED",
    // AG-UI text message events
    "TextMessageStart", "TextMessageContent", "TextMessageEnd"
  ];

  for (const type of eventTypes) {
    eventSource.addEventListener(type, (e: MessageEvent) => {
      try {
        const event: AgentGoEvent = JSON.parse(e.data);
        onEvent?.(event);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // Return abort function
  return () => eventSource.close();
}

/**
 * Stream events as an async generator
 */
export async function* streamEventsAsync(
  runId: string,
  signal?: AbortSignal
): AsyncGenerator<AgentGoEvent> {
  const url = `${AGENTGO_URL}/runs/${runId}/events`;
  
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to stream events: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event: AgentGoEvent = JSON.parse(line.slice(6));
            yield event;
          } catch (err) {
            console.warn("[agentgo] Malformed SSE event:", line, err);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Approve a pending confirmation request
 */
export async function approveRun(runId: string, requestId?: string): Promise<void> {
  const res = await fetch(`${AGENTGO_URL}/runs/${runId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || "Failed to approve");
  }
}

/**
 * Reject a pending confirmation request
 */
export async function rejectRun(runId: string, reason?: string, requestId?: string): Promise<void> {
  const res = await fetch(`${AGENTGO_URL}/runs/${runId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, reason }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || "Failed to reject");
  }
}
