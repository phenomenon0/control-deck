/**
 * Vision (image understanding) invocation surface.
 *
 * An image in, a text description out — same shape as text LLMs but with
 * a structured image input. Keep this modality-local so lib/inference/types.ts
 * doesn't need to know about image encodings.
 */

export interface VisionImage {
  /** Raw base64 image data — no `data:` prefix. Preferred when the image is already in memory. */
  base64?: string;
  /** Public URL. Providers that support URL-based vision skip the base64 round-trip. */
  url?: string;
  /** MIME type hint (e.g. "image/png", "image/jpeg", "image/webp"). Defaults to image/png if omitted. */
  mimeType?: string;
}

export interface VisionArgs {
  image: VisionImage;
  /** The question to ask about the image. */
  prompt: string;
  /** Optional per-call model override — else the slot's default model is used. */
  model?: string;
  /** Optional output length cap; interpreted per-provider. */
  maxTokens?: number;
}

export interface VisionResult {
  /** Provider's text description of the image. */
  text: string;
  /** Which provider handled the analysis. */
  providerId: string;
  /** Prompt tokens consumed, when the provider returns them. */
  inputTokens?: number;
  /** Completion tokens emitted, when the provider returns them. */
  outputTokens?: number;
}
