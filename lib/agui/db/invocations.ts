import { getDb } from "./connection";

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
