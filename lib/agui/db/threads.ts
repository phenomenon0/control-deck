import { getDb } from "./connection";

// Thread operations
export interface ThreadRow {
  id: string;
  title: string | null;
  preview?: string | null;
  /** Thread-scoped system prompt override; null means "use the global one." */
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export function createThread(id: string, title?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run(id, title ?? null, now, now);
  if (title) {
    updateThreadTitle(id, title);
  }
}

export function updateThreadTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    new Date().toISOString(),
    id
  );
}

/**
 * Set or clear a thread's system-prompt override. Pass null to revert
 * the thread to whatever the global DeckPrefs.systemPrompt is.
 */
export function updateThreadSystemPrompt(id: string, prompt: string | null): void {
  const db = getDb();
  db.prepare(`UPDATE threads SET system_prompt = ?, updated_at = ? WHERE id = ?`).run(
    prompt,
    new Date().toISOString(),
    id,
  );
}

export function getThreads(limit: number = 50): ThreadRow[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT threads.*,
        (
          SELECT substr(messages.content, 1, 180)
          FROM messages
          WHERE messages.thread_id = threads.id
          ORDER BY messages.created_at DESC
          LIMIT 1
        ) AS preview
      FROM threads
      ORDER BY threads.updated_at DESC
      LIMIT ?
    `)
    .all(limit) as ThreadRow[];
}

export function getThread(id: string): ThreadRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM threads WHERE id = ?`).get(id) as
    | ThreadRow
    | undefined;
}

export function deleteThread(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(id);
  db.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
}

// Message operations
export interface MessageMetadata {
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
  toolCalls?: Array<Record<string, unknown>>;
  uploads?: Array<{ id: string; url: string; name: string; mimeType: string }>;
  workflowRefs?: Array<{ id: string; slug: string; name: string }>;
  tool_name?: string;  // For tool role messages
}

export interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  run_id: string | null;
  metadata: string | null;  // JSON stringified MessageMetadata
  created_at: string;
}

export interface SaveMessageOptions {
  id: string;
  threadId: string;
  role: string;
  content: string;
  runId?: string;
  metadata?: MessageMetadata;
}

export function saveMessage(opts: SaveMessageOptions): void;
export function saveMessage(
  id: string,
  threadId: string,
  role: string,
  content: string,
  runId?: string,
  metadata?: MessageMetadata
): void;
export function saveMessage(
  idOrOpts: string | SaveMessageOptions,
  threadId?: string,
  role?: string,
  content?: string,
  runId?: string,
  metadata?: MessageMetadata
): void {
  // Handle both signatures
  let opts: SaveMessageOptions;
  if (typeof idOrOpts === "object") {
    opts = idOrOpts;
  } else {
    opts = {
      id: idOrOpts,
      threadId: threadId!,
      role: role!,
      content: content!,
      runId,
      metadata,
    };
  }
  
  const db = getDb();
  const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;
  
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, run_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(opts.id, opts.threadId, opts.role, opts.content, opts.runId ?? null, metadataJson, new Date().toISOString());
  
  // Update thread's updated_at
  db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    opts.threadId
  );
}

export function getMessages(threadId: string): MessageRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC`)
    .all(threadId) as MessageRow[];
}

export function updateMessage(id: string, content: string, metadata?: MessageMetadata): void {
  const db = getDb();
  if (metadata !== undefined) {
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    db.prepare(`UPDATE messages SET content = ?, metadata = ? WHERE id = ?`).run(content, metadataJson, id);
  } else {
    db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(content, id);
  }
}
