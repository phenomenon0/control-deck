import { NextRequest } from "next/server";

import { reportOom } from "@/lib/resource/arbiter";
import type { LaneId } from "@/lib/resource/types";
import { LANE_IDS } from "@/lib/resource/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/resource/oom — sidecars call this when they catch CUDA OOM.
 * Body `{ lane: LaneId, error: string }`. Arbiter drops the lane's
 * reservations and force-unloads.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { lane?: string; error?: string } | null;
  const lane = body?.lane;
  if (!lane || !(LANE_IDS as readonly string[]).includes(lane)) {
    return Response.json({ error: `invalid lane: ${String(lane)}` }, { status: 400 });
  }
  await reportOom(lane as LaneId, body?.error ?? "unspecified");
  return Response.json({ ok: true });
}
