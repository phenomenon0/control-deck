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
import { launchLlamacpp } from "@/lib/llamacpp/launcher";

export async function POST() {
  // Boot the agent runtime and its LLM in parallel. The agent comes up
  // fast (<1s); llama-server can take 30s+ to warm the GPU. The deck UI
  // already polls /api/llamacpp/status separately, so we don't gate the
  // agent response on the LLM being ready — we just kick the launch.
  const [agent, llm] = await Promise.all([launchAgentGo(), launchLlamacpp()]);
  const status = agent.status === "failed" ? 502 : 200;
  return NextResponse.json({ ...agent, llm }, { status });
}
