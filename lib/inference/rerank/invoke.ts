/**
 * Per-provider rerank invocation.
 *
 * Scope: cloud cross-encoder APIs (Cohere, Jina, Voyage) + a generic path
 * for self-hosted BGE-reranker / Jina-reranker endpoints that speak a
 * Cohere-compatible shape. VectorDB's internal reranker stays on its
 * current path; this adapter becomes available for future RAG code.
 */

import type { InferenceProviderConfig } from "../types";
import type { RerankArgs, RerankResult, RerankScore } from "./types";

const COHERE_BASE = "https://api.cohere.com/v1";
const JINA_BASE = "https://api.jina.ai/v1";
const VOYAGE_BASE = "https://api.voyageai.com/v1";

export async function invokeRerank(
  providerId: string,
  config: InferenceProviderConfig,
  args: RerankArgs,
): Promise<RerankResult> {
  switch (providerId) {
    case "cohere":
      return invokeCohere(config, args);
    case "jina":
      return invokeJina(config, args);
    case "voyage":
      return invokeVoyage(config, args);
    case "bge":
      return invokeBgeCompatible(config, args);
    default:
      throw new Error(`rerank provider not supported: ${providerId}`);
  }
}

/** Cohere /v1/rerank — the reference cross-encoder API. */
async function invokeCohere(
  config: InferenceProviderConfig,
  args: RerankArgs,
): Promise<RerankResult> {
  const apiKey = config.apiKey ?? process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error("cohere: COHERE_API_KEY not set");
  const model = args.model ?? config.model ?? "rerank-v3.5";
  const res = await fetch(`${COHERE_BASE}/rerank`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      query: args.query,
      documents: args.documents.map((d) => d.text),
      top_n: args.topK,
      return_documents: false,
    }),
  });
  if (!res.ok) throw new Error(`cohere-rerank ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    results?: Array<{ index: number; relevance_score: number }>;
  };
  const scores: RerankScore[] = (data.results ?? []).map((r, rank) => ({
    id: args.documents[r.index]?.id ?? String(r.index),
    score: r.relevance_score,
    rank,
    text: args.documents[r.index]?.text,
  }));
  return { results: scores, model, providerId: "cohere" };
}

/** Jina /v1/rerank — same body shape as Cohere. */
async function invokeJina(
  config: InferenceProviderConfig,
  args: RerankArgs,
): Promise<RerankResult> {
  const apiKey = config.apiKey ?? process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("jina: JINA_API_KEY not set");
  const model = args.model ?? config.model ?? "jina-reranker-v2-base-multilingual";
  const res = await fetch(`${JINA_BASE}/rerank`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      query: args.query,
      documents: args.documents.map((d) => d.text),
      top_n: args.topK,
    }),
  });
  if (!res.ok) throw new Error(`jina-rerank ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    results?: Array<{ index: number; relevance_score: number }>;
  };
  const scores: RerankScore[] = (data.results ?? []).map((r, rank) => ({
    id: args.documents[r.index]?.id ?? String(r.index),
    score: r.relevance_score,
    rank,
    text: args.documents[r.index]?.text,
  }));
  return { results: scores, model, providerId: "jina" };
}

/** Voyage /v1/rerank — shape matches Cohere closely. */
async function invokeVoyage(
  config: InferenceProviderConfig,
  args: RerankArgs,
): Promise<RerankResult> {
  const apiKey = config.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("voyage: VOYAGE_API_KEY not set");
  const model = args.model ?? config.model ?? "rerank-2";
  const res = await fetch(`${VOYAGE_BASE}/rerank`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      query: args.query,
      documents: args.documents.map((d) => d.text),
      top_k: args.topK,
    }),
  });
  if (!res.ok) throw new Error(`voyage-rerank ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{ index: number; relevance_score: number }>;
  };
  const scores: RerankScore[] = (data.data ?? []).map((r, rank) => ({
    id: args.documents[r.index]?.id ?? String(r.index),
    score: r.relevance_score,
    rank,
    text: args.documents[r.index]?.text,
  }));
  return { results: scores, model, providerId: "voyage" };
}

/** BGE / self-hosted reranker — assumes a Cohere-shaped endpoint at config.baseURL/rerank. */
async function invokeBgeCompatible(
  config: InferenceProviderConfig,
  args: RerankArgs,
): Promise<RerankResult> {
  const base = config.baseURL;
  if (!base) throw new Error("bge: baseURL required in config (self-hosted endpoint)");
  const model = args.model ?? config.model ?? "BAAI/bge-reranker-v2-m3";
  const apiKey = config.apiKey;
  const res = await fetch(`${base.replace(/\/$/, "")}/rerank`, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      query: args.query,
      documents: args.documents.map((d) => d.text),
      top_n: args.topK,
    }),
  });
  if (!res.ok) throw new Error(`bge-rerank ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    results?: Array<{ index: number; relevance_score?: number; score?: number }>;
  };
  const scores: RerankScore[] = (data.results ?? []).map((r, rank) => ({
    id: args.documents[r.index]?.id ?? String(r.index),
    score: r.relevance_score ?? r.score ?? 0,
    rank,
    text: args.documents[r.index]?.text,
  }));
  return { results: scores, model, providerId: "bge" };
}
