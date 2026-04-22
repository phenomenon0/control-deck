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

  if (modalityParam) {
    if (!(modalityParam in MODALITIES)) {
      return NextResponse.json({ error: `unknown modality: ${modalityParam}` }, { status: 400 });
    }
    const modality = modalityParam as Modality;
    const profile = getSystemProfile();
    const installed = await getInstalledOllamaModels();
    const suggestions = suggestForModality(profile, installed, modality, limit);
    return NextResponse.json({ modality, suggestions, profile });
  }

  // No modality filter → return top-3 per modality as a bundle. Useful for
  // the "System" tab's cross-modality overview.
  const profile = getSystemProfile();
  const installed = await getInstalledOllamaModels();
  const byModality: Record<string, ReturnType<typeof suggestForModality>> = {};
  for (const meta of Object.values(MODALITIES)) {
    byModality[meta.id] = suggestForModality(profile, installed, meta.id, 3);
  }
  return NextResponse.json({ suggestions: byModality, profile });
}
