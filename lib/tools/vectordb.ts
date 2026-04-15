/**
 * VectorDB Tool - Semantic memory for control-deck
 * Connects to local VectorDB server on port 4242
 */

const VECTORDB_URL = process.env.VECTORDB_URL || "http://localhost:4242";

// Chunking configuration
const CHUNK_CONFIG = {
  /** Target chunk size in characters */
  chunkSize: 1000,
  /** Overlap between chunks to preserve context */
  chunkOverlap: 200,
  /** Minimum chunk size (don't create tiny chunks) */
  minChunkSize: 100,
} as const;

export interface VectorDBSearchResult {
  id: string;
  text: string;
  score: number;
  collection?: string;
  metadata?: Record<string, string>;
}

export interface VectorDBInsertResult {
  id: string;
  success: boolean;
}

export interface VectorDBHealth {
  ok: boolean;
  total: number;
  active: number;
  deleted: number;
  hnsw_ids: number;
  checksum: string;
  wal_bytes: number;
  wal_age_ms: number;
  index_bytes: number;
  collections: Array<{ name: string; vector_count: number }>;
  embedder: { type: string };
  reranker: { type: string };
  mode: {
    mode: string;
    dimension: number;
    embedder_type: string;
    embedder_model: string;
    is_pro?: boolean;
    is_free?: boolean;
  };
}

// Search options matching server API
export interface VectorSearchOptions {
  /** Collection to search in (default: all) */
  collection?: string;
  /** Number of results to return (default: 5) */
  k?: number;
  /** Include metadata in results (default: true) */
  includeMeta?: boolean;
  /** Search mode: "ann" (fast, approximate) or "scan" (exact) */
  mode?: "ann" | "scan";
  /** Score mode: "vector", "lexical", or "hybrid" */
  scoreMode?: "vector" | "lexical" | "hybrid";
  /** Hybrid search alpha: 0-1, higher = more vector weight (default: 0.7) */
  hybridAlpha?: number;
  /** AND filter - all must match */
  meta?: Record<string, string>;
  /** OR filter - any must match */
  metaAny?: Array<Record<string, string>>;
  /** NOT filter - exclude matches */
  metaNot?: Record<string, string>;
  /** Pagination page size */
  pageSize?: number;
  /** Pagination token from previous response */
  pageToken?: string;
}

export interface VectorSearchResponse {
  results: VectorDBSearchResult[];
  /** Pagination token for next page (if more results available) */
  next?: string;
  /** Query statistics */
  stats?: string;
}

/**
 * Search for semantically similar documents
 * Supports metadata filtering, hybrid search, and pagination
 */
export async function vectorSearch(
  query: string,
  options: VectorSearchOptions = {}
): Promise<VectorDBSearchResult[]> {
  const response = await vectorSearchFull(query, options);
  return response.results;
}

/**
 * Full search with pagination support
 */
