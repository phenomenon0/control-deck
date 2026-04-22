/**
 * Server-side workspace command relay.
 *
 * Problem: the workspace bus lives in the browser (globalThis.
 * deckWorkspaceBus); agent tool calls route through the server-side
 * /api/tools/bridge. The server can't touch the client's bus directly.
 *
 * Solution: a tiny in-memory pubsub. /api/tools/bridge publishes a
 * command; any connected client (via /api/workspace/commands SSE)
 * receives it and runs it against Dockview.
 *
 * Commands are fire-and-forget for now. Synchronous request/response
 * would need a correlation layer; out of scope for the initial drop.
 */

export interface WorkspaceCommand {
  id: string;
  at: number;
  command: "open_pane" | "close_pane" | "reset" | "focus_pane" | "list_panes";
  args: Record<string, unknown>;
}

type Listener = (cmd: WorkspaceCommand) => void;

declare global {
  // eslint-disable-next-line no-var
  var __workspaceCommandRelay: { listeners: Set<Listener> } | undefined;
}

function getRelay() {
  if (!globalThis.__workspaceCommandRelay) {
    globalThis.__workspaceCommandRelay = { listeners: new Set() };
  }
  return globalThis.__workspaceCommandRelay;
}

export function publishCommand(cmd: Omit<WorkspaceCommand, "id" | "at">): WorkspaceCommand {
  const full: WorkspaceCommand = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    ...cmd,
  };
  for (const fn of getRelay().listeners) {
    try { fn(full); }
    catch (err) { console.error("[workspace.relay] listener threw:", err); }
  }
  return full;
}

export function subscribeCommands(fn: Listener): () => void {
  const relay = getRelay();
  relay.listeners.add(fn);
  return () => { relay.listeners.delete(fn); };
}
