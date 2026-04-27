import { NextResponse } from "next/server";
import { errorRun, getAgentRunId } from "@/lib/agui/db";
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";

/**
 * POST /api/chat/runs/:runId/cancel
 *
 * Barge-in entry point. The voice surface calls this when the user
 * interrupts mid-turn so agent-ts aborts the run instead of continuing
 * to spend tokens after the deck-side fetch has been torn down.
 *
 * The deck and agent-ts share the same runId in the modern path, so we
 * try the URL id first and fall back to the legacy agent_run_id mapping
 * for older agent-ts builds that still allocate their own.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const agentRunId = getAgentRunId(runId) ?? runId;

  try {
    const res = await fetch(`${AGENTGO_URL}/runs/${agentRunId}/cancel`, {
      method: "POST",
      headers: withAgentTsAuth({ "Content-Type": "application/json" }),
    });
    const text = await res.text();
    // Mark the deck-side run row as aborted so the SQLite ledger reflects
    // user intent. Idempotent (UPDATE) — safe even if the chat route's
    // catch block already wrote it after the local fetch was torn down.
    if (res.ok) {
      try {
        errorRun(runId, "aborted");
      } catch (dbErr) {
        console.warn("[cancel] errorRun failed:", dbErr);
      }
    }
    return new NextResponse(text || "{}", {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent-GO unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
