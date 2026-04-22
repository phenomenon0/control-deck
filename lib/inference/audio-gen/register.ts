/**
 * Audio-generation providers (music + SFX). ComfyUI Stable Audio / ACE Step
 * workflows stay on the existing lib/tools/executor.ts path; this adapter
 * activates only when AUDIO_GEN_PROVIDER is set.
 *
 * Env vars:
 *   AUDIO_GEN_PROVIDER    elevenlabs | replicate | fal
 *   AUDIO_GEN_MODEL       default model id / Replicate version hash
 *   ELEVENLABS_API_KEY / REPLICATE_API_TOKEN / FAL_API_KEY
 */

import { registerProvider, getProvider } from "../registry";
import { bindSlot } from "../runtime";
import type { InferenceProvider, Modality } from "../types";

interface ProviderSeed {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseURL?: string;
  defaultModels: string[];
}

const SEEDS: ProviderSeed[] = [
  {
    id: "elevenlabs",
    name: "ElevenLabs Sound Effects",
    description: "text-to-sfx via /v1/sound-generation — short ambient / foley clips",
    requiresApiKey: true,
    defaultBaseURL: "https://api.elevenlabs.io/v1",
    defaultModels: ["sound-generation"],
  },
  {
    id: "replicate",
    name: "Replicate (audio)",
    description: "MusicGen, Stable Audio Open, audiogen-medium via version hashes",
    requiresApiKey: true,
    defaultBaseURL: "https://api.replicate.com/v1",
    defaultModels: [],
  },
  {
    id: "fal",
    name: "fal.ai (audio)",
    description: "Stable Audio, MusicGen, AudioCraft — low-latency fan-out",
    requiresApiKey: true,
    defaultBaseURL: "https://fal.run",
    defaultModels: ["fal-ai/stable-audio", "fal-ai/musicgen", "fal-ai/audiocraft"],
  },
];

let registered = false;

export function registerAudioGenProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "audio-gen");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), "audio-gen": seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  const providerEnv = (process.env.AUDIO_GEN_PROVIDER ?? "").toLowerCase();
  if (providerEnv && SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "audio-gen",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.AUDIO_GEN_MODEL,
      },
    });
  }
}

function mergeModalities(
  prior: Modality[] | undefined,
  adding: Modality,
): Modality[] {
  const set = new Set<Modality>(prior ?? []);
  set.add(adding);
  return [...set];
}
