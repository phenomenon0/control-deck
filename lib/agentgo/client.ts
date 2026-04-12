/**
 * Agent-GO Client
 * 
 * HTTP/SSE client for the Agent-GO server.
 * Connects to localhost:4243 by default.
 */

const AGENTGO_URL = process.env.AGENTGO_URL || "http://localhost:4243";

// =============================================================================
// Types
// =============================================================================

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

export interface AgentGoEvent {
  type: string;
  threadId: string;
  runId: string;
  timestamp: string;
  schemaVersion: number;
  [key: string]: unknown;
}

// =============================================================================
// Health Check
// =============================================================================

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${AGENTGO_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.statusText}`);
  }
  return res.json();
}

// =============================================================================
// Run Management
// =============================================================================

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

// =============================================================================
// SSE Event Streaming
// =============================================================================

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
          } catch {
            // Skip malformed events
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// =============================================================================
// Approval Management
// =============================================================================

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
