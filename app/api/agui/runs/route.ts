import { getRuns, getEvents, getArtifacts, getTotalCost, clearRuns } from "@/lib/agui/db";
import {
  costOverTime,
  errorRateOverTime,
  latencyByTool,
  toolUsage,
  type Window,
} from "@/lib/agui/metrics";
import { NextResponse } from "next/server";

function parseWindow(raw: string | null): Window {
  if (raw === "24h" || raw === "7d" || raw === "30d" || raw === "all") return raw;
  return "7d";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const aggregate = url.searchParams.get("aggregate");
  const windowParam = parseWindow(url.searchParams.get("window"));

  // Aggregation mode — Runs telemetry dashboard.
  if (aggregate) {
    switch (aggregate) {
      case "cost":
        return NextResponse.json({ window: windowParam, series: costOverTime(windowParam) });
      case "latency":
        return NextResponse.json({ window: windowParam, series: latencyByTool(windowParam) });
      case "tools":
        return NextResponse.json({ window: windowParam, series: toolUsage(windowParam) });
      case "errors":
        return NextResponse.json({ window: windowParam, series: errorRateOverTime(windowParam) });
      default:
        return NextResponse.json({ error: `unknown aggregate: ${aggregate}` }, { status: 400 });
    }
  }

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
  // E1: runs show what they produced — artifact rows ride along so the
  // timeline can render an artifacts strip (runId linkage existed in the
  // DB since day one; no UI ever read it).
  const artifacts = getArtifacts(runId, 24);
  return NextResponse.json({ events, artifacts });
}
