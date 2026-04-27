/**
 * Approval gate — the runtime hook that makes the Approvals queue live.
 *
 * Every tool-dispatch call site wraps its execution with:
 *
 *   const verdict = await gateToolCall({ toolName, toolArgs, runId, threadId });
 *   if (verdict.decision === "denied") return denyResponse(verdict.reason);
 *
 * `gateToolCall` consults `settings.approval`:
 *   - mode=never       → auto-approve
 *   - mode=ask         → always create an approval row and wait
 *   - mode=cost        → wait only if estimatedCostUsd ≥ threshold
 *   - mode=side-effect → wait only for tools on the side-effect list below
 *
 * perTool overrides trump the default. If `autoExecuteTools=false` on the
 * runs-defaults section, every call is gated regardless.
 *
 * The wait is a bounded poll of the approvals row — 250 ms tick, capped
 * at the user's configured timeout (auto-denies on overflow). Polling
 * beats a hub subscription here because the decision writer (API route)
 * runs in a different Next.js handler and the in-memory hub only bridges
 * in-process listeners.
 */

import {
  createApproval,
  decideApproval,
  getApproval,
  type ApprovalStatus,
} from "@/lib/agui/db";
import { resolveSection } from "@/lib/settings/resolve";
import type { ApprovalMode } from "@/lib/settings/schema";
import { hub } from "@/lib/agui/hub";
import { getManifest, hasManifestEntry } from "@/lib/tools/manifest";

export interface GateOptions {
  toolName: string;
  toolArgs: Record<string, unknown>;
  runId?: string;
  threadId?: string;
  estimatedCostUsd?: number;
  /** Human-readable reason shown on the approval card. */
  reason?: string;
}

export interface GateVerdict {
  decision: "approved" | "denied";
  /** Why we arrived at this decision (for logs + deny responses). */
  reason: string;
  /** Approval id when a prompt was created. */
  approvalId?: string;
}

/**
 * "Side-effect" gating delegates to the manifest's risk classification:
 * anything strictly above `low_write` (i.e. medium_write, high_write,
 * sensitive, dangerous) is treated as a side-effect tool. The manifest is
 * the canonical risk table — see `lib/tools/manifest.ts`.
 */
function isSideEffectTool(toolName: string): boolean {
  // Tools without a manifest entry (e.g. agent-go native web_search) are
  // not bridge-routed; the side-effect gate stays out of their way. The
  // bridge re-decides via decideToolPolicy with the same fail-safe default.
  if (!hasManifestEntry(toolName)) return false;
  const m = getManifest(toolName);
  if (m.requiresApproval) return true;
  switch (m.risk) {
    case "medium_write":
    case "high_write":
    case "sensitive":
    case "dangerous":
      return true;
    default:
      return false;
  }
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Decide whether a tool call should open an approval prompt. */
function shouldGate(
  options: GateOptions,
  mode: ApprovalMode,
  costThreshold: number,
  autoExecuteTools: boolean,
): boolean {
  if (!autoExecuteTools) return true; // master switch off — always gate
  switch (mode) {
    case "never":
      return false;
    case "ask":
      return true;
    case "cost":
      return (options.estimatedCostUsd ?? 0) >= costThreshold;
    case "side-effect":
      return isSideEffectTool(options.toolName);
  }
}

export async function gateToolCall(options: GateOptions): Promise<GateVerdict> {
  // Pull policy + runs master switch. Resolution errors (e.g. DB down in
  // test env) fall through to "approved" — the alternative is every run
  // hanging, which is worse.
  let mode: ApprovalMode = "ask";
  let perTool: Record<string, ApprovalMode> = {};
  let costThreshold = 0.05;
  let timeoutSeconds = 120;
  let autoExecuteTools = true;
  try {
    const pol = resolveSection("approval");
    mode = pol.defaultMode;
    perTool = pol.perTool;
    costThreshold = pol.costThresholdUsd;
    timeoutSeconds = pol.timeoutSeconds;
    autoExecuteTools = resolveSection("runs").autoExecuteTools;
  } catch {
    return { decision: "approved", reason: "settings unavailable; auto-approved" };
  }

  const effectiveMode = perTool[options.toolName] ?? mode;
  if (!shouldGate(options, effectiveMode, costThreshold, autoExecuteTools)) {
    return { decision: "approved", reason: `policy=${effectiveMode}; not gated` };
  }

  // Create the pending row + announce on the hub.
  const id = randomId("appr");
  try {
    createApproval({
      id,
      runId: options.runId,
      threadId: options.threadId,
      toolName: options.toolName,
      toolArgs: options.toolArgs,
      estimatedCostUsd: options.estimatedCostUsd,
      reason: options.reason ?? `Gated by policy: ${effectiveMode}`,
    });
  } catch (e) {
    console.error("[approval] failed to create approval row:", e);
    return { decision: "approved", reason: "approval persistence failed; auto-approved" };
  }

  if (options.threadId) {
    try {
      hub.publish(options.threadId, {
        type: "InterruptRequested",
        threadId: options.threadId,
        runId: options.runId,
        timestamp: new Date().toISOString(),
        schemaVersion: 2,
        // AG-UI InterruptRequested carries a free-form `data` field; we
        // stuff the approval id in there so the client can link it.
        data: {
          kind: "approval",
          approvalId: id,
          toolName: options.toolName,
        },
      } as never);
    } catch {
      // Hub publish is best-effort; approval still works via polling.
    }
  }

  // Poll the row until decided or timeout.
  const tickMs = 250;
  const deadline = timeoutSeconds === 0 ? Number.POSITIVE_INFINITY : Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const row = getApproval(id);
    if (row && row.status !== "pending") return finalise(id, row.status, options.threadId);
    await sleep(tickMs);
  }

  // Timeout → auto-deny, persist the decision so the UI reflects it.
  try {
    decideApproval(id, "denied", "timed out", "system");
  } catch {
    /* ignore */
  }
  return {
    decision: "denied",
    reason: `approval timed out after ${timeoutSeconds}s`,
    approvalId: id,
  };
}

function finalise(id: string, status: ApprovalStatus, threadId?: string): GateVerdict {
  const decision = status === "approved" ? "approved" : "denied";
  if (threadId) {
    try {
      hub.publish(threadId, {
        type: "InterruptResolved",
        threadId,
        timestamp: new Date().toISOString(),
        schemaVersion: 2,
        data: { kind: "approval", approvalId: id, decision },
      } as never);
    } catch {
      /* best-effort */
    }
  }
  return {
    decision,
    reason: `resolved by user: ${status}`,
    approvalId: id,
  };
}