export async function vectorSearchFull(
  query: string,
  options: VectorSearchOptions = {}
): Promise<VectorSearchResponse> {
  const {
    collection,
    k = 5,
    includeMeta = true,
    mode,
    scoreMode,
    hybridAlpha,
    meta,
    metaAny,
    metaNot,
    pageSize,
    pageToken,
  } = options;

  const body: Record<string, unknown> = {
    query,
    top_k: k,
    include_meta: includeMeta,
  };

  if (collection) body.collection = collection;
  if (mode) body.mode = mode;
  if (scoreMode) body.score_mode = scoreMode;
  if (hybridAlpha !== undefined) body.hybrid_alpha = hybridAlpha;
  if (meta) body.meta = meta;
  if (metaAny) body.meta_any = metaAny;
  if (metaNot) body.meta_not = metaNot;
  if (pageSize) body.page_size = pageSize;
  if (pageToken) body.page_token = pageToken;

  const res = await fetch(`${VECTORDB_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`VectorDB search failed (${res.status}): ${errBody}`);
  }

  const data = await res.json();

  // Transform response to unified format
  const results: VectorDBSearchResult[] = [];
  const docs = data.docs || data.results || [];
  const ids = data.ids || [];
  const scores = data.scores || [];
  const metas = data.meta || [];

  for (let i = 0; i < docs.length; i++) {
    results.push({
      id: ids[i] || `result-${i}`,
      text: typeof docs[i] === "string" ? docs[i] : docs[i]?.doc || docs[i]?.text || "",
      score: scores[i] || 0,
      collection: data.collection,
      metadata: metas[i] || undefined,
    });
  }

  return {
    results,
    next: data.next,
    stats: data.stats,
  };
}

/**
 * Store a document in the vector database
 */
export async function vectorStore(
  text: string,
  options: {
    collection?: string;
    metadata?: Record<string, string>;
    /** If true, update existing document with same ID */
    upsert?: boolean;
    /** Custom document ID (auto-generated if not provided) */
    id?: string;
  } = {}
): Promise<VectorDBInsertResult> {
  const { collection = "default", metadata, upsert, id } = options;

  const body: Record<string, unknown> = {
    doc: text,
    collection,
  };
  if (metadata) body.meta = metadata;
  if (upsert) body.upsert = true;
  if (id) body.id = id;

  const res = await fetch(`${VECTORDB_URL}/insert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`VectorDB insert failed (${res.status}): ${errBody}`);
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
  documents: Array<{ text: string; metadata?: Record<string, string>; id?: string }>,
  options: {
    collection?: string;
    upsert?: boolean;
  } = {}
): Promise<{ inserted: number; ids: string[] }> {
  const { collection = "default", upsert } = options;
  
  const docs = documents.map((d) => ({
    doc: d.text,
    meta: d.metadata || {},
    ...(d.id ? { id: d.id } : {}),
  }));

  const body: Record<string, unknown> = { docs, collection };
  if (upsert) body.upsert = true;

  const res = await fetch(`${VECTORDB_URL}/batch_insert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`VectorDB batch insert failed (${res.status}): ${errBody}`);
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
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`VectorDB health check failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

/**
 * Compact the index - removes tombstones and rebuilds HNSW
 */
export async function vectorCompact(): Promise<{ compacted: boolean; removed: number; duration_ms: number }> {
  const res = await fetch(`${VECTORDB_URL}/compact`, {
    method: "POST",
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`VectorDB compact failed (${res.status}): ${errBody}`);
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
): Promise<{ success: boolean; error?: string }> {
  const body: Record<string, unknown> = { id };
  if (collection) body.collection = collection;

  const res = await fetch(`${VECTORDB_URL}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    return { success: false, error: errBody };
  }

  return { success: true };
}

/**
 * Delete an entire collection
 */
export async function vectorDeleteCollection(
  collection: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const res = await fetch(`${VECTORDB_URL}/v2/collections/${encodeURIComponent(collection)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    return { success: false, deleted: 0, error: errBody };
  }

  const data = await res.json();
  return { success: true, deleted: data.deleted || 0 };
}

export interface ChunkOptions {
  /** Target chunk size in characters (default: 1000) */
  chunkSize?: number;
  /** Overlap between chunks (default: 200) */
  chunkOverlap?: number;
  /** Minimum chunk size (default: 100) */
  minChunkSize?: number;
}

export interface TextChunk {
  text: string;
  index: number;
  startChar: number;
  endChar: number;
}

/**
 * Split text into overlapping chunks for better semantic search
 * Uses sentence boundaries when possible
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const {
    chunkSize = CHUNK_CONFIG.chunkSize,
    chunkOverlap = CHUNK_CONFIG.chunkOverlap,
    minChunkSize = CHUNK_CONFIG.minChunkSize,
  } = options;

  // If text is small enough, return as single chunk
  if (text.length <= chunkSize) {
    return [{
      text: text.trim(),
      index: 0,
      startChar: 0,
      endChar: text.length,
    }];
  }

  const chunks: TextChunk[] = [];
  let startChar = 0;
  let chunkIndex = 0;

  while (startChar < text.length) {
    // Calculate end position
    let endChar = Math.min(startChar + chunkSize, text.length);

    // If not at end of text, try to find a good break point
    if (endChar < text.length) {
      // Look for sentence boundaries (. ! ? followed by space or newline)
      const searchStart = Math.max(startChar + minChunkSize, endChar - 200);
      const searchRegion = text.slice(searchStart, endChar);
      
      // Find last sentence boundary in search region
      const sentenceBreaks = [...searchRegion.matchAll(/[.!?]\s+/g)];
      if (sentenceBreaks.length > 0) {
        const lastBreak = sentenceBreaks[sentenceBreaks.length - 1];
        endChar = searchStart + (lastBreak.index ?? 0) + lastBreak[0].length;
      } else {
        // Fall back to paragraph break
        const paraBreak = searchRegion.lastIndexOf("\n\n");
        if (paraBreak > 0) {
          endChar = searchStart + paraBreak + 2;
        } else {
          // Fall back to any newline
          const newlineBreak = searchRegion.lastIndexOf("\n");
          if (newlineBreak > 0) {
            endChar = searchStart + newlineBreak + 1;
          } else {
            // Fall back to word boundary
            const spaceBreak = searchRegion.lastIndexOf(" ");
            if (spaceBreak > 0) {
              endChar = searchStart + spaceBreak + 1;
            }
          }
        }
      }
    }

    // Extract chunk text
    const chunkText = text.slice(startChar, endChar).trim();

    // Only add if chunk meets minimum size
    if (chunkText.length >= minChunkSize || startChar === 0) {
      chunks.push({
        text: chunkText,
        index: chunkIndex,
        startChar,
        endChar,
      });
      chunkIndex++;
    }

    // Move start position with overlap
    const nextStart = endChar - chunkOverlap;
    if (nextStart <= startChar) {
      // Prevent infinite loop
      startChar = endChar;
    } else {
      startChar = nextStart;
    }

    // If we're near the end and remaining text is small, break
    if (text.length - startChar < minChunkSize) {
      break;
    }
  }

  return chunks;
}

export interface IngestUrlResult {
  success: boolean;
  url: string;
  chunks: number;
  ids: string[];
  collection: string;
  error?: string;
}

/**
 * Fetch content from URL and store in VectorDB with automatic chunking
 */
export async function vectorIngestUrl(
  url: string,
  options: {
    collection?: string;
    metadata?: Record<string, string>;
    chunkSize?: number;
    chunkOverlap?: number;
  } = {}
): Promise<IngestUrlResult> {
  const { collection = "default", metadata = {}, chunkSize, chunkOverlap } = options;

  try {
    // Fetch the URL content
    console.log(`[VectorDB] Fetching URL: ${url}`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ControlDeck/1.0)",
        "Accept": "text/html,text/plain,application/json,*/*",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        url,
        chunks: 0,
        ids: [],
        collection,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    let text = await response.text();

    // Basic HTML to text conversion if needed
    if (contentType.includes("text/html")) {
      text = htmlToText(text);
    }

    // Remove excessive whitespace
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    if (!text || text.length < 10) {
      return {
        success: false,
        url,
        chunks: 0,
        ids: [],
        collection,
        error: "No content extracted from URL",
      };
    }

    console.log(`[VectorDB] Fetched ${text.length} chars, chunking...`);

    // Chunk the text
    const chunks = chunkText(text, { chunkSize, chunkOverlap });
    console.log(`[VectorDB] Created ${chunks.length} chunks`);

    // Prepare batch insert
    const docs = chunks.map((chunk, i) => ({
      doc: chunk.text,
      meta: {
        ...metadata,
        source_url: url,
        chunk_index: String(i),
        total_chunks: String(chunks.length),
        start_char: String(chunk.startChar),
        end_char: String(chunk.endChar),
      },
    }));

    // Batch insert all chunks
    const res = await fetch(`${VECTORDB_URL}/batch_insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docs, collection }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false,
        url,
        chunks: 0,
        ids: [],
        collection,
        error: `VectorDB batch insert failed: ${errText}`,
      };
    }

    const data = await res.json();
    console.log(`[VectorDB] Inserted ${data.ids?.length || chunks.length} chunks`);

    return {
      success: true,
      url,
      chunks: chunks.length,
      ids: data.ids || [],
      collection,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      url,
      chunks: 0,
      ids: [],
      collection,
      error: errMsg,
    };
  }
}

/**
 * Store large text with automatic chunking
 */
export async function vectorStoreChunked(
  text: string,
  options: {
    collection?: string;
    metadata?: Record<string, string>;
    chunkSize?: number;
    chunkOverlap?: number;
  } = {}
): Promise<{ success: boolean; chunks: number; ids: string[]; error?: string }> {
  const { collection = "default", metadata = {}, chunkSize, chunkOverlap } = options;

  // Chunk the text
  const chunks = chunkText(text, { chunkSize, chunkOverlap });
  console.log(`[VectorDB] Chunking ${text.length} chars into ${chunks.length} chunks`);

  if (chunks.length === 1) {
    // Single chunk, use regular insert
    const result = await vectorStore(text, { collection, metadata });
    return {
      success: result.success,
      chunks: 1,
      ids: [result.id],
    };
  }

  // Prepare batch insert
  const docs = chunks.map((chunk, i) => ({
    doc: chunk.text,
    meta: {
      ...metadata,
      chunk_index: String(i),
      total_chunks: String(chunks.length),
      start_char: String(chunk.startChar),
      end_char: String(chunk.endChar),
    },
  }));

  const res = await fetch(`${VECTORDB_URL}/batch_insert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docs, collection }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      success: false,
      chunks: 0,
      ids: [],
      error: `VectorDB batch insert failed: ${errText}`,
    };
  }

  const data = await res.json();
  return {
    success: true,
    chunks: chunks.length,
    ids: data.ids || [],
  };
}

/**
 * Simple HTML to text conversion
 */
function htmlToText(html: string): string {
  return html
    // Remove script and style content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Convert common block elements to newlines
    .replace(/<(p|div|br|h[1-6]|li|tr)[^>]*>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    // Remove all other tags
    .replace(/<[^>]+>/g, " ")
    // Decode common entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
