import { getDb } from "./connection";

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
