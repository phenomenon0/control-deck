import { NextRequest } from "next/server";

import { reportOom } from "@/lib/resource/arbiter";
import type { LaneId } from "@/lib/resource/types";
import { LANE_IDS } from "@/lib/resource/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/resource/oom — sidecars call this when they catch an OOM.
 * Body `{ lane: LaneId, error: string, kind?: "vram" | "ram" }`.
 * kind "ram" marks a host-RAM kill (OOM-killer / MemoryError) — same
 * flush-and-restore handling, distinctly labeled so the event log and
 * Runs warnings show WHICH memory ran out.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { lane?: string; error?: string; kind?: string }
    | null;
  const lane = body?.lane;
  if (!lane || !(LANE_IDS as readonly string[]).includes(lane)) {
    return Response.json({ error: `invalid lane: ${String(lane)}` }, { status: 400 });
  }
  const kind = body?.kind === "ram" ? "ram" : "vram";
  const prefix = kind === "ram" ? "[host-ram] " : "";
  await reportOom(lane as LaneId, `${prefix}${body?.error ?? "unspecified"}`);
  return Response.json({ ok: true, kind });
}
