/**
 * TTS invocation surface. Kept modality-local so lib/inference/types.ts can
 * stay modality-agnostic — each modality defines its own Args + Result
 * without polluting the registry.
 */

export interface TtsArgs {
  text: string;
  /** Provider-specific voice id or name. */
  voice?: string;
  /** Provider-specific model id. */
  model?: string;
  /** Speed multiplier where the provider supports it. 1.0 = natural. */
  speed?: number;
  /** Output format hint. Not all providers honour it. */
  format?: "mp3" | "wav" | "opus" | "pcm";
}

export interface TtsResult {
  audio: ArrayBuffer;
  /** MIME type returned by the provider — e.g. "audio/mpeg", "audio/wav". */
  contentType: string;
  /** Which provider actually handled it. Useful for UI badging + debugging. */
  providerId: string;
}

export interface TtsVoice {
  id: string;
  name?: string;
  /** Provider id — which provider this voice is native to. */
  providerId: string;
  /** Optional preview URL where the provider offers one. */
  previewUrl?: string;
  /** Language / accent / gender / style tags if the provider surfaces them. */
  tags?: string[];
}
