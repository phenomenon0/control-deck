import type { ToolExecutionResult } from "@/lib/tools/executor";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ToolBridgeHttpOptions {
  bridgeUrl: string;
  tool: string;
  args: Record<string, unknown>;
  threadId: string;
  runId: string;
  toolCallId: string;
  fetchImpl?: FetchLike;
}

interface ToolBridgeResponse {
  success: boolean;
  message?: string;
  artifacts?: ToolExecutionResult["artifacts"];
  data?: unknown;
  error?: string;
}

export async function callToolBridgeHttp(
  opts: ToolBridgeHttpOptions,
): Promise<ToolExecutionResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(opts.bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: opts.tool,
        args: opts.args,
        ctx: {
          thread_id: opts.threadId,
          run_id: opts.runId,
          tool_call_id: opts.toolCallId,
        },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: "HTTP bridge request failed", error: `HTTP bridge request failed: ${msg}` };
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      success: false,
      message: `HTTP bridge returned ${response.status}`,
      error: `HTTP bridge returned ${response.status}: ${text}`,
    };
  }

  let payload: ToolBridgeResponse;
  try {
    payload = JSON.parse(text) as ToolBridgeResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: "HTTP bridge returned invalid JSON",
      error: `HTTP bridge returned invalid JSON: ${msg}`,
    };
  }

  return {
    success: payload.success,
    message: payload.message ?? (payload.success ? "ok" : payload.error ?? "failed"),
    artifacts: payload.artifacts,
    data: payload.data,
    error: payload.error,
  };
}
