/**
 * /api/agui/threads — Amp-style thread catalogue with cost totals.
 *
 *   GET   /api/agui/threads            → threads with per-thread totals
 *   PATCH /api/agui/threads            → body: { id, title } — rename/label
 *
 * Fork + compact are flagged for later: they need agent-dispatch wiring
 * (fork = duplicate thread + messages; compact = summarise-then-replace).
 */

import { NextResponse } from "next/server";
import { getDb, getThreads, updateThreadTitle } from "@/lib/agui/db";

interface ThreadWithTotals {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastRunAt: string | null;
}

function getThreadsWithTotals(limit: number): ThreadWithTotals[] {
  const threads = getThreads(limit);
  if (threads.length === 0) return [];
  const db = getDb();
  const ids = threads.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const totals = db
    .prepare(
      `SELECT thread_id,
              COUNT(*) as runs,
              COALESCE(SUM(input_tokens), 0) as inputTokens,
              COALESCE(SUM(output_tokens), 0) as outputTokens,
              COALESCE(SUM(cost_usd), 0) as costUsd,
              MAX(started_at) as lastRunAt
         FROM runs WHERE thread_id IN (${placeholders})
         GROUP BY thread_id`,
    )
    .all(...ids) as Array<{
    thread_id: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    lastRunAt: string | null;
  }>;
  const map = new Map(totals.map((t) => [t.thread_id, t]));
  return threads.map((t) => {
    const m = map.get(t.id);
    return {
      ...t,
      runs: m?.runs ?? 0,
      inputTokens: m?.inputTokens ?? 0,
      outputTokens: m?.outputTokens ?? 0,
      costUsd: m?.costUsd ?? 0,
      lastRunAt: m?.lastRunAt ?? null,
    };
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  return NextResponse.json({ threads: getThreadsWithTotals(limit) });
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = body as { id?: string; title?: string } | undefined;
  if (!parsed?.id || typeof parsed.title !== "string") {
    return NextResponse.json({ error: "id and title required" }, { status: 400 });
  }
  updateThreadTitle(parsed.id, parsed.title);
  return NextResponse.json({ ok: true });
}
