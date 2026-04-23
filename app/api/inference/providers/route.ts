import { NextResponse } from "next/server";

import { ensureBootstrap, listProvidersForModality, MODALITIES } from "@/lib/inference/bootstrap";
import type { Modality } from "@/lib/inference/types";

export async function GET(req: Request) {
  ensureBootstrap();
  const url = new URL(req.url);
  const modalityParam = url.searchParams.get("modality");

  if (modalityParam) {
    if (!(modalityParam in MODALITIES)) {
      return NextResponse.json({ error: `unknown modality: ${modalityParam}` }, { status: 400 });
    }
    const modality = modalityParam as Modality;
    const providers = listProvidersForModality(modality).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      requiresApiKey: p.requiresApiKey,
      defaultBaseURL: p.defaultBaseURL,
      defaultModels: p.defaultModels[modality] ?? [],
    }));
    return NextResponse.json({ modality, providers });
  }

  // No modality filter — return everything the UI needs to render all tabs.
  const byModality: Record<string, Array<{
    id: string;
    name: string;
    description: string;
    requiresApiKey: boolean;
    defaultBaseURL?: string;
    defaultModels: string[];
  }>> = {};
  for (const meta of Object.values(MODALITIES)) {
    byModality[meta.id] = listProvidersForModality(meta.id).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      requiresApiKey: p.requiresApiKey,
      defaultBaseURL: p.defaultBaseURL,
      defaultModels: p.defaultModels[meta.id] ?? [],
    }));
  }
  return NextResponse.json({
    modalities: Object.values(MODALITIES),
    providers: byModality,
  });
}
