import { getDb } from "./connection";

// Artifact operations
export interface ArtifactRow {
  id: string;
  run_id: string | null;
  thread_id: string;
  tool_call_id: string | null;
  mime_type: string;
  name: string;
  url: string;
  local_path: string | null;
  original_path: string | null;
  meta: string | null;
  created_at: string;
}

export interface CreateArtifactInput {
  id: string;
  runId: string | null;
  threadId: string;
  toolCallId?: string;
  mimeType: string;
  name: string;
  url: string;
  localPath?: string;
  originalPath?: string;
  meta?: Record<string, unknown>;
}

export function createArtifact(input: CreateArtifactInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO artifacts (id, run_id, thread_id, tool_call_id, mime_type, name, url, local_path, original_path, meta, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.runId,
    input.threadId,
    input.toolCallId ?? null,
    input.mimeType,
    input.name,
    input.url,
    input.localPath ?? null,
    input.originalPath ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
    new Date().toISOString()
  );
}

/**
 * Relink an artifact's run_id so it matches the AGUI run (not Agent-GO's internal run).
 * If the artifact doesn't exist yet, insert a minimal record.
 *
 * @deprecated Canonical runId since cd47211; artifacts are now keyed to the
 * canonical AG-UI runId at insertion time. Remove with the next schema migration.
 */
export function relinkArtifactRun(opts: {
  artifactId: string;
  aguiRunId: string;
  threadId: string;
  toolCallId?: string;
  mimeType?: string;
  name?: string;
  url?: string;
}): void {
  const db = getDb();
  const updated = db
    .prepare(`UPDATE artifacts SET run_id = ? WHERE id = ?`)
    .run(opts.aguiRunId, opts.artifactId);
  if (updated.changes === 0 && opts.url) {
    // Artifact wasn't created via bridge — insert it
    db.prepare(
      `INSERT OR IGNORE INTO artifacts (id, run_id, thread_id, tool_call_id, mime_type, name, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.artifactId,
      opts.aguiRunId,
      opts.threadId,
      opts.toolCallId ?? null,
      opts.mimeType ?? "application/octet-stream",
      opts.name ?? "artifact",
      opts.url,
      new Date().toISOString()
    );
  }
}

/** Batch meta lookup for the gallery feed: url → parsed meta (or null). */
export function getArtifactMetaByUrls(urls: string[]): Map<string, Record<string, unknown> | null> {
  const out = new Map<string, Record<string, unknown> | null>();
  if (urls.length === 0) return out;
  const db = getDb();
  const placeholders = urls.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT url, meta FROM artifacts WHERE url IN (${placeholders})`)
    .all(...urls) as Array<{ url: string; meta: string | null }>;
  for (const r of rows) {
    try {
      out.set(r.url, r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null);
    } catch {
      out.set(r.url, null);
    }
  }
  return out;
}

export function getArtifacts(runId?: string, limit: number = 50): ArtifactRow[] {
  const db = getDb();
  if (runId) {
    return db
      .prepare(`SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(runId, limit) as ArtifactRow[];
  }
  return db
    .prepare(`SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ArtifactRow[];
}

export function getArtifactsByThread(threadId: string, limit: number = 100): ArtifactRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM artifacts WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(threadId, limit) as ArtifactRow[];
}

export function getArtifact(id: string): ArtifactRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as ArtifactRow | undefined;
}
