/**
 * Embedding invocation surface.
 *
 * One or more input strings → vectors. Stays modality-local so the registry
 * doesn't need to know about vector shapes.
 */

export interface EmbeddingArgs {
  /** One or many inputs. Providers that natively batch honour this; others serialise. */
  input: string | string[];
  /** Per-call model override — else the slot's default model is used. */
  model?: string;
  /**
   * Optional task-type hint. Cohere / Voyage / Google use this to pick between
   * query vs document embedding modes. Ignored by providers that don't expose it.
   */
  taskType?: "search_query" | "search_document" | "classification" | "clustering" | "similarity";
  /** Truncate input rather than error on over-limit. Provider-specific support. */
  truncate?: boolean;
}

export interface EmbeddingResult {
  /** Vectors, one per input (always an array even when a single string was passed). */
  vectors: number[][];
  /** Embedding dimensionality (redundant with vectors[0].length but convenient). */
  dimensions: number;
  /** Model that produced the vectors. */
  model: string;
  /** Provider that handled the call. */
  providerId: string;
  /** Token count across all inputs if the provider returns it. */
  tokens?: number;
}
