import type { AGUIEvent } from "../events";
import { AGUI_SCHEMA_VERSION, normalizeEvent } from "../events";
import { getDb } from "./connection";

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

/** @deprecated Canonical runId since cd47211; remove with the next schema migration. */
export function setAgentRunId(id: string, agentRunId: string): void {
  const db = getDb();
  db.prepare(`UPDATE runs SET agent_run_id = ? WHERE id = ?`).run(agentRunId, id);
}

/** @deprecated Canonical runId since cd47211; remove with the next schema migration. */
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
