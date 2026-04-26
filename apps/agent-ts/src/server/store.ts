/**
 * SQLite-backed run/event store for agent-ts.
 *
 * Schema (intentionally a subset of Agent-GO's `core/runlog_sqlite.go`):
 *   runs(run_id TEXT PK, thread_id, status, model, started_at, ended_at, last_seq)
 *   events(run_id, seq, type, payload_json, created_at) PK(run_id, seq)
 *
 * Phase B durability story: every emitted AG-UI event is appended to `events`
 * synchronously before the in-memory bus broadcasts. On boot, runs left in
 * `running` state are reaped to `failed` (Phase C will replay them).
 *
 * No leases, snapshots, or checkpoints — those land in Phase C with the
 * recovery service.
 */

import Database, { type Database as DB, type Statement } from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AGUIEvent } from "../wire.js";

export interface StoredRun {
  runId: string;
  threadId: string;
  status: string;
  model?: string;
  startedAt: string;
  endedAt?: string;
  lastSeq: number;
}

export class RunStore {
  private readonly db: DB;
  private readonly insertRun: Statement;
  private readonly updateStatus: Statement;
  private readonly updateLastSeq: Statement;
  private readonly markEnded: Statement;
  private readonly insertEvent: Statement;
  private readonly selectEvents: Statement;
  private readonly selectRun: Statement;
  private readonly selectRunsByStatus: Statement;
  private readonly selectAllRuns: Statement;
  private readonly reapInterrupted: Statement;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);

    this.insertRun = this.db.prepare(
      `INSERT OR IGNORE INTO runs (run_id, thread_id, status, model, started_at, last_seq)
       VALUES (?, ?, ?, ?, ?, 0)`,
    );
    this.updateStatus = this.db.prepare(`UPDATE runs SET status = ? WHERE run_id = ?`);
    this.updateLastSeq = this.db.prepare(
      `UPDATE runs SET last_seq = ? WHERE run_id = ? AND last_seq < ?`,
    );
    this.markEnded = this.db.prepare(
      `UPDATE runs SET status = ?, ended_at = ? WHERE run_id = ?`,
    );
    this.insertEvent = this.db.prepare(
      `INSERT OR IGNORE INTO events (run_id, seq, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.selectEvents = this.db.prepare(
      `SELECT payload_json FROM events
       WHERE run_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`,
    );
    this.selectRun = this.db.prepare(`SELECT * FROM runs WHERE run_id = ?`);
    this.selectRunsByStatus = this.db.prepare(
      `SELECT * FROM runs WHERE status = ? ORDER BY started_at DESC`,
    );
    this.selectAllRuns = this.db.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`);
    this.reapInterrupted = this.db.prepare(
      `UPDATE runs SET status = 'failed', ended_at = ? WHERE status IN ('running', 'paused', 'paused_requested')`,
    );
  }

  startRun(args: {
    runId: string;
    threadId: string;
    status?: string;
    model?: string;
    startedAt?: string;
  }) {
    this.insertRun.run(
      args.runId,
      args.threadId,
      args.status ?? "running",
      args.model ?? null,
      args.startedAt ?? new Date().toISOString(),
    );
  }

  saveEvent(runId: string, event: AGUIEvent) {
    const seq = event.seq ?? 0;
    if (seq <= 0) return;
    this.insertEvent.run(
      runId,
      seq,
      event.type,
      JSON.stringify(event),
      event.timestamp ?? new Date().toISOString(),
    );
    this.updateLastSeq.run(seq, runId, seq);
  }

  setStatus(runId: string, status: string) {
    this.updateStatus.run(status, runId);
  }

  finishRun(runId: string, status: string) {
    this.markEnded.run(status, new Date().toISOString(), runId);
  }

  listEvents(runId: string, afterSeq: number, limit: number): AGUIEvent[] {
    const rows = this.selectEvents.all(runId, afterSeq, limit) as Array<{
      payload_json: string;
    }>;
    const out: AGUIEvent[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.payload_json) as AGUIEvent);
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }

  getRun(runId: string): StoredRun | undefined {
    const row = this.selectRun.get(runId) as RunRow | undefined;
    return row ? rowToRun(row) : undefined;
  }

  listRunsByStatus(status: string): StoredRun[] {
    const rows = this.selectRunsByStatus.all(status) as RunRow[];
    return rows.map(rowToRun);
  }

  listRuns(limit = 100): StoredRun[] {
    const rows = this.selectAllRuns.all(limit) as RunRow[];
    return rows.map(rowToRun);
  }

  /** Reap runs that were active when the process was killed. Returns count. */
  reapInterruptedRuns(): number {
    const info = this.reapInterrupted.run(new Date().toISOString());
    return info.changes;
  }

  close() {
    this.db.close();
  }
}

interface RunRow {
  run_id: string;
  thread_id: string;
  status: string;
  model: string | null;
  started_at: string;
  ended_at: string | null;
  last_seq: number;
}

function rowToRun(row: RunRow): StoredRun {
  return {
    runId: row.run_id,
    threadId: row.thread_id,
    status: row.status,
    model: row.model ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    lastSeq: row.last_seq,
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id     TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running',
  model      TEXT,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  last_seq   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs(thread_id);

CREATE TABLE IF NOT EXISTS events (
  run_id       TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);
`;

export function defaultStorePath(): string {
  const dir =
    process.env.AGENT_TS_STATE_DIR ??
    path.join(
      process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
      "control-deck",
      "agent-ts",
    );
  return path.join(dir, "runs.db");
}
