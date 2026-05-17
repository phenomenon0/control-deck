import { NextRequest } from "next/server";

import { release, touch } from "@/lib/resource/arbiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/resource/release    — body `{ ticket: string, action?: "release"|"touch" }`.
 * Default action is `release`. `touch` resets the TTL.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { ticket?: string; action?: string } | null;
  const ticket = body?.ticket;
  if (!ticket || typeof ticket !== "string") {
    return Response.json({ error: "missing ticket" }, { status: 400 });
  }
  const action = body?.action ?? "release";
  if (action === "touch") {
    return Response.json({ ok: touch(ticket) });
  }
  return Response.json({ ok: release(ticket) });
}
