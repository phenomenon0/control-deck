import { NextResponse } from "next/server";

import { getSystemProfile } from "@/lib/system/profile";
import { getInstalledOllamaModels } from "@/lib/system/detect";
import { suggestForModality } from "@/lib/inference/local-suggestions";
import { MODALITIES } from "@/lib/inference/types";
import type { Modality } from "@/lib/inference/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const modalityParam = url.searchParams.get("modality");
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "8", 10);
  const filter = url.searchParams.get("filter") ?? "runnable";
  const includeOversized = filter === "all" || filter === "local-sota";

  if (url.searchParams.get("refresh") === "1") {
    const { __clearLiveCache } = await import("@/lib/inference/live-candidates");
    __clearLiveCache();
  }

  if (modalityParam) {
    if (!(modalityParam in MODALITIES)) {
      return NextResponse.json({ error: `unknown modality: ${modalityParam}` }, { status: 400 });
    }
    const modality = modalityParam as Modality;
    const profile = getSystemProfile();
    const installed = await getInstalledOllamaModels();
    const suggestions = await suggestForModality(profile, installed, modality, limit, {
      includeOversized,
    });
    return NextResponse.json({ modality, suggestions, profile });
  }

  // No modality filter → return top-3 per modality as a bundle. Useful for
  // the "System" tab's cross-modality overview.
  const profile = getSystemProfile();
  const installed = await getInstalledOllamaModels();
  const entries = await Promise.all(
    Object.values(MODALITIES).map(async (meta) =>
      [
        meta.id,
        await suggestForModality(profile, installed, meta.id, 3, { includeOversized }),
      ] as const,
    ),
  );
  const byModality = Object.fromEntries(entries);
  return NextResponse.json({ suggestions: byModality, profile });
}
