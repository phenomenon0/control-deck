/**
 * GET /api/free-tier/status — snapshot of the free-tier router.
 *
 * Returns the full catalog with remaining quota per model and a flag for
 * whichever one is currently active. The FreeModeIndicator pill polls
 * this every 10s to show live counters next to the chat composer.
 */

import { NextResponse } from "next/server";
import { freeTierRouter, getCatalog } from "@/lib/llm/freeTier";

export async function GET() {
  // Side-effect: kick a lazy refresh if the catalog is stale. Doesn't
  // block — next poll will see fresh models.
  freeTierRouter.maybeRefresh();

  const active = freeTierRouter.currentPick();
  const status = freeTierRouter.status();
  const providers = {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    nvidia: Boolean(process.env.NVIDIA_API_KEY),
  };
  const { at, result } = freeTierRouter.getLastRefresh();

  return NextResponse.json({
    enabled: providers.openrouter || providers.nvidia,
    providers,
    activeModelId: active ?? null,
    catalog: getCatalog(),
    status,
    lastRefreshAt: at,
    lastRefreshResult: result,
  });
}
