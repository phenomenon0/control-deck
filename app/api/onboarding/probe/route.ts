/**
 * GET /api/onboarding/probe — what's the system, what's missing, are we done.
 *
 * Cheap, idempotent — safe to poll. The onboarding page calls this once on
 * mount to render the hardware card and the missing-pieces checklist.
 */

import { NextResponse } from "next/server";
import { probeOnboarding } from "@/lib/onboarding/orchestrator";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const probe = await probeOnboarding();
    return NextResponse.json(probe);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "probe failed" },
      { status: 500 },
    );
  }
}
