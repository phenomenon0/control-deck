/**
 * Command registry — lets surfaces (panes, widgets, modals) contribute
 * commands to the command palette while they're mounted. The palette is
 * the sole consumer; everything else registers via `useCommands`.
 *
 * Commands carry an optional `scope` — a route prefix like `/deck/chat`
 * or `/deck/control`. When the palette opens, commands whose scope
 * matches the current pathname are ranked first.
 */

export interface RegisteredCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  /** Route prefix this command is most relevant under, e.g. "/deck/chat" */
  scope?: string;
  action: () => void | Promise<void>;
}

type Listener = (commands: RegisteredCommand[]) => void;

const byOwner = new Map<symbol, RegisteredCommand[]>();
const listeners = new Set<Listener>();

function snapshot(): RegisteredCommand[] {
  const out: RegisteredCommand[] = [];
  for (const list of byOwner.values()) out.push(...list);
  return out;
}

function emit(): void {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (err) {
      console.error("[commands] listener threw:", err);
    }
  }
}

/** Register a batch of commands under one owner token. Returns an unregister fn. */
export function registerCommands(
  owner: symbol,
  commands: RegisteredCommand[]
): () => void {
  byOwner.set(owner, commands);
  emit();
  return () => {
    if (byOwner.delete(owner)) emit();
  };
}

export function getRegisteredCommands(): RegisteredCommand[] {
  return snapshot();
}

export function subscribeCommands(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}
