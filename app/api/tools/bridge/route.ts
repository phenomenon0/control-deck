/**
 * Tool Bridge API — Agent-GO to Control-Deck tool gateway.
 *
 * Thin HTTP wrapper around lib/tools/bridgeDispatch, which owns the
 * BRIDGE_TOOLS allowlist, arg validation, and approval gating. The MCP
 * server (lib/mcp) shares the same dispatcher.
 */

import { BRIDGE_TOOLS, bridgeDispatch } from "@/lib/tools/bridgeDispatch";
import { denyIfCrossOrigin } from "@/lib/security/originGuard";
import { isMcpProfile, type McpProfile } from "@/lib/tools/mcpProfiles";
import type { PolicyContext } from "@/lib/tools/policy";

export { BRIDGE_TOOLS };

interface BridgeRequest {
  tool: string;
  args: Record<string, unknown>;
  ctx: {
    thread_id: string;
    run_id: string;
    tool_call_id?: string;
    source?: PolicyContext["source"];
    modality?: PolicyContext["modality"];
    mcp_profiles?: unknown;
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
  error_code?: string;
  recovery?: string[];
  safe_to_retry?: boolean;
  issues?: unknown;
}

function parseMcpProfiles(raw: unknown): McpProfile[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const profiles = raw.filter((value): value is McpProfile =>
    typeof value === "string" && isMcpProfile(value),
  );
  return profiles.length > 0 ? profiles : undefined;
}

function bridgePolicyContext(ctx: BridgeRequest["ctx"] | undefined): PolicyContext | undefined {
  const policyCtx: PolicyContext = {};
  if (ctx?.source) policyCtx.source = ctx.source;
  if (ctx?.modality) policyCtx.modality = ctx.modality;
  const mcpProfiles = parseMcpProfiles(ctx?.mcp_profiles);
  if (mcpProfiles) policyCtx.mcpProfiles = mcpProfiles;
  return Object.keys(policyCtx).length > 0 ? policyCtx : undefined;
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
    policyCtx: bridgePolicyContext(body.ctx),
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
        error_code: r.error_code,
        recovery: r.recovery,
        safe_to_retry: r.safe_to_retry,
        issues: r.issues,
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
