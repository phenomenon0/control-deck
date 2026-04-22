/**
 * Rerank invocation surface. Given a query and a set of candidate
 * documents, a cross-encoder returns relevance-sorted scores — used to
 * rescore retrieval results from the embedding slot before returning to
 * the LLM.
 */

export interface RerankDocument {
  /** Free-form id — returned back in results so callers can join against their original data. */
  id: string;
  text: string;
}

export interface RerankArgs {
  query: string;
  documents: RerankDocument[];
  /** Per-call model override — else the slot's default model is used. */
  model?: string;
  /** Cap the result count. Most providers default to returning all candidates. */
  topK?: number;
}

export interface RerankScore {
  id: string;
  /** Relevance score in [0, 1] for Cohere/Jina; raw logits for BGE (provider-dependent range). */
  score: number;
  /** Zero-based rank from the provider's sort. */
  rank: number;
  /** Echo of the original text; useful for UIs that want to highlight. */
  text?: string;
}

export interface RerankResult {
  results: RerankScore[];
  model: string;
  providerId: string;
}
