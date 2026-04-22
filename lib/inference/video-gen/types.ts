/**
 * Video-generation invocation surface. Modes: text-to-video, image-to-video.
 * Output: MP4 / WebM URL (most providers) or bytes.
 */

export interface VideoGenArgs {
  /** Text prompt — required for text-to-video, optional condition for image-to-video. */
  prompt?: string;
  /** Reference image — for image-to-video mode. */
  image?: {
    base64?: string;
    url?: string;
    mimeType?: string;
  };
  /** Duration in seconds. Providers cap per-model; typical limits 3-10s. */
  duration?: number;
  /** Defaults to provider-specific size if omitted. */
  width?: number;
  height?: number;
  seed?: number;
  /** Per-call model override / Replicate version hash. */
  model?: string;
  /** Opaque provider-specific knobs (motion, camera, guidance, etc.). */
  extras?: Record<string, unknown>;
}

export interface VideoGenResult {
  videoUrl?: string;
  videoBytes?: ArrayBuffer;
  /** MIME type — e.g. "video/mp4", "video/webm". */
  mime: string;
  /** Optional preview frame URL some providers surface. */
  previewUrl?: string;
  providerId: string;
}
