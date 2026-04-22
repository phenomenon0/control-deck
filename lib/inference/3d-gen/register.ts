/**
 * 3D-generation providers. ComfyUI Hunyuan 3D v2.1 workflow at
 * lib/tools/executor.ts:executeImageTo3D keeps its existing path; this
 * adapter activates when THREE_D_GEN_PROVIDER is set.
 *
 * Env vars:
 *   THREE_D_GEN_PROVIDER   meshy | luma | tripo | replicate
 *   THREE_D_GEN_MODEL      default model id / Replicate version hash
 *   MESHY_API_KEY / LUMA_API_KEY / TRIPO_API_KEY / REPLICATE_API_TOKEN
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
    id: "meshy",
    name: "Meshy",
    description: "Text-to-3D + image-to-3D; GLB output, thumbnail previews",
    requiresApiKey: true,
    defaultBaseURL: "https://api.meshy.ai/v2",
    defaultModels: ["meshy-4"],
  },
  {
    id: "luma",
    name: "Luma Genie",
    description: "Fast text-to-3D — Luma's 3D companion to Dream Machine",
    requiresApiKey: true,
    defaultBaseURL: "https://api.lumalabs.ai/dream-machine/v1",
    defaultModels: ["genie-1"],
  },
  {
    id: "tripo",
    name: "Tripo3D",
    description: "Text-to-mesh + image-to-mesh with high topology quality",
    requiresApiKey: true,
    defaultBaseURL: "https://api.tripo3d.ai/v2/openapi",
    defaultModels: ["v2.5", "v2.0"],
  },
  {
    id: "replicate",
    name: "Replicate (3D)",
    description: "TripoSR, InstantMesh, Hunyuan3D, StableFast3D via version hashes",
    requiresApiKey: true,
    defaultBaseURL: "https://api.replicate.com/v1",
    defaultModels: [],
  },
];

let registered = false;

export function register3dGenProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "3d-gen");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), "3d-gen": seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  const providerEnv = (process.env.THREE_D_GEN_PROVIDER ?? "").toLowerCase();
  if (providerEnv && SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "3d-gen",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.THREE_D_GEN_MODEL,
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
