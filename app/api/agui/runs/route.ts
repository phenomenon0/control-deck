import { getRuns, getEvents, getTotalCost, clearRuns } from "@/lib/agui/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

  const runs = getRuns(threadId, limit);

  // Get today's cost
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCost = getTotalCost(today);

  return NextResponse.json({
    runs,
    todayCost,
  });
}

export async function DELETE() {
  clearRuns();
  return NextResponse.json({ ok: true });
}

// Get events for a specific run
export async function POST(req: Request) {
  const { runId } = await req.json();

  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const events = getEvents(runId);
  return NextResponse.json({ events });
}
