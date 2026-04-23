/**
 * /api/agui/approvals — Cowork-style approval queue.
 *
 *   GET  /api/agui/approvals[?status=pending]  → list
 *   POST /api/agui/approvals                   → body: { id, decision, note? }
 *
 * The tool-dispatch hook that gates on `awaitApproval()` lands in a
 * follow-up; this endpoint is already shaped so both halves can ship
 * independently. Callers that want to manually create approvals for
 * testing can POST with { create: true, ... } — useful for wiring the
 * ApprovalsQueue UI before the dispatch hook is live.
 */

import { NextResponse } from "next/server";
import {
  createApproval,
  decideApproval,
  getApprovals,
  type ApprovalStatus,
} from "@/lib/agui/db";

function parseStatus(raw: string | null): ApprovalStatus | undefined {
  if (raw === "pending" || raw === "approved" || raw === "denied" || raw === "expired") return raw;
  return undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const approvals = getApprovals(status, limit);
  return NextResponse.json({
    approvals: approvals.map((a) => ({
      ...a,
      tool_args: safeJsonParse(a.tool_args),
    })),
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = body as Record<string, unknown> | undefined;

  // Manual create (for wiring tests + UI work before the dispatch hook).
  if (parsed?.create === true) {
    const id = typeof parsed.id === "string" ? parsed.id : cryptoId();
    createApproval({
      id,
      runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
      threadId: typeof parsed.threadId === "string" ? parsed.threadId : undefined,
      toolName: String(parsed.toolName ?? "unknown"),
      toolArgs: (parsed.toolArgs as Record<string, unknown>) ?? {},
      estimatedCostUsd:
        typeof parsed.estimatedCostUsd === "number" ? parsed.estimatedCostUsd : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    });
    return NextResponse.json({ id });
  }

  // Decision path: { id, decision, note? }
  if (
    !parsed ||
    typeof parsed.id !== "string" ||
    (parsed.decision !== "approved" && parsed.decision !== "denied")
  ) {
    return NextResponse.json(
      { error: "body must be { id, decision: approved|denied, note? }" },
      { status: 400 },
    );
  }
  decideApproval(
    parsed.id,
    parsed.decision,
    typeof parsed.note === "string" ? parsed.note : undefined,
  );
  return NextResponse.json({ ok: true });
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function cryptoId(): string {
  return "appr_" + Math.random().toString(36).slice(2, 11);
}
