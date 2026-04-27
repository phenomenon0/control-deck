import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { dataRoot } from "@/lib/storage/paths";
// rebuild-trigger

import type { AGUIEvent } from "./events";
import { AGUI_SCHEMA_VERSION, normalizeEvent } from "./events";

function resolveDbPath(): string {
  if (process.env.DECK_DB_PATH) return process.env.DECK_DB_PATH;
  return path.join(dataRoot(), "deck.db");
}

const DB_PATH = resolveDbPath();

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
    reconcileOnBoot(db);
  }
  return db;
}

/**
 * Crash recovery: any approval still in `pending` an hour past its row's
 * creation must have outlived the gate that was waiting on it. Mark them
 * expired so the deck UI doesn't show ghosts left over from a previous
 * process. Runs once per cold DB connection.
 *
 * The bound is intentionally generous (3600s) — the per-call timeout in
 * `lib/approvals/gate.ts` is shorter, so a row this old definitely lost
 * its waiter. Anything younger is left alone in case a still-running gate
 * is mid-poll on it.
 */
function reconcileOnBoot(db: Database.Database) {
  try {
    const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
    db.prepare(
      `UPDATE approvals
         SET status = 'expired',
             decision_note = 'orphaned across restart',
             decision_by = 'system',
             decided_at = ?
       WHERE status = 'pending' AND created_at < ?`,
    ).run(new Date().toISOString(), cutoff);
  } catch (e) {
    console.warn("[approvals] boot reconcile failed:", e);
  }
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
      system_prompt TEXT,
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

    -- Server-persisted deck settings. Row-per-section; value is JSON.
    -- Sections are validated by Zod at lib/settings/schema.ts before write.
    CREATE TABLE IF NOT EXISTS settings (
      section TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Approval queue for gated tool dispatches. Runtime polls this or
    -- subscribes via the AGUI hub to get a decision before proceeding.
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      thread_id TEXT,
      tool_name TEXT NOT NULL,
      tool_args TEXT NOT NULL,
      estimated_cost_usd REAL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      decision_by TEXT,
      decision_note TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id);

    -- Invocation log for tool + skill calls. Powers Capabilities usage stats.
    CREATE TABLE IF NOT EXISTS invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,   -- 'tool' | 'skill'
      target_id TEXT NOT NULL,
      run_id TEXT,
      thread_id TEXT,
      started_at TEXT NOT NULL,
      duration_ms INTEGER,
      status TEXT NOT NULL,        -- 'ok' | 'error'
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invocations_target ON invocations(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_invocations_started ON invocations(started_at);

    -- External MCP servers that Control Deck consumes as a client.
    -- stdio: command + args + env + cwd.  http: url + headers.
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
      command TEXT,
      args TEXT,
      env TEXT,
      cwd TEXT,
      url TEXT,
      headers TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

    -- Voice assets: published / draft voices the deck can speak with.
    -- See lib/voice/types.ts for shape.
    CREATE TABLE IF NOT EXISTS voice_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft',
      kind TEXT NOT NULL DEFAULT 'native',
      provider_id TEXT,
      engine_id TEXT,
      model_id TEXT,
      default_voice_id TEXT,
      language TEXT,
      accent TEXT,
      gender TEXT,
      style_tags TEXT,            -- JSON array
      description TEXT,
      consent_status TEXT NOT NULL DEFAULT 'unknown',
      rights_status TEXT NOT NULL DEFAULT 'unknown',
      owner TEXT,
      meta TEXT,                  -- JSON blob
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_assets_status ON voice_assets(status);
    CREATE INDEX IF NOT EXISTS idx_voice_assets_provider ON voice_assets(provider_id);

    -- Reference clips the studio uses to clone / fine-tune a voice asset.
    -- Binds an artifact row to a voice asset with provenance metadata.
    CREATE TABLE IF NOT EXISTS voice_references (
      id TEXT PRIMARY KEY,
      voice_asset_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      transcript TEXT,
      duration_seconds REAL,
      speaker_name TEXT,
      source_type TEXT NOT NULL DEFAULT 'unknown',
      consent_document TEXT,
      quality_score REAL,
      meta TEXT,                  -- JSON blob
      created_at TEXT NOT NULL,
      FOREIGN KEY (voice_asset_id) REFERENCES voice_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_voice_references_asset ON voice_references(voice_asset_id);

    -- Clone / fine-tune / design / preview jobs.
    CREATE TABLE IF NOT EXISTS voice_jobs (
      id TEXT PRIMARY KEY,
      voice_asset_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      provider_id TEXT,
      engine_id TEXT,
      model_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      input_payload TEXT,         -- JSON blob
      output_payload TEXT,        -- JSON blob
      error TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (voice_asset_id) REFERENCES voice_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_voice_jobs_asset ON voice_jobs(voice_asset_id);
    CREATE INDEX IF NOT EXISTS idx_voice_jobs_status ON voice_jobs(status);

    -- Generated preview clips for A/B comparison.
    CREATE TABLE IF NOT EXISTS voice_previews (
      id TEXT PRIMARY KEY,
      voice_asset_id TEXT NOT NULL,
      job_id TEXT,
      artifact_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      rating_similarity REAL,
      rating_quality REAL,
      rating_latency REAL,
      meta TEXT,                  -- JSON blob
      created_at TEXT NOT NULL,
      FOREIGN KEY (voice_asset_id) REFERENCES voice_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_voice_previews_asset ON voice_previews(voice_asset_id);
    CREATE INDEX IF NOT EXISTS idx_voice_previews_job ON voice_previews(job_id);

    -- Assistant session metadata.
    CREATE TABLE IF NOT EXISTS voice_sessions (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      run_id TEXT,
      stt_provider_id TEXT,
      tts_provider_id TEXT,
      voice_asset_id TEXT,
      mode TEXT NOT NULL DEFAULT 'push_to_talk',
      latency_summary TEXT,       -- JSON blob
      meta TEXT,                  -- JSON blob
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_sessions_thread ON voice_sessions(thread_id);
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

  try {
    db.exec(`ALTER TABLE runs ADD COLUMN agent_run_id TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: per-thread system prompt override. null means "use the
  // global DeckPrefs.systemPrompt."
  try {
    db.exec(`ALTER TABLE threads ADD COLUMN system_prompt TEXT`);
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

export function setAgentRunId(id: string, agentRunId: string): void {
  const db = getDb();
  db.prepare(`UPDATE runs SET agent_run_id = ? WHERE id = ?`).run(agentRunId, id);
}

export function getAgentRunId(id: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT agent_run_id FROM runs WHERE id = ?`)
    .get(id) as { agent_run_id: string | null } | undefined;
  return row?.agent_run_id ?? null;
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

// ─── Settings ──────────────────────────────────────────────────────────────

export interface SettingsRow {
  section: string;
  value: string;
  updated_at: string;
}

export function getSetting(section: string): Record<string, unknown> | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM settings WHERE section = ?`)
    .get(section) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

export function getAllSettings(): Record<string, Record<string, unknown>> {
  const db = getDb();
  const rows = db.prepare(`SELECT section, value FROM settings`).all() as SettingsRow[];
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    try {
      out[r.section] = JSON.parse(r.value);
    } catch {
      // Skip corrupt rows; the resolver logs a warning and falls back to defaults.
    }
  }
  return out;
}

export function setSetting(section: string, value: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (section, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(section) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(section, JSON.stringify(value), new Date().toISOString());
}

// ─── Approvals ─────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRow {
  id: string;
  run_id: string | null;
  thread_id: string | null;
  tool_name: string;
  tool_args: string;
  estimated_cost_usd: number | null;
  reason: string | null;
  status: ApprovalStatus;
  decision_by: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface CreateApprovalInput {
  id: string;
  runId?: string;
  threadId?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  estimatedCostUsd?: number;
  reason?: string;
}

export function createApproval(input: CreateApprovalInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO approvals (id, run_id, thread_id, tool_name, tool_args, estimated_cost_usd, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    input.id,
    input.runId ?? null,
    input.threadId ?? null,
    input.toolName,
    JSON.stringify(input.toolArgs),
    input.estimatedCostUsd ?? null,
    input.reason ?? null,
    new Date().toISOString(),
  );
}

export function decideApproval(
  id: string,
  decision: "approved" | "denied",
  note?: string,
  decisionBy?: string,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE approvals SET status = ?, decision_note = ?, decision_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
  ).run(decision, note ?? null, decisionBy ?? null, new Date().toISOString(), id);
}

export function getApproval(id: string): ApprovalRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id) as ApprovalRow | undefined;
}

export function getApprovals(status?: ApprovalStatus, limit = 100): ApprovalRow[] {
  const db = getDb();
  if (status) {
    return db
      .prepare(`SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
      .all(status, limit) as ApprovalRow[];
  }
  return db
    .prepare(`SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ApprovalRow[];
}

/**
 * Mark every pending approval older than `ageSeconds` as `expired`.
 *
 * Returns the number of rows touched. Used by:
 *   - Server startup, to reconcile after a crash where the in-process gate
 *     died mid-poll and the row was orphaned in `pending` forever.
 *   - The list endpoint, as a passive sweeper so the approval queue UI
 *     never shows weeks-old ghosts even if the user never opened the deck
 *     while the timeout would have fired.
 *
 * Resolution is idempotent — already-decided rows are untouched by the
 * `WHERE status = 'pending'` clause.
 */
export function expirePendingApprovals(
  ageSeconds: number,
  reason = "approval expired",
): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - ageSeconds * 1000).toISOString();
  const result = db
    .prepare(
      `UPDATE approvals
         SET status = 'expired',
             decision_note = ?,
             decision_by = 'system',
             decided_at = ?
       WHERE status = 'pending' AND created_at < ?`,
    )
    .run(reason, new Date().toISOString(), cutoff);
  return result.changes;
}

// ─── Invocations ───────────────────────────────────────────────────────────

export type InvocationTargetType = "tool" | "skill";
export type InvocationStatus = "ok" | "error";

export interface InvocationRow {
  id: number;
  target_type: InvocationTargetType;
  target_id: string;
  run_id: string | null;
  thread_id: string | null;
  started_at: string;
  duration_ms: number | null;
  status: InvocationStatus;
  error: string | null;
}

export interface CreateInvocationInput {
  targetType: InvocationTargetType;
  targetId: string;
  runId?: string;
  threadId?: string;
  startedAt?: string;
  durationMs?: number;
  status: InvocationStatus;
  error?: string;
}

export function recordInvocation(input: CreateInvocationInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO invocations (target_type, target_id, run_id, thread_id, started_at, duration_ms, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.targetType,
    input.targetId,
    input.runId ?? null,
    input.threadId ?? null,
    input.startedAt ?? new Date().toISOString(),
    input.durationMs ?? null,
    input.status,
    input.error ?? null,
  );
}

export interface InvocationStats {
  targetId: string;
  count: number;
  errors: number;
  lastInvokedAt: string | null;
  avgDurationMs: number | null;
}

export function getInvocationStats(
  targetType: InvocationTargetType,
): InvocationStats[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT target_id as targetId,
              COUNT(*) as count,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
              MAX(started_at) as lastInvokedAt,
              AVG(duration_ms) as avgDurationMs
         FROM invocations
         WHERE target_type = ?
         GROUP BY target_id`,
    )
    .all(targetType) as InvocationStats[];
}

export type McpTransportKind = "stdio" | "http";

export interface McpServerRow {
  id: string;
  name: string;
  transport: McpTransportKind;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface McpServerDbRow {
  id: string;
  name: string;
  transport: McpTransportKind;
  command: string | null;
  args: string | null;
  env: string | null;
  cwd: string | null;
  url: string | null;
  headers: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToMcpServer(r: McpServerDbRow): McpServerRow {
  return {
    id: r.id,
    name: r.name,
    transport: r.transport,
    command: r.command,
    args: r.args ? (JSON.parse(r.args) as string[]) : null,
    env: r.env ? (JSON.parse(r.env) as Record<string, string>) : null,
    cwd: r.cwd,
    url: r.url,
    headers: r.headers ? (JSON.parse(r.headers) as Record<string, string>) : null,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface McpServerInput {
  id: string;
  name: string;
  transport: McpTransportKind;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  cwd?: string | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

export function upsertMcpServer(input: McpServerInput): McpServerRow {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args, env, cwd, url, headers, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       transport=excluded.transport,
       command=excluded.command,
       args=excluded.args,
       env=excluded.env,
       cwd=excluded.cwd,
       url=excluded.url,
       headers=excluded.headers,
       enabled=excluded.enabled,
       updated_at=excluded.updated_at`,
  ).run(
    input.id,
    input.name,
    input.transport,
    input.command ?? null,
    input.args ? JSON.stringify(input.args) : null,
    input.env ? JSON.stringify(input.env) : null,
    input.cwd ?? null,
    input.url ?? null,
    input.headers ? JSON.stringify(input.headers) : null,
    input.enabled === false ? 0 : 1,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM mcp_servers WHERE id = ?`)
    .get(input.id) as McpServerDbRow;
  return rowToMcpServer(row);
}

export function getMcpServers(onlyEnabled: boolean = false): McpServerRow[] {
  const db = getDb();
  const rows = (
    onlyEnabled
      ? db.prepare(`SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY name`).all()
      : db.prepare(`SELECT * FROM mcp_servers ORDER BY name`).all()
  ) as McpServerDbRow[];
  return rows.map(rowToMcpServer);
}

export function getMcpServer(id: string): McpServerRow | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM mcp_servers WHERE id = ?`)
    .get(id) as McpServerDbRow | undefined;
  return row ? rowToMcpServer(row) : undefined;
}

export function deleteMcpServer(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM mcp_servers WHERE id = ?`).run(id);
}
