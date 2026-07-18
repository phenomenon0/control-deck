import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { dataRoot } from "@/lib/storage/paths";
// rebuild-trigger

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
 * Crash recovery, runs once per cold DB connection.
 *
 * Runs: any run still in `running` at boot was orphaned — runs are created
 * and ended only by this process's route handlers (createRun / finishRun /
 * errorRun), so a fresh process cannot own a legitimately live row. This is
 * the single-ledger complement to agent-ts holding no durable state: when
 * agent-ts (or the deck itself) dies mid-run, the row converges to `error`
 * here instead of haunting the ledger as `running` forever. An existing
 * text preview is kept; the interrupted note only fills a NULL preview.
 *
 * Approvals: any approval still in `pending` an hour past its row's
 * creation must have outlived the gate that was waiting on it. Mark them
 * expired so the deck UI doesn't show ghosts left over from a previous
 * process.
 *
 * The approval bound is intentionally generous (3600s) — the per-call
 * timeout in `lib/approvals/gate.ts` is shorter, so a row this old
 * definitely lost its waiter. Anything younger is left alone in case a
 * still-running gate is mid-poll on it.
 */
function reconcileOnBoot(db: Database.Database) {
  try {
    const orphaned = db
      .prepare(
        `UPDATE runs
           SET status = 'error',
               ended_at = ?,
               preview = COALESCE(preview, ?)
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString(), "interrupted: process restarted mid-run");
    if (orphaned.changes > 0) {
      console.log(
        `[agui-db] boot reconcile: marked ${orphaned.changes} interrupted run(s) as error`,
      );
    }
  } catch (e) {
    console.warn("[agui-db] boot run reconcile failed:", e);
  }
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

    -- Saved ComfyUI workflows. workflow_json stores either ComfyUI UI graph
    -- JSON or API prompt JSON, tagged by format. Only api_prompt is
    -- directly runnable by the Comfy executor.
    CREATE TABLE IF NOT EXISTS comfy_workflows (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      format TEXT NOT NULL CHECK(format IN ('ui_graph', 'api_prompt')),
      workflow_json TEXT NOT NULL,
      ui_workflow_json TEXT,
      comfy_path TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      lane TEXT NOT NULL DEFAULT 'image' CHECK(lane IN ('image', 'audio', '3d', 'video')),
      estimate_mb INTEGER NOT NULL DEFAULT 8000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comfy_workflows_updated ON comfy_workflows(updated_at);
    CREATE INDEX IF NOT EXISTS idx_comfy_workflows_lane ON comfy_workflows(lane);
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

  try {
    db.exec(`ALTER TABLE comfy_workflows ADD COLUMN ui_workflow_json TEXT`);
  } catch {
    // Column already exists, ignore
  }

  try {
    db.exec(`ALTER TABLE comfy_workflows ADD COLUMN comfy_path TEXT`);
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
