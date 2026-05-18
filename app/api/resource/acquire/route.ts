import { NextRequest } from "next/server";

import { acquire } from "@/lib/resource/arbiter";
import type { AcquireRequest, LaneId } from "@/lib/resource/types";
import { LANE_IDS } from "@/lib/resource/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/resource/acquire — JSON body of AcquireRequest, returns AcquireResult. */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Partial<AcquireRequest> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "expected JSON AcquireRequest body" }, { status: 400 });
  }
  const lane = body.lane;
  if (!lane || !(LANE_IDS as readonly string[]).includes(lane)) {
    return Response.json({ error: `invalid lane: ${String(lane)}` }, { status: 400 });
  }
  const estimateMb = Number(body.estimateMb);
  if (!Number.isFinite(estimateMb) || estimateMb < 0) {
    return Response.json({ error: "estimateMb must be a non-negative number" }, { status: 400 });
  }
  let swapTo: AcquireRequest["swapTo"];
  if (body.swapTo !== undefined) {
    const raw = body.swapTo;
    const swapEstimateMb = Number(raw?.estimateMb);
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.modelId !== "string" ||
      raw.modelId.length === 0 ||
      !Number.isFinite(swapEstimateMb) ||
      swapEstimateMb < 0
    ) {
      return Response.json(
        { error: "swapTo must include modelId and non-negative estimateMb" },
        { status: 400 },
      );
    }
    swapTo = { modelId: raw.modelId, estimateMb: swapEstimateMb };
  }
  const result = await acquire({
    lane: lane as LaneId,
    estimateMb,
    reason: typeof body.reason === "string" ? body.reason : "unspecified",
    priority: body.priority,
    evicts: body.evicts,
    ttlMs: body.ttlMs,
    restoreOnIdle: body.restoreOnIdle,
    modelId: body.modelId,
    swapTo,
  });
  return Response.json(result);
}
