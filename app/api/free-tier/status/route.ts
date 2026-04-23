/**
 * GET /api/free-tier/status — snapshot of the free-tier router.
 *
 * Returns the full catalog with remaining quota per model and a flag for
 * whichever one is currently active. The FreeModeIndicator pill polls
 * this every 10s to show live counters next to the chat composer.
 */

import { NextResponse } from "next/server";
import { freeTierRouter, FREE_TIER_CATALOG } from "@/lib/llm/freeTier";

export async function GET() {
  const active = freeTierRouter.currentPick();
  const status = freeTierRouter.status();
  const hasKey = Boolean(process.env.OPENROUTER_API_KEY);

  return NextResponse.json({
    enabled: hasKey,
    activeModelId: active ?? null,
    catalog: FREE_TIER_CATALOG,
    status,
  });
}
