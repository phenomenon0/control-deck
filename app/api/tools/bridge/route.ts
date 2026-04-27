/**
 * Tool Bridge API — Agent-GO to Control-Deck tool gateway.
 *
 * Thin HTTP wrapper around lib/tools/bridgeDispatch, which owns the
 * BRIDGE_TOOLS allowlist, arg validation, and approval gating. The MCP
 * server (lib/mcp) shares the same dispatcher.
 */

import { BRIDGE_TOOLS, bridgeDispatch } from "@/lib/tools/bridgeDispatch";
import { denyIfCrossOrigin } from "@/lib/security/originGuard";

export { BRIDGE_TOOLS };

interface BridgeRequest {
  tool: string;
  args: Record<string, unknown>;
  ctx: {
    thread_id: string;
    run_id: string;
    tool_call_id?: string;
  };
}

interface BridgeResponse {
  success: boolean;
  message?: string;
  artifacts?: Array<{
    id: string;
    url: string;
    name: string;
    mimeType: string;
  }>;
  data?: unknown;
  error?: string;
}

export async function POST(req: Request): Promise<Response> {
  // Defense in depth: middleware enforces bridge_token, but a cross-origin
  // browser request that has somehow learned the token still gets blocked
  // here. agent-ts (the legitimate caller) does not send an Origin header
  // from Node fetch, so it passes.
  const denied = denyIfCrossOrigin(req);
  if (denied) return denied;

  let body: BridgeRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: "Invalid JSON body" } as BridgeResponse,
      { status: 400 },
    );
  }

  const outcome = await bridgeDispatch({
    tool: body.tool,
    args: body.args,
    threadId: body.ctx?.thread_id,
    runId: body.ctx?.run_id,
    toolCallId: body.ctx?.tool_call_id,
  });

  switch (outcome.kind) {
    case "bad_request":
      return Response.json(
        {
          success: false,
          error: outcome.message,
          ...(outcome.issues ? { errors: outcome.issues } : {}),
        } as BridgeResponse & { errors?: unknown },
        { status: 400 },
      );
    case "denied":
      return Response.json(
        { success: false, error: `tool call denied: ${outcome.reason}` } as BridgeResponse,
        { status: 403 },
      );
    case "error":
      return Response.json(
        { success: false, error: outcome.message } as BridgeResponse,
        { status: 500 },
      );
    case "ok": {
      const r = outcome.result;
      return Response.json({
        success: r.success,
        message: r.message,
        artifacts: r.artifacts,
        data: r.data,
        error: r.error,
      } as BridgeResponse);
    }
  }
}

export async function GET(): Promise<Response> {
  return Response.json({
    tools: Array.from(BRIDGE_TOOLS),
    description: "Tools available via Agent-GO bridge",
  });
}
