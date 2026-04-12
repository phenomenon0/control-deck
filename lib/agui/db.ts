import Database from "better-sqlite3";
import path from "path";
import type { AGUIEvent } from "./events";
import { AGUI_SCHEMA_VERSION, normalizeEvent } from "./events";

const DB_PATH = path.join(process.cwd(), "data", "deck.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      preview TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      type TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      thread_id TEXT NOT NULL,
      tool_call_id TEXT,
      mime_type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      local_path TEXT,
      original_path TEXT,
      meta TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      run_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_run ON messages(run_id);

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      data TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      filename TEXT,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uploads_thread ON uploads(thread_id);

    -- Plugin system tables
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT 'puzzle',
      template TEXT NOT NULL,
      bundle TEXT NOT NULL,
      config_values TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugin_cache (
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, source_id),
      FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_plugin_cache_expires ON plugin_cache(expires_at);
  `);
  
  // Migration: Add run_id column to messages if it doesn't exist
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN run_id TEXT`);
  } catch {
    // Column already exists, ignore
  }
  
  // Migration: Add metadata column to messages for tool_calls, tool_name, etc.
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
  } catch {
    // Column already exists, ignore
  }
  
  // Migration: Add schema_version column to events
  try {
    db.exec(`ALTER TABLE events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists, ignore
  }
}

// Run operations
export function createRun(
  id: string,
  threadId: string,
  model?: string
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO runs (id, thread_id, started_at, status, model) VALUES (?, ?, ?, 'running', ?)`
  ).run(id, threadId, new Date().toISOString(), model ?? null);
}

export function finishRun(
  id: string,
  inputTokens?: number,
  outputTokens?: number,
  costUsd?: number
): void {
  const db = getDb();
  db.prepare(
    `UPDATE runs SET ended_at = ?, status = 'finished', input_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ?`
  ).run(
    new Date().toISOString(),
    inputTokens ?? 0,
    outputTokens ?? 0,
    costUsd ?? 0,
    id
  );
}

export function errorRun(id: string, error: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE runs SET ended_at = ?, status = 'error', preview = ? WHERE id = ?`
  ).run(new Date().toISOString(), error.slice(0, 200), id);
}

export function updateRunPreview(id: string, preview: string): void {
  const db = getDb();
  db.prepare(`UPDATE runs SET preview = ? WHERE id = ? AND preview IS NULL`).run(
    preview.slice(0, 200),
    id
  );
}

export interface RunRow {
  id: string;
  thread_id: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "finished" | "error";
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  preview: string | null;
}

export function getRuns(
  threadId?: string,
  limit: number = 50
): RunRow[] {
  const db = getDb();
  if (threadId) {
    return db
      .prepare(
        `SELECT * FROM runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT ?`
      )
      .all(threadId, limit) as RunRow[];
  }
  return db
    .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as RunRow[];
}

export function getRun(id: string): RunRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
    | RunRow
    | undefined;
}

// Event operations
export function saveEvent(evt: AGUIEvent): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO events (run_id, thread_id, type, schema_version, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    evt.runId ?? "",
    evt.threadId,
    evt.type,
    evt.schemaVersion ?? AGUI_SCHEMA_VERSION,
    JSON.stringify(evt),
    evt.timestamp
  );
}

export interface EventRow {
  id: number;
  run_id: string;
  thread_id: string;
  type: string;
  schema_version: number;
  data: string;
  timestamp: string;
}

export function getEvents(runId: string): AGUIEvent[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY id ASC`)
    .all(runId) as EventRow[];
  // Parse and normalize to current schema (handles v1 → v2 migration)
  return rows.map((r) => normalizeEvent(JSON.parse(r.data)));
}

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

// Cost tracking
export function getTotalCost(since?: Date): { inputTokens: number; outputTokens: number; costUsd: number } {
  const db = getDb();
  const sinceStr = since?.toISOString() ?? "1970-01-01";
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens, COALESCE(SUM(cost_usd), 0) as cost_usd FROM runs WHERE started_at >= ?`
    )
    .get(sinceStr) as { input_tokens: number; output_tokens: number; cost_usd: number };
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
  };
}

// Clear all data
export function clearRuns(): void {
  const db = getDb();
  db.exec(`DELETE FROM events; DELETE FROM runs;`);
}

// Thread operations
export interface ThreadRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export function createThread(id: string, title?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run(id, title ?? null, now, now);
}

export function updateThreadTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    new Date().toISOString(),
    id
  );
}

export function getThreads(limit: number = 50): ThreadRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM threads ORDER BY updated_at DESC LIMIT ?`)
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

// Upload operations (for image/file uploads, stored as base64)
export interface UploadRow {
  id: string;
  thread_id: string;
  data: string;  // base64 encoded
  mime_type: string;
  filename: string | null;
  size: number;
  created_at: string;
}

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20MB

