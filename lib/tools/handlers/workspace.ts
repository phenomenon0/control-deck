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
  WorkspacePaneCallArgs,
} from "../definitions";
import { publishCommand, publishQuery } from "@/lib/workspace/command-relay";
import type { ToolExecutionResult } from "../executor";

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

export async function executeWorkspaceListPanes(): Promise<ToolExecutionResult> {
  try {
    const snapshot = await publishQuery<unknown[]>("query:list_panes", {}, 5_000);
    return {
      success: true,
      message: `Workspace has ${Array.isArray(snapshot) ? snapshot.length : 0} registered pane(s)`,
      data: { panes: snapshot },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "workspace_list_panes failed";
    return { success: false, message: msg, error: msg };
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
      5_000,
    );
    return {
      success: true,
      message: `${args.target}.${args.capability} → ok`,
      data: { result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "workspace_pane_call failed";
    return { success: false, message: msg, error: msg };
  }
}
