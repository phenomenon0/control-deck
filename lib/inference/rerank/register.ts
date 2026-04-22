/**
 * Rerank (cross-encoder) providers. Additive; doesn't change the VectorDB
 * sidecar's internal reranker path.
 *
 * Env vars:
 *   RERANK_PROVIDER  cohere | jina | voyage | bge
 *   RERANK_MODEL     default model id
 *   RERANK_BASE_URL  required for bge (self-hosted cross-encoder endpoint)
 *   COHERE_API_KEY / JINA_API_KEY / VOYAGE_API_KEY reused from embedding slot
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
    id: "cohere",
    name: "Cohere",
    description: "rerank-v3.5 — industry reference cross-encoder, 100 langs",
    requiresApiKey: true,
    defaultBaseURL: "https://api.cohere.com/v1",
    defaultModels: ["rerank-v3.5", "rerank-english-v3.0", "rerank-multilingual-v3.0"],
  },
  {
    id: "jina",
    name: "Jina AI",
    description: "jina-reranker-v2 — multilingual, self-hostable open weights",
    requiresApiKey: true,
    defaultBaseURL: "https://api.jina.ai/v1",
    defaultModels: ["jina-reranker-v2-base-multilingual", "jina-reranker-v1-turbo-en"],
  },
  {
    id: "voyage",
    name: "Voyage AI",
    description: "rerank-2 — strong on long-context retrieval tasks",
    requiresApiKey: true,
    defaultBaseURL: "https://api.voyageai.com/v1",
    defaultModels: ["rerank-2", "rerank-lite-1"],
  },
  {
    id: "bge",
    name: "BGE (self-hosted)",
    description: "BAAI/bge-reranker-v2 and compatible Cohere-shaped endpoints",
    requiresApiKey: false,
    defaultModels: ["BAAI/bge-reranker-v2-m3", "BAAI/bge-reranker-large"],
  },
];

let registered = false;

export function registerRerankProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "rerank");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), rerank: seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  const providerEnv = (process.env.RERANK_PROVIDER ?? "").toLowerCase();
  if (providerEnv && SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "rerank",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.RERANK_MODEL,
        baseURL: providerEnv === "bge" ? process.env.RERANK_BASE_URL : undefined,
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