export function createUpload(
  id: string,
  threadId: string,
  data: string,
  mimeType: string,
  filename?: string
): void {
  const size = Buffer.byteLength(data, "base64");
  if (size > MAX_UPLOAD_SIZE) {
    throw new Error(`Upload too large: ${size} bytes (max ${MAX_UPLOAD_SIZE})`);
  }
  
  const db = getDb();
  db.prepare(
    `INSERT INTO uploads (id, thread_id, data, mime_type, filename, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, threadId, data, mimeType, filename ?? null, size, new Date().toISOString());
}

export function getUpload(id: string): UploadRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM uploads WHERE id = ?`).get(id) as UploadRow | undefined;
}

export function getUploadsByThread(threadId: string, limit: number = 50): UploadRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT id, thread_id, mime_type, filename, size, created_at FROM uploads WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(threadId, limit) as UploadRow[];
}

export function deleteUpload(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM uploads WHERE id = ?`).run(id);
}

// Cleanup old uploads (older than 7 days)
export function cleanupOldUploads(): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`DELETE FROM uploads WHERE created_at < ?`).run(cutoff);
  return result.changes;
}

// =============================================================================
// Plugin operations
// =============================================================================

export interface PluginRow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  template: string;
  bundle: string;  // JSON stringified PluginBundle
  config_values: string;  // JSON stringified config overrides
  enabled: number;  // SQLite boolean
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePluginInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  template: string;
  bundle: object;  // Will be JSON stringified
  configValues?: Record<string, unknown>;
  enabled?: boolean;
  sortOrder?: number;
}

export function createPlugin(input: CreatePluginInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO plugins (id, name, description, icon, template, bundle, config_values, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.name,
    input.description ?? null,
    input.icon ?? "puzzle",
    input.template,
    JSON.stringify(input.bundle),
    JSON.stringify(input.configValues ?? {}),
    input.enabled !== false ? 1 : 0,
    input.sortOrder ?? 0,
    now,
    now
  );
}

export function getPlugins(enabledOnly: boolean = false): PluginRow[] {
  const db = getDb();
  if (enabledOnly) {
    return db
      .prepare(`SELECT * FROM plugins WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC`)
      .all() as PluginRow[];
  }
  return db
    .prepare(`SELECT * FROM plugins ORDER BY sort_order ASC, created_at ASC`)
    .all() as PluginRow[];
}

export function getPlugin(id: string): PluginRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM plugins WHERE id = ?`).get(id) as PluginRow | undefined;
}

export function updatePlugin(
  id: string, 
  updates: Partial<Pick<PluginRow, "name" | "description" | "icon" | "template" | "enabled" | "sort_order"> & { bundle?: object; configValues?: Record<string, unknown> }>
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.icon !== undefined) { fields.push("icon = ?"); values.push(updates.icon); }
  if (updates.template !== undefined) { fields.push("template = ?"); values.push(updates.template); }
  if (updates.bundle !== undefined) { fields.push("bundle = ?"); values.push(JSON.stringify(updates.bundle)); }
  if (updates.configValues !== undefined) { fields.push("config_values = ?"); values.push(JSON.stringify(updates.configValues)); }
  if (updates.enabled !== undefined) { fields.push("enabled = ?"); values.push(updates.enabled ? 1 : 0); }
  if (updates.sort_order !== undefined) { fields.push("sort_order = ?"); values.push(updates.sort_order); }
  
  if (fields.length === 0) return;
  
  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  
  db.prepare(`UPDATE plugins SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deletePlugin(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM plugins WHERE id = ?`).run(id);
}

export function updatePluginOrder(orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare(`UPDATE plugins SET sort_order = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();
  
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      stmt.run(index, now, id);
    });
  })();
}

// =============================================================================
// Plugin cache operations
// =============================================================================

export interface PluginCacheRow {
  plugin_id: string;
  source_id: string;
  data: string;  // JSON stringified
  fetched_at: string;
  expires_at: string;
}

export function getPluginCache(pluginId: string, sourceId: string): PluginCacheRow | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .prepare(`SELECT * FROM plugin_cache WHERE plugin_id = ? AND source_id = ? AND expires_at > ?`)
    .get(pluginId, sourceId, now) as PluginCacheRow | undefined;
}

export function setPluginCache(pluginId: string, sourceId: string, data: unknown, ttlMs: number): void {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  
  db.prepare(
    `INSERT OR REPLACE INTO plugin_cache (plugin_id, source_id, data, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(pluginId, sourceId, JSON.stringify(data), now.toISOString(), expiresAt.toISOString());
}

export function clearPluginCache(pluginId: string, sourceId?: string): void {
  const db = getDb();
  if (sourceId) {
    db.prepare(`DELETE FROM plugin_cache WHERE plugin_id = ? AND source_id = ?`).run(pluginId, sourceId);
  } else {
    db.prepare(`DELETE FROM plugin_cache WHERE plugin_id = ?`).run(pluginId);
  }
}

export function cleanupExpiredCache(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`DELETE FROM plugin_cache WHERE expires_at < ?`).run(now);
  return result.changes;
}
