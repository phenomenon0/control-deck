/**
 * Image-generation providers.
 *
 * Scope: cloud providers. ComfyUI + Lite ONNX remain on their existing
 * pipelines in lib/tools/executor.ts (workflow-driven, artifact-registered).
 * When IMAGE_GEN_PROVIDER is set to one of the providers registered here,
 * the executor routes through invokeImageGen() instead of the ComfyUI path.
 *
 * Env vars:
 *   IMAGE_GEN_PROVIDER  openai | replicate | fal | stability | bfl
 *                       (unset: keep existing ComfyUI / Lite routing)
 *   IMAGE_GEN_MODEL     default model id for the bound provider
 *   OPENAI_API_KEY      reused, required for openai
 *   REPLICATE_API_TOKEN required for replicate
 *   FAL_API_KEY         required for fal
 *   STABILITY_API_KEY   required for stability
 *   BFL_API_KEY         required for bfl
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
    id: "openai",
    name: "OpenAI DALL-E",
    description: "DALL-E 3 — text-to-image up to 1792×1024",
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: ["dall-e-3", "dall-e-2"],
  },
  {
    id: "replicate",
    name: "Replicate",
    description: "Aggregator — 50+ image models via one key (FLUX, SDXL, Stable Cascade, Playground, etc.)",
    requiresApiKey: true,
    defaultBaseURL: "https://api.replicate.com/v1",
    // Replicate uses version hashes, not friendly ids — leave blank, force user to specify.
    defaultModels: [],
  },
  {
    id: "fal",
    name: "fal.ai",
    description: "Fast inference aggregator — FLUX Schnell, Pro, Dev; SDXL; AuraFlow; Playground",
    requiresApiKey: true,
    defaultBaseURL: "https://fal.run",
    defaultModels: [
      "fal-ai/flux/schnell",
      "fal-ai/flux/dev",
      "fal-ai/flux-pro",
      "fal-ai/stable-diffusion-xl",
    ],
  },
  {
    id: "stability",
    name: "Stability AI",
    description: "SD 3 / SD 3 Ultra / SD 3 Medium — direct API",
    requiresApiKey: true,
    defaultBaseURL: "https://api.stability.ai",
    defaultModels: ["sd3-large", "sd3-medium", "sd3-ultra"],
  },
  {
    id: "bfl",
    name: "Black Forest Labs",
    description: "FLUX.1 Pro / Ultra / Dev — direct API from the FLUX team",
    requiresApiKey: true,
    defaultBaseURL: "https://api.bfl.ml/v1",
    defaultModels: ["flux-pro-1.1", "flux-pro-1.1-ultra", "flux-dev"],
  },
];

let registered = false;

export function registerImageGenProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "image-gen");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), "image-gen": seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  // Only bind the image-gen slot if the user has explicitly opted into a
  // cloud provider — otherwise the executor keeps using ComfyUI / Lite as
  // it always has. Zero-regression default.
  const providerEnv = (process.env.IMAGE_GEN_PROVIDER ?? "").toLowerCase();
  if (providerEnv && SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "image-gen",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.IMAGE_GEN_MODEL,
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
