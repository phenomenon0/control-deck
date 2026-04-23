/**
 * Image-generation invocation surface.
 *
 * The adapter handles cloud providers (Replicate, fal, OpenAI DALL-E,
 * Stability); local paths (ComfyUI, Lite ONNX) keep their existing
 * pipelines in lib/tools/executor.ts and are chosen when no cloud slot
 * is bound.
 */

export interface ImageRef {
  base64?: string;
  url?: string;
  mimeType?: string;
}

export interface ImageGenArgs {
  prompt: string;
  /** Defaults to provider-specific size if omitted. */
  width?: number;
  height?: number;
  /** Number of diffusion / sampler steps. Provider-specific default applies. */
  steps?: number;
  seed?: number;
  negativePrompt?: string;
  /** For image-edit / img-to-img modes — reference image. */
  inputImage?: ImageRef;
  /** Per-call model override — else the slot's default model is used. */
  model?: string;
  /** Opaque provider-specific knobs (guidance, scheduler, style preset, etc.). */
  extras?: Record<string, unknown>;
}

export interface ImageGenResult {
  /** Cloud-hosted URL when the provider returns one. */
  imageUrl?: string;
  /** Raw PNG/JPEG bytes when the provider returns binary. */
  imageBytes?: ArrayBuffer;
  /** MIME type — e.g. "image/png", "image/jpeg". */
  mime: string;
  /** Some providers rewrite the prompt (e.g. DALL-E 3). Surfaced for logging. */
  revisedPrompt?: string;
  providerId: string;
}
