/**
 * Per-provider embedding invocation.
 *
 * Scope: cloud providers + local Ollama. The existing VectorDB sidecar at
 * lib/tools/vectordb.ts computes embeddings internally — this adapter is
 * additive and becomes available for future callers (client-side RAG,
 * semantic cache, etc.) without disturbing the sidecar flow.
 */

import type { InferenceProviderConfig } from "../types";
import type { EmbeddingArgs, EmbeddingResult } from "./types";

const OPENAI_BASE = "https://api.openai.com/v1";
const VOYAGE_BASE = "https://api.voyageai.com/v1";
const COHERE_BASE = "https://api.cohere.com/v1";
const JINA_BASE = "https://api.jina.ai/v1";
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MISTRAL_BASE = "https://api.mistral.ai/v1";
const OLLAMA_DEFAULT = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export async function invokeEmbedding(
  providerId: string,
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  switch (providerId) {
    case "openai":
      return invokeOpenAi(config, args);
    case "voyage":
      return invokeVoyage(config, args);
    case "cohere":
      return invokeCohere(config, args);
    case "jina":
      return invokeJina(config, args);
    case "google":
      return invokeGoogle(config, args);
    case "mistral":
      return invokeMistral(config, args);
    case "ollama":
      return invokeOllama(config, args);
    default:
      throw new Error(`embedding provider not supported: ${providerId}`);
  }
}

function asArray(input: string | string[]): string[] {
  return Array.isArray(input) ? input : [input];
}

/** OpenAI — /v1/embeddings, supports text-embedding-3-small/large + ada-002. */
async function invokeOpenAi(
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai: OPENAI_API_KEY not set");
  const model = args.model ?? config.model ?? "text-embedding-3-small";
  const res = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: args.input }),
  });
  if (!res.ok) throw new Error(`openai-embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  const vectors = (data.data ?? []).map((d) => d.embedding);
  return makeResult(vectors, model, "openai", data.usage?.total_tokens);
}

/** Voyage — OpenAI-compatible shape at /v1/embeddings, richer task-type support. */
async function invokeVoyage(
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("voyage: VOYAGE_API_KEY not set");
  const model = args.model ?? config.model ?? "voyage-3";
  const body: Record<string, unknown> = { model, input: asArray(args.input) };
  if (args.taskType) {
    body.input_type = args.taskType === "search_query" ? "query" : "document";
  }
  const res = await fetch(`${VOYAGE_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  const vectors = (data.data ?? []).map((d) => d.embedding);
  return makeResult(vectors, model, "voyage", data.usage?.total_tokens);
}

/** Cohere — /v1/embed, different shape; supports multilingual + binary embeddings. */
async function invokeCohere(
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey ?? process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error("cohere: COHERE_API_KEY not set");
  const model = args.model ?? config.model ?? "embed-english-v3.0";
  const inputType =
    args.taskType === "search_query"
      ? "search_query"
      : args.taskType === "classification"
        ? "classification"
        : args.taskType === "clustering"
          ? "clustering"
          : "search_document";
  const res = await fetch(`${COHERE_BASE}/embed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      texts: asArray(args.input),
      input_type: inputType,
      truncate: args.truncate ? "END" : "NONE",
    }),
  });
  if (!res.ok) throw new Error(`cohere-embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    embeddings?: number[][];
    meta?: { billed_units?: { input_tokens?: number } };
  };
  return makeResult(data.embeddings ?? [], model, "cohere", data.meta?.billed_units?.input_tokens);
}

/** Jina — OpenAI-compatible at /v1/embeddings. */
async function invokeJina(
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey ?? process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("jina: JINA_API_KEY not set");
  const model = args.model ?? config.model ?? "jina-embeddings-v3";
  const body: Record<string, unknown> = { model, input: asArray(args.input) };
  if (args.taskType === "search_query") body.task = "retrieval.query";
  else if (args.taskType === "search_document") body.task = "retrieval.passage";
  const res = await fetch(`${JINA_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`jina ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  const vectors = (data.data ?? []).map((d) => d.embedding);
  return makeResult(vectors, model, "jina", data.usage?.total_tokens);
}

/** Google Gemini — /v1beta/models/{model}:embedContent or batchEmbedContents. */
async function invokeGoogle(
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("google: GOOGLE_API_KEY not set");
  const model = args.model ?? config.model ?? "text-embedding-004";
  const inputs = asArray(args.input);
  const taskType =
    args.taskType === "search_query"
      ? "RETRIEVAL_QUERY"
      : args.taskType === "search_document"
        ? "RETRIEVAL_DOCUMENT"
        : args.taskType === "classification"
          ? "CLASSIFICATION"
          : args.taskType === "clustering"
            ? "CLUSTERING"
            : undefined;
  // Use batchEmbedContents even for a single input — uniform shape, one fetch.
  const url = `${GOOGLE_BASE}/models/${encodeURIComponent(model)}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: inputs.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        ...(taskType ? { taskType } : {}),
      })),
    }),
  });
  if (!res.ok) throw new Error(`google-embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    embeddings?: Array<{ values: number[] }>;
  };
  const vectors = (data.embeddings ?? []).map((e) => e.values);
  return makeResult(vectors, model, "google");
}

/** Mistral — OpenAI-compatible at /v1/embeddings, mistral-embed (1024 dims). */
async function invokeMistral(
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("mistral: MISTRAL_API_KEY not set");
  const model = args.model ?? config.model ?? "mistral-embed";
  const res = await fetch(`${MISTRAL_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: asArray(args.input) }),
  });
  if (!res.ok) throw new Error(`mistral-embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  const vectors = (data.data ?? []).map((d) => d.embedding);
  return makeResult(vectors, model, "mistral", data.usage?.total_tokens);
}

/** Ollama — /api/embeddings, one request per input (no native batching). */
async function invokeOllama(
  config: InferenceProviderConfig,
  args: EmbeddingArgs,
): Promise<EmbeddingResult> {
  const base = config.baseURL ?? OLLAMA_DEFAULT;
  const model = args.model ?? config.model ?? "nomic-embed-text";
  const inputs = asArray(args.input);
  const vectors: number[][] = [];
  for (const prompt of inputs) {
    const res = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt }),
    });
    if (!res.ok) throw new Error(`ollama-embed ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { embedding?: number[] };
    if (!data.embedding) throw new Error("ollama-embed: no embedding in response");
    vectors.push(data.embedding);
  }
  return makeResult(vectors, model, "ollama");
}

function makeResult(
  vectors: number[][],
  model: string,
  providerId: string,
  tokens?: number,
): EmbeddingResult {
  return {
    vectors,
    dimensions: vectors[0]?.length ?? 0,
    model,
    providerId,
    tokens,
  };
}
