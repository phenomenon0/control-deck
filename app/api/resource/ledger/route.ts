import { NextRequest } from "next/server";

import { ensureArbiterBooted, snapshot } from "@/lib/resource/arbiter";
import { refreshSnapshot } from "@/lib/resource/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/resource/ledger
 *
 * Returns the latest VRAM ledger snapshot. Cheap (in-memory + one
 * nvidia-smi shell). Used by ResourcePane on mount.
 */
export async function GET(_req: NextRequest): Promise<Response> {
  ensureArbiterBooted();
  // One forced refresh so the caller always gets fresh numbers, not whatever
  // the poller last collected.
  const snap = await refreshSnapshot().catch(() => snapshot());
  return new Response(JSON.stringify(snap), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
