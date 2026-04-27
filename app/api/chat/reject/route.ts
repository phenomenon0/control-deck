import { NextResponse } from "next/server";
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";

export async function POST(req: Request) {
  let body: { runId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = body.runId;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  // Canonical-runId path — see /api/chat/approve for context.
  try {
    const res = await fetch(`${AGENTGO_URL}/runs/${runId}/reject`, {
      method: "POST",
      headers: withAgentTsAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ reason: body.reason }),
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
