/**
 * POST /api/free-tier/refresh — explicit OpenRouter catalog refresh.
 *
 * The FreeModeIndicator popover calls this when the user clicks "Refresh
 * catalog" so they can pick up newly-listed free models without waiting
 * for the 6h lazy TTL to elapse.
 */

import { NextResponse } from "next/server";
import { freeTierRouter } from "@/lib/llm/freeTier";

export async function POST() {
  const result = await freeTierRouter.forceRefresh();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
