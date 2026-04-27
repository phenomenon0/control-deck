/**
 * Tool preflight — agent-ts asks Next "may I run this tool?"
 *
 * Calling pattern (from `apps/agent-ts/src/tools/bridge.ts`'s
 * `beforeToolCall` hook):
 *
 *   POST /api/tools/preflight
 *     { tool: string, args: object, ctx: { thread_id, run_id, modality, ... } }
 *   → 200 { decision: "allow" | "approval_required" | "deny", ... }
 *
 * The agent waits on its `ApprovalBroker` only when the deck answers
 * `approval_required`. When the deck answers `deny`, the agent feeds a
 * deny payload back to the model and never asks the bridge to execute.
 *
 * The actual execution path (`/api/tools/bridge`) re-decides with the
 * same module — never trust the preflight answer alone, because the
 * caller could skip preflight entirely.
 */

import { decideToolPolicy, type Modality } from "@/lib/tools/policy";
import { denyIfCrossOrigin } from "@/lib/security/originGuard";

interface PreflightRequest {
  tool?: unknown;
  args?: unknown;
  ctx?: {
    thread_id?: unknown;
    run_id?: unknown;
    tool_call_id?: unknown;
    source?: unknown;
    modality?: unknown;
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asModality(value: unknown): Modality {
  if (value === "voice" || value === "system" || value === "mcp") return value;
  return "text";
}

export async function POST(req: Request): Promise<Response> {
  const denied = denyIfCrossOrigin(req);
  if (denied) return denied;

  let body: PreflightRequest;
  try {
    body = (await req.json()) as PreflightRequest;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const tool = asString(body.tool);
  if (!tool) {
    return Response.json({ error: "tool name required" }, { status: 400 });
  }

  const args =
    typeof body.args === "object" && body.args !== null
      ? (body.args as Record<string, unknown>)
      : {};

  // Note: ctx fields are caller-supplied, used only for policy decisions
  // (e.g. modality). They are NEVER trusted as identity. The actual
  // execution context is rebuilt server-side in bridgeDispatch.
  const decision = decideToolPolicy({
    tool,
    args,
    ctx: {
      threadId: asString(body.ctx?.thread_id),
      runId: asString(body.ctx?.run_id),
      toolCallId: asString(body.ctx?.tool_call_id),
      modality: asModality(body.ctx?.modality),
    },
  });

  if (decision.decision === "deny") {
    return Response.json(
      {
        decision: "deny",
        risk: decision.risk,
        reason: decision.reason,
        issues: decision.issues,
      },
      { status: 200 },
    );
  }

  return Response.json(decision, { status: 200 });
}
