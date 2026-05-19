/**
 * GET  /api/onboarding/state — is onboarding done? { done, tier?, completedAt? }
 * POST /api/onboarding/state — body `{ done: false }` clears the flag so the
 *      user can re-run onboarding from the settings page.
 */

import { NextResponse } from "next/server";
import { clearDone, markDoneManual, readDoneState } from "@/lib/onboarding/orchestrator";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readDoneState());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { done?: boolean };
    if (body.done === false) {
      await clearDone();
    } else if (body.done === true) {
      // Used by the onboarding Skip button so the bypass survives a reload.
      await markDoneManual();
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json(await readDoneState());
}
