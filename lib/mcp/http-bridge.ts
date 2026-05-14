import type { ToolExecutionResult } from "@/lib/tools/executor";
import type { PolicyContext } from "@/lib/tools/policy";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ToolBridgeHttpOptions {
  bridgeUrl: string;
  tool: string;
  args: Record<string, unknown>;
  threadId: string;
  runId: string;
  toolCallId: string;
  policyCtx?: Pick<PolicyContext, "source" | "modality" | "mcpProfiles">;
  fetchImpl?: FetchLike;
}

interface ToolBridgeResponse {
  success: boolean;
  message?: string;
  artifacts?: ToolExecutionResult["artifacts"];
  data?: unknown;
  error?: string;
  error_code?: string;
  recovery?: string[];
  safe_to_retry?: boolean;
  issues?: unknown;
}

export async function callToolBridgeHttp(
  opts: ToolBridgeHttpOptions,
): Promise<ToolExecutionResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    const ctx: Record<string, unknown> = {
      thread_id: opts.threadId,
      run_id: opts.runId,
      tool_call_id: opts.toolCallId,
    };
    if (opts.policyCtx?.source) ctx.source = opts.policyCtx.source;
    if (opts.policyCtx?.modality) ctx.modality = opts.policyCtx.modality;
    if (opts.policyCtx?.mcpProfiles?.length) ctx.mcp_profiles = opts.policyCtx.mcpProfiles;

    response = await fetchImpl(opts.bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: opts.tool,
        args: opts.args,
        ctx,
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
    error_code: payload.error_code,
    recovery: payload.recovery,
    safe_to_retry: payload.safe_to_retry,
    issues: payload.issues,
  };
}
