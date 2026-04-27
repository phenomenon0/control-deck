/**
 * Preflight policy decision — single source of truth for "may this tool
 * call run, and does it need approval?"
 *
 * Used by:
 *   - POST /api/tools/preflight  (agent-ts asks before placing the call)
 *   - bridgeDispatch             (defence-in-depth: re-decides at execute)
 *
 * Distinct from `lib/approvals/gate.ts`, which is the *runtime* hook that
 * blocks until the user resolves an approval. This module makes the
 * synchronous yes/no/maybe decision; the gate is what waits.
 */

import { BRIDGE_TOOLS } from "./bridgeDispatch";
import { TOOL_SCHEMAS, type ToolName } from "./definitions";
import { getManifest, type RiskLevel, type SideEffectKind } from "./manifest";

export type Modality = "text" | "voice" | "system" | "mcp";

export interface PolicyContext {
  threadId?: string;
  runId?: string;
  toolCallId?: string;
  source?: "agent-ts" | "chat-route" | "mcp" | "manual-ui";
  modality?: Modality;
}

export type PolicyDecision =
  | {
      decision: "allow";
      risk: RiskLevel;
      sideEffect: SideEffectKind;
      timeoutMs: number;
      normalizedArgs: unknown;
    }
  | {
      decision: "approval_required";
      risk: RiskLevel;
      sideEffect: SideEffectKind;
      timeoutMs: number;
      normalizedArgs: unknown;
      reason: string;
    }
  | {
      decision: "deny";
      risk: RiskLevel;
      reason: string;
      issues?: unknown;
    };

export interface PolicyInput {
  tool: string;
  args: Record<string, unknown> | undefined;
  ctx?: PolicyContext;
}

/**
 * Decide what to do with a tool call. Pure: no IO, no DB, no waits.
 */
export function decideToolPolicy(input: PolicyInput): PolicyDecision {
  const { tool, args, ctx } = input;

  if (!tool || typeof tool !== "string") {
    return { decision: "deny", risk: "dangerous", reason: "missing tool name" };
  }

  if (!BRIDGE_TOOLS.has(tool)) {
    return {
      decision: "deny",
      risk: "dangerous",
      reason: `tool '${tool}' is not exposed via bridge`,
    };
  }

  const manifest = getManifest(tool);

  // Schema validation — preflight catches obvious shape errors here so the
  // model gets feedback before the bridge actually executes the call.
  const schema = TOOL_SCHEMAS[tool as ToolName];
  let normalizedArgs: unknown = args ?? {};
  if (schema) {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        decision: "deny",
        risk: manifest.risk,
        reason: "invalid args",
        issues: parsed.error.issues,
      };
    }
    normalizedArgs = parsed.data;
  }

  // Modality caps. Voice escalates risk because the user can't preview the
  // exact action before it runs — anything high_write or above gets pushed
  // through approval.
  const modality = ctx?.modality ?? "text";
  if (modality === "voice" && !manifest.allowInVoice) {
    return {
      decision: "deny",
      risk: manifest.risk,
      reason: `tool '${tool}' is not permitted from a voice modality`,
    };
  }
  if (modality === "mcp" && !manifest.allowInMcp) {
    return {
      decision: "deny",
      risk: manifest.risk,
      reason: `tool '${tool}' is not exposed via MCP`,
    };
  }

  if (
    manifest.risk === "dangerous" ||
    manifest.risk === "sensitive" ||
    manifest.requiresApproval
  ) {
    return {
      decision: "approval_required",
      risk: manifest.risk,
      sideEffect: manifest.sideEffect,
      timeoutMs: manifest.timeoutMs,
      normalizedArgs,
      reason: `risk=${manifest.risk} requires approval`,
    };
  }

  // Voice mode escalates high_write to approval even when the manifest
  // doesn't require it for text.
  if (modality === "voice" && manifest.risk === "high_write") {
    return {
      decision: "approval_required",
      risk: manifest.risk,
      sideEffect: manifest.sideEffect,
      timeoutMs: manifest.timeoutMs,
      normalizedArgs,
      reason: "high_write tool from voice modality requires approval",
    };
  }

  return {
    decision: "allow",
    risk: manifest.risk,
    sideEffect: manifest.sideEffect,
    timeoutMs: manifest.timeoutMs,
    normalizedArgs,
  };
}
