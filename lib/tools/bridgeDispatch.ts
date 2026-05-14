/**
 * Shared bridge dispatch — wraps the low-level tool executor with the
 * BRIDGE_TOOLS allowlist, Zod arg validation, and the approvals gate.
 *
 * Entry points that share this:
 *   - POST /api/tools/bridge  (Agent-GO HTTP callback)
 *   - PUT  /api/chat          (manual tool triggers)
 *   - MCP server tools/call   (external agent runtimes via MCP)
 */

import {
  executeToolWithGlyph,
  type ExecutorContext,
  type ToolExecutionResult,
} from "./executor";
import { type ToolCall } from "./definitions";
import { generateId } from "@/lib/agui/events";
import { gateToolCall } from "@/lib/approvals/gate";
import { BRIDGE_TOOLS } from "./bridgeToolList";
import { decideToolPolicy, type PolicyContext } from "./policy";

export { BRIDGE_TOOLS };

export interface BridgeDispatchRequest {
  tool: string;
  args: Record<string, unknown>;
  threadId: string;
  runId: string;
  toolCallId?: string;
  policyCtx?: PolicyContext;
}

export type BridgeDispatchOutcome =
  | { kind: "ok"; result: ToolExecutionResult }
  | { kind: "bad_request"; message: string; issues?: unknown }
  | { kind: "denied"; reason: string }
  | { kind: "error"; message: string };

export async function bridgeDispatch(
  req: BridgeDispatchRequest,
): Promise<BridgeDispatchOutcome> {
  const { tool, args, threadId, runId } = req;

  if (!tool || typeof tool !== "string") {
    return { kind: "bad_request", message: "tool name is required" };
  }
  if (!threadId || !runId) {
    return { kind: "bad_request", message: "threadId and runId are required" };
  }
  if (!BRIDGE_TOOLS.has(tool)) {
    return {
      kind: "bad_request",
      message: `tool '${tool}' is not available via bridge`,
    };
  }

  const policy = decideToolPolicy({
    tool,
    args,
    ctx: {
      threadId,
      runId,
      toolCallId: req.toolCallId,
      ...req.policyCtx,
    },
  });

  if (policy.decision === "deny") {
    if (policy.reason === "invalid args") {
      return {
        kind: "bad_request",
        message: policy.reason,
        issues: policy.issues,
      };
    }
    return { kind: "denied", reason: policy.reason };
  }

  const validatedArgs = policy.normalizedArgs as Record<string, unknown>;

  const verdict = await gateToolCall({
    toolName: tool,
    toolArgs: validatedArgs,
    runId,
    threadId,
    reason: policy.decision === "approval_required" ? policy.reason : undefined,
  });
  if (verdict.decision === "denied") {
    return { kind: "denied", reason: verdict.reason };
  }

  const execCtx: ExecutorContext = {
    threadId,
    runId,
    toolCallId: req.toolCallId ?? generateId(),
  };

  try {
    const result = await executeToolWithGlyph(
      { name: tool, args: validatedArgs } as ToolCall,
      execCtx,
    );
    return { kind: "ok", result };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[bridge] tool ${tool} failed:`, error);
    return { kind: "error", message: errMsg };
  }
}
