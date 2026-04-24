import { NextResponse } from "next/server";

import {
  ensureBootstrap,
  getProvider,
  getSlot,
  listProvidersForModality,
} from "@/lib/inference/bootstrap";
import { listTtsVoices } from "@/lib/inference/tts/invoke";
import { ASSISTANT_DEFAULTS, listStudioEngines } from "@/lib/voice/providers";

export const runtime = "nodejs";

export async function GET() {
  ensureBootstrap();

  const sttProviders = listProvidersForModality("stt").map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    requiresApiKey: provider.requiresApiKey,
    defaultModels: provider.defaultModels.stt ?? [],
  }));

  const ttsProviders = listProvidersForModality("tts").map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    requiresApiKey: provider.requiresApiKey,
    defaultModels: provider.defaultModels.tts ?? [],
  }));

  const currentTts = getSlot("tts", "primary");
  const currentStt = getSlot("stt", "primary");

  let currentTtsVoices: Array<{ id: string; name?: string; providerId: string; previewUrl?: string; tags?: string[] }> = [];
  if (currentTts) {
    try {
      currentTtsVoices = await listTtsVoices(currentTts.providerId, currentTts.config);
    } catch {
      currentTtsVoices = [];
    }
  }

  return NextResponse.json({
    assistantDefaults: ASSISTANT_DEFAULTS,
    studioEngines: listStudioEngines(),
    sttProviders,
    ttsProviders,
    current: {
      stt: currentStt
        ? {
            providerId: currentStt.providerId,
            providerName: getProvider(currentStt.providerId)?.name ?? currentStt.providerId,
            model: currentStt.config.model ?? null,
          }
        : null,
      tts: currentTts
        ? {
            providerId: currentTts.providerId,
            providerName: getProvider(currentTts.providerId)?.name ?? currentTts.providerId,
            model: currentTts.config.model ?? null,
            engine: (currentTts.config.extras?.engine as string | undefined) ?? null,
          }
        : null,
      voices: currentTtsVoices,
    },
  });
}
