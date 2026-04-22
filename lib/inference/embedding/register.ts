/**
 * Embedding providers.
 *
 * The existing VectorDB sidecar (lib/tools/vectordb.ts, port 4242)
 * continues to handle embedding internally for /vector_search, /vector_store,
 * /vector_ingest — this adapter is strictly additive, making the embedding
 * modality available for future callers that want to compute embeddings
 * client-side (local RAG, semantic cache, query-side rewriting, etc.).
 *
 * Env vars:
 *   EMBEDDING_PROVIDER  openai | voyage | cohere | jina | google | mistral | ollama
 *                       (unset: no default slot — callers must specify explicitly)
 *   EMBEDDING_MODEL     default model id for the bound provider
 *   VOYAGE_API_KEY      required for voyage
 *   COHERE_API_KEY      required for cohere
 *   JINA_API_KEY        required for jina
 *   MISTRAL_API_KEY     required for mistral
 *   OPENAI_API_KEY / GOOGLE_API_KEY / OLLAMA_BASE_URL  reused from other slots
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
    name: "OpenAI",
    description: "text-embedding-3-small (1536 dims), text-embedding-3-large (3072 dims)",
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
  },
  {
    id: "voyage",
    name: "Voyage AI",
    description: "voyage-3 / voyage-3-large — retrieval-focused, strong on code + long context",
    requiresApiKey: true,
    defaultBaseURL: "https://api.voyageai.com/v1",
    defaultModels: ["voyage-3", "voyage-3-large", "voyage-code-3", "voyage-multilingual-2"],
  },
  {
    id: "cohere",
    name: "Cohere",
    description: "embed-english-v3.0 / embed-multilingual-v3.0 — strong on classification tasks",
    requiresApiKey: true,
    defaultBaseURL: "https://api.cohere.com/v1",
    defaultModels: ["embed-english-v3.0", "embed-multilingual-v3.0", "embed-english-light-v3.0"],
  },
  {
    id: "jina",
    name: "Jina AI",
    description: "jina-embeddings-v3 — multilingual, supports 8192 tokens",
    requiresApiKey: true,
    defaultBaseURL: "https://api.jina.ai/v1",
    defaultModels: ["jina-embeddings-v3", "jina-embeddings-v2-base-en"],
  },
  {
    id: "google",
    name: "Google Gemini",
    description: "text-embedding-004 — supports task-type conditioning",
    requiresApiKey: true,
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    defaultModels: ["text-embedding-004", "embedding-001"],
  },
  {
    id: "mistral",
    name: "Mistral",
    description: "mistral-embed (1024 dims) — efficient, European data residency",
    requiresApiKey: true,
    defaultBaseURL: "https://api.mistral.ai/v1",
    defaultModels: ["mistral-embed"],
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Local embeddings: nomic-embed-text, mxbai-embed-large, snowflake-arctic-embed",
    requiresApiKey: false,
    defaultBaseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    defaultModels: ["nomic-embed-text", "mxbai-embed-large", "snowflake-arctic-embed", "all-minilm"],
  },
];

let registered = false;

export function registerEmbeddingProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "embedding");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), embedding: seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  // Bind the embedding slot only when the user opts in explicitly — the
  // VectorDB sidecar keeps handling RAG internally unless someone wants
  // client-side embeddings.
  const providerEnv = (process.env.EMBEDDING_PROVIDER ?? "").toLowerCase();
  if (providerEnv && SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "embedding",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.EMBEDDING_MODEL,
        baseURL: providerEnv === "ollama" ? process.env.OLLAMA_BASE_URL : undefined,
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
