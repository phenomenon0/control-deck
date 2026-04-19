import { NextResponse } from "next/server";
import { getAgentRunId } from "@/lib/agui/db";

const AGENTGO_URL = process.env.AGENTGO_URL ?? "http://localhost:4243";

export async function POST(req: Request) {
  let body: { runId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = body.runId;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const agentRunId = getAgentRunId(runId);
  if (!agentRunId) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  try {
    const res = await fetch(`${AGENTGO_URL}/runs/${agentRunId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
