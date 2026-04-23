/**
 * POST /api/agentgo/launch — spawn Agent-GO if it isn't already running.
 *
 * Idempotent: re-hitting when it's already up returns
 * { status: "already-running" }. On cold start it spawns the binary as a
 * detached child, writes stdout+stderr to
 * ~/.local/state/control-deck/agentgo.log, and polls /health until it
 * answers (or gives up at 10s).
 */

import { NextResponse } from "next/server";
import { launchAgentGo } from "@/lib/agentgo/launcher";

export async function POST() {
  const result = await launchAgentGo();
  const status = result.status === "failed" ? 502 : 200;
  return NextResponse.json(result, { status });
}
