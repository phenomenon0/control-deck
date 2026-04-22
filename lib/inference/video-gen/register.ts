/**
 * Video-generation providers. Greenfield modality — Control Deck has no
 * existing video pipeline, so this adapter is the full path. No fallback
 * needed; the modality is simply unavailable until VIDEO_GEN_PROVIDER is
 * set + a key is in scope.
 *
 * Env vars:
 *   VIDEO_GEN_PROVIDER  runway | luma | pika | replicate | fal
 *   VIDEO_GEN_MODEL     default model id / Replicate version hash
 *   RUNWAY_API_KEY / LUMA_API_KEY / PIKA_API_KEY / REPLICATE_API_TOKEN /
 *   FAL_API_KEY
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
    id: "runway",
    name: "Runway",
    description: "Gen-3 Alpha / Turbo — premium image-to-video + text-to-video",
    requiresApiKey: true,
    defaultBaseURL: "https://api.dev.runwayml.com/v1",
    defaultModels: ["gen3a_turbo", "gen3a"],
  },
  {
    id: "luma",
    name: "Luma Dream Machine",
    description: "Ray 2 — strong at image-to-video with keyframes",
    requiresApiKey: true,
    defaultBaseURL: "https://api.lumalabs.ai/dream-machine/v1",
    defaultModels: ["ray-2", "ray-1-6"],
  },
  {
    id: "pika",
    name: "Pika",
    description: "Pika 2.0 — lower cost, effects catalog",
    requiresApiKey: true,
    defaultBaseURL: "https://api.pika.art/v1",
    defaultModels: ["pika-2.0", "pika-1.5"],
  },
  {
    id: "replicate",
    name: "Replicate (video)",
    description: "HunyuanVideo, CogVideoX, LTXV, Wan2.x via version hashes",
    requiresApiKey: true,
    defaultBaseURL: "https://api.replicate.com/v1",
    defaultModels: [],
  },
  {
    id: "fal",
    name: "fal.ai (video)",
    description: "LTX-Video, HunyuanVideo, AnimateDiff — low-latency fan-out",
    requiresApiKey: true,
    defaultBaseURL: "https://fal.run",
    defaultModels: [
      "fal-ai/ltx-video",
      "fal-ai/hunyuan-video",
      "fal-ai/animatediff-sparsectrl-lcm",
    ],
  },
];

let registered = false;

export function registerVideoGenProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "video-gen");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), "video-gen": seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  const providerEnv = (process.env.VIDEO_GEN_PROVIDER ?? "").toLowerCase();
  if (providerEnv && SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "video-gen",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.VIDEO_GEN_MODEL,
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
