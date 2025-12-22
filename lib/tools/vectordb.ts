/**
 * VectorDB Tool - Semantic memory for control-deck
 * Connects to local VectorDB server on port 4242
 */

const VECTORDB_URL = process.env.VECTORDB_URL || "http://localhost:4242";

export interface VectorDBSearchResult {
  id: string;
  text: string;
  score: number;
  collection?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorDBInsertResult {
  id: string;
  success: boolean;
}

export interface VectorDBHealth {
  ok: boolean;
  total: number;
  mode: {
    mode: string;
    dimension: number;
    embedder_type: string;
    embedder_model: string;
  };
}

/**
 * Search for semantically similar documents
 */
export async function vectorSearch(
  query: string,
  options: {
    collection?: string;
    k?: number;
  } = {}
): Promise<VectorDBSearchResult[]> {
  const { collection, k = 5 } = options;

  const body: Record<string, unknown> = { query, top_k: k };
  if (collection) body.collection = collection;

  const res = await fetch(`${VECTORDB_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`VectorDB search failed: ${res.statusText}`);
  }

  const data = await res.json();

  // Transform response to unified format
  const results: VectorDBSearchResult[] = [];
  const docs = data.docs || data.results || [];
  const ids = data.ids || [];
  const scores = data.scores || [];

  for (let i = 0; i < docs.length; i++) {
    results.push({
      id: ids[i] || `result-${i}`,
      text: typeof docs[i] === "string" ? docs[i] : docs[i]?.doc || docs[i]?.text || "",
      score: scores[i] || 0,
      collection: data.collection,
    });
  }

  return results;
}

/**
 * Store a document in the vector database
 */
export async function vectorStore(
  text: string,
  options: {
    collection?: string;
    metadata?: Record<string, string>;
  } = {}
): Promise<VectorDBInsertResult> {
  const { collection = "default", metadata } = options;

  const body: Record<string, unknown> = {
    doc: text,
    collection,
  };
  if (metadata) body.meta = metadata;

  const res = await fetch(`${VECTORDB_URL}/insert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`VectorDB insert failed: ${res.statusText}`);
  }

  const data = await res.json();

  return {
    id: data.id || "unknown",
    success: true,
  };
}

/**
 * Store multiple documents in batch
 */
export async function vectorStoreBatch(
  documents: Array<{ text: string; metadata?: Record<string, string> }>,
  collection: string = "default"
): Promise<{ inserted: number; ids: string[] }> {
  const docs = documents.map((d) => ({
    doc: d.text,
    meta: d.metadata || {},
  }));

  const res = await fetch(`${VECTORDB_URL}/batch_insert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docs, collection }),
  });

  if (!res.ok) {
    throw new Error(`VectorDB batch insert failed: ${res.statusText}`);
  }

  const data = await res.json();

  return {
    inserted: data.inserted || documents.length,
    ids: data.ids || [],
  };
}

/**
 * Get VectorDB health and stats
 */
export async function vectorHealth(): Promise<VectorDBHealth> {
  const res = await fetch(`${VECTORDB_URL}/health`);

  if (!res.ok) {
    throw new Error(`VectorDB health check failed: ${res.statusText}`);
  }

  return res.json();
}

/**
 * List all collections
 */
export async function vectorCollections(): Promise<
  Array<{ name: string; count: number }>
> {
  // Try v2 endpoint first
  let res = await fetch(`${VECTORDB_URL}/v2/collections`);

  if (res.ok) {
    const data = await res.json();
    return (data.collections || []).map(
      (c: { name: string; vector_count?: number }) => ({
        name: c.name,
        count: c.vector_count || 0,
      })
    );
  }

  // Fallback to legacy endpoint
  res = await fetch(`${VECTORDB_URL}/collections`);
  if (res.ok) {
    const data = await res.json();
    return Object.entries(data.collections || {}).map(([name, count]) => ({
      name,
      count: count as number,
    }));
  }

  return [];
}

/**
 * Delete a document by ID
 */
export async function vectorDelete(
  id: string,
  collection?: string
): Promise<{ success: boolean }> {
  const body: Record<string, unknown> = { id };
  if (collection) body.collection = collection;

  const res = await fetch(`${VECTORDB_URL}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return { success: res.ok };
}
