import { NextResponse } from "next/server";
import { decideApproval, getApproval } from "@/lib/agui/db";
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";

export async function POST(req: Request) {
  let body: { runId?: string; approvalId?: string; request_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = body.runId;
  const requestId = body.approvalId ?? body.request_id;

  if (requestId) {
    const approval = getApproval(requestId);
    if (approval) {
      if (approval.status === "pending") {
        decideApproval(requestId, "approved", undefined, "chat");
      }
      const status = getApproval(requestId)?.status ?? approval.status;
      return NextResponse.json({
        approved: status === "approved",
        approvalId: requestId,
        status,
      });
    }
  }

  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  // Canonical-runId path: the deck and agent-ts share the same runId
  // since cd47211, so we forward straight to agent-ts without the
  // legacy getAgentRunId reconciliation lookup.
  try {
    const res = await fetch(`${AGENTGO_URL}/runs/${runId}/approve`, {
      method: "POST",
      headers: withAgentTsAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify(requestId ? { request_id: requestId } : {}),
    });
    const text = await res.text();
    return new NextResponse(text || "{}", {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent-GO unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
