/**
 * POST /api/llamacpp/launch — spawn llama-server if it isn't already up.
 *
 * Idempotent: re-hitting when it's already up returns
 * { status: "already-running" }. On cold start it spawns the binary
 * detached, writes stdout+stderr to ~/.local/state/control-deck/llamacpp.log,
 * and polls /v1/models until it answers (or gives up at 60s).
 */

import { NextResponse } from "next/server";
import { launchLlamacpp } from "@/lib/llamacpp/launcher";

export async function POST() {
  const result = await launchLlamacpp();
  const status = result.status === "failed" ? 502 : 200;
  return NextResponse.json(result, { status });
}
