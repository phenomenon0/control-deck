/**
 * Rerank providers (cross-encoder result rescoring).
 *
 * Today: no explicit integration in Control Deck — the VectorDB sidecar
 * handles reranking internally during hybrid search if configured (see
 * VectorDBHealth.reranker in lib/tools/vectordb.ts). Control Deck has no
 * slot-level knob.
 *
 * Planned registrations:
 *   vectordb-internal — wraps VectorDB's internal reranker, exposes its
 *                       advertised model name as read-only
 *   cohere            — rerank-v3.5; industry-standard cross-encoder API
 *   jina              — jina-reranker-v2, open-weight self-hostable
 *   bge-reranker      — BAAI/bge-reranker-v2, self-hostable local endpoint
 */

export function registerRerankProviders(): void {
  // no-op for step 1
}
