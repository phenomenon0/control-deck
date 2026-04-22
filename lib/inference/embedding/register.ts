/**
 * Embedding providers.
 *
 * Today: embeddings happen inside the external VectorDB service (port 4242)
 * which self-reports the embedder model via /health (see lib/tools/vectordb.ts
 * VectorDBHealth type). Control Deck has no slot-level control over the
 * embedding model — whatever the VectorDB sidecar was configured with is
 * what gets used.
 *
 * Planned registrations:
 *   vectordb-internal — wraps lib/tools/vectordb.ts; config.extras carries
 *                       embedder_model advertised via /health
 *   openai            — text-embedding-3-small / text-embedding-3-large
 *   voyage            — voyage-3, voyage-large-2; high quality
 *   cohere            — embed-english-v3, embed-multilingual-v3
 *   jina              — jina-embeddings-v3; open-weight option
 *   ollama            — mxbai-embed-large, nomic-embed-text, etc.
 */

export function registerEmbeddingProviders(): void {
  // no-op for step 1
}
