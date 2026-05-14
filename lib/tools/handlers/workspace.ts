/**
 * Workspace tool handlers — relayed to the client over the SSE command bus.
 *
 * Each writer queues a command via `publishCommand`; readers wait on a
 * round-trip via `publishQuery`. The dispatcher in `executor.ts` is the
 * only caller.
 */

import type {
  WorkspaceOpenPaneArgs,
  WorkspaceClosePaneArgs,
  WorkspaceFocusPaneArgs,
  WorkspaceGetStateArgs,
  WorkspacePaneCallArgs,
} from "../definitions";
import { publishCommand, publishQuery } from "@/lib/workspace/command-relay";
import type { ToolExecutionResult } from "../executor";

const WORKSPACE_QUERY_TIMEOUT_MS = 5_000;

interface WorkspaceErrorContext {
  query: string;
  target?: string;
  capability?: string;
}

function workspaceError(err: unknown, ctx: WorkspaceErrorContext): ToolExecutionResult {
  const raw = err instanceof Error ? err.message : String(err || "workspace query failed");
  const lower = raw.toLowerCase();

  let errorCode = "workspace_error";
  let message = raw;
  let recovery = ["Call workspace_get_state to refresh workspace state", "Retry the requested workspace operation"];
  let safeToRetry = true;
  const data: Record<string, unknown> = {
    kind: "workspace_error",
    error_code: errorCode,
    query: ctx.query,
    original_error: raw,
  };

  if (lower.includes("timed out") && lower.includes("no client responded")) {
    errorCode = "workspace_not_open";
    message = "No workspace client responded. Open /deck/workspace and retry the workspace operation.";
    recovery = [
      "Open http://localhost:3333/deck/workspace",
      "Wait until the workspace finishes loading",
      "Retry workspace_get_state before any workspace write",
    ];
    data.workspaceOpen = false;
  } else if (lower.includes("pane not found")) {
    errorCode = "workspace_pane_not_found";
    message = "Workspace pane handle is stale or missing.";
    recovery = [
      "Call workspace_get_state to refresh pane handles",
      "Use a handle from the latest workspace_get_state result",
      "Open the needed pane before retrying if no matching pane exists",
    ];
  } else if (lower.includes("capability not found")) {
    errorCode = "workspace_capability_not_found";
    message = "Workspace pane capability is missing or unavailable.";
    recovery = [
      "Call workspace_get_state to refresh pane capabilities",
      "Use a capability listed on the target pane",
      "Choose a different pane or macro tool if the capability is unavailable",
    ];
  } else {
    safeToRetry = false;
  }

  data.error_code = errorCode;
  if (ctx.target) data.target = ctx.target;
  if (ctx.capability) data.capability = ctx.capability;

  return {
    success: false,
    message,
    error: raw,
    error_code: errorCode,
    recovery,
    safe_to_retry: safeToRetry,
    data,
  };
}

export function executeWorkspaceOpenPane(args: WorkspaceOpenPaneArgs): ToolExecutionResult {
  const cmd = publishCommand({
    command: "open_pane",
    args: args as unknown as Record<string, unknown>,
  });
  return {
    success: true,
    message: `Queued open_pane(${args.type}) — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export function executeWorkspaceClosePane(args: WorkspaceClosePaneArgs): ToolExecutionResult {
  const cmd = publishCommand({
    command: "close_pane",
    args: args as unknown as Record<string, unknown>,
  });
  return {
    success: true,
    message: `Queued close_pane(${args.paneId}) — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export function executeWorkspaceFocusPane(args: WorkspaceFocusPaneArgs): ToolExecutionResult {
  const cmd = publishCommand({
    command: "focus_pane",
    args: args as unknown as Record<string, unknown>,
  });
  return {
    success: true,
    message: `Queued focus_pane(${args.paneId}) — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export function executeWorkspaceReset(): ToolExecutionResult {
  const cmd = publishCommand({ command: "reset", args: {} });
  return {
    success: true,
    message: `Queued workspace reset — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export async function executeWorkspaceGetState(
  args: WorkspaceGetStateArgs = { includeLayout: true },
): Promise<ToolExecutionResult> {
  try {
    const snapshot = await publishQuery<Record<string, unknown>>(
      "query:get_state",
      { includeLayout: args.includeLayout ?? true },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );
    const paneCount = typeof snapshot?.paneCount === "number"
      ? snapshot.paneCount
      : Array.isArray(snapshot?.panes)
        ? snapshot.panes.length
        : 0;
    return {
      success: true,
      message: `Workspace state captured: ${paneCount} pane(s)`,
      data: snapshot,
    };
  } catch (err) {
    return workspaceError(err, { query: "query:get_state" });
  }
}

export async function executeWorkspaceListPanes(): Promise<ToolExecutionResult> {
  try {
    const snapshot = await publishQuery<unknown[]>("query:list_panes", {}, WORKSPACE_QUERY_TIMEOUT_MS);
    return {
      success: true,
      message: `Workspace has ${Array.isArray(snapshot) ? snapshot.length : 0} registered pane(s)`,
      data: { panes: snapshot },
    };
  } catch (err) {
    return workspaceError(err, { query: "query:list_panes" });
  }
}

export async function executeWorkspacePaneCall(args: WorkspacePaneCallArgs): Promise<ToolExecutionResult> {
  try {
    const result = await publishQuery<unknown>(
      "query:pane_call",
      {
        target: args.target,
        capability: args.capability,
        args: args.args ?? {},
      },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );
    return {
      success: true,
      message: `${args.target}.${args.capability} → ok`,
      data: { result },
    };
  } catch (err) {
    return workspaceError(err, {
      query: "query:pane_call",
      target: args.target,
      capability: args.capability,
    });
  }
}
