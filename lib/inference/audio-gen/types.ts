/**
 * Audio-generation invocation surface (music + SFX; voice synthesis lives
 * under the tts modality).
 */

export interface AudioGenArgs {
  prompt: string;
  /** Seconds. Providers cap per-model; caller should consult model limits. */
  duration?: number;
  seed?: number;
  /** Per-call model override. */
  model?: string;
  /** Output format hint — mp3 | wav | ogg. */
  format?: "mp3" | "wav" | "ogg";
  /** Opaque provider-specific knobs (guidance, bpm, key, etc.). */
  extras?: Record<string, unknown>;
}

export interface AudioGenResult {
  /** Cloud-hosted URL when the provider returns one. */
  audioUrl?: string;
  /** Raw audio bytes when the provider returns binary. */
  audioBytes?: ArrayBuffer;
  /** MIME type — e.g. "audio/mpeg", "audio/wav". */
  mime: string;
  providerId: string;
}
