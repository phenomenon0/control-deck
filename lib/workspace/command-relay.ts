/**
 * Server-side workspace command relay.
 *
 * The workspace bus lives in the browser (globalThis.deckWorkspaceBus);
 * agent tool calls route through the server-side /api/tools/bridge.
 * The server can't touch the client's bus directly, so we bridge:
 *
 *   /api/tools/bridge  (server)
 *     publishCommand(...)    → fire-and-forget
 *     publishQuery(...)      → awaits correlated response
 *            ↓ SSE stream
 *   /api/workspace/commands   (server → client)
 *            ↓ event handler
 *   WorkspaceShell (client) — runs against Dockview / bus
 *     for queries: POSTs result to /api/workspace/responses
 *            ↓
 *   submitResponse(id, data) resolves the awaiting promise
 */

export interface WorkspaceCommand {
  id: string;
  at: number;
  /** "query:*" commands expect a response; others are fire-and-forget. */
  command:
    | "open_pane"
    | "close_pane"
    | "reset"
    | "focus_pane"
    | "query:list_panes"
    | "query:pane_call";
  args: Record<string, unknown>;
}

type Listener = (cmd: WorkspaceCommand) => void;

interface PendingQuery {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

declare global {
  // eslint-disable-next-line no-var
  var __workspaceCommandRelay:
    | {
        listeners: Set<Listener>;
        pending: Map<string, PendingQuery>;
      }
    | undefined;
}

function getRelay() {
  let relay = globalThis.__workspaceCommandRelay;
  if (!relay) {
    relay = { listeners: new Set(), pending: new Map() };
    globalThis.__workspaceCommandRelay = relay;
    return relay;
  }
  // Hot-reload migration: older module instances had only `listeners`.
  // Add any missing fields without dropping the existing subscribers.
  if (!relay.listeners) relay.listeners = new Set();
  if (!relay.pending) relay.pending = new Map();
  return relay;
}

function nextId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function publishCommand(cmd: Omit<WorkspaceCommand, "id" | "at">): WorkspaceCommand {
  const full: WorkspaceCommand = {
    id: nextId("cmd"),
    at: Date.now(),
    ...cmd,
  };
  for (const fn of getRelay().listeners) {
    try { fn(full); }
    catch (err) { console.error("[workspace.relay] listener threw:", err); }
  }
  return full;
}

/**
 * Publish a query command and await the client's response. Throws if
 * no client responds within `timeoutMs` — typical causes are "no
 * workspace tab open" or "all clients crashed".
 */
export function publishQuery<T = unknown>(
  command: WorkspaceCommand["command"],
  args: Record<string, unknown>,
  timeoutMs = 5_000,
): Promise<T> {
  if (!command.startsWith("query:")) {
    return Promise.reject(new Error(`publishQuery: command must start with "query:", got "${command}"`));
  }
  const relay = getRelay();
  const full: WorkspaceCommand = {
    id: nextId("q"),
    at: Date.now(),
    command,
    args,
  };
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      relay.pending.delete(full.id);
      reject(new Error(
        `workspace query ${command} timed out after ${timeoutMs}ms ` +
        `(no client responded — is /deck/workspace open?)`,
      ));
    }, timeoutMs);

    relay.pending.set(full.id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer,
    });

    for (const fn of relay.listeners) {
      try { fn(full); }
      catch (err) { console.error("[workspace.relay] listener threw:", err); }
    }
  });
}

/** Client posts back here after executing a query. */
export function submitResponse(id: string, data: unknown, error?: string): boolean {
  const relay = getRelay();
  const pending = relay.pending.get(id);
  if (!pending) return false;
  relay.pending.delete(id);
  clearTimeout(pending.timer);
  if (error) pending.reject(new Error(error));
  else pending.resolve(data);
  return true;
}

export function subscribeCommands(fn: Listener): () => void {
  const relay = getRelay();
  relay.listeners.add(fn);
  return () => { relay.listeners.delete(fn); };
}
