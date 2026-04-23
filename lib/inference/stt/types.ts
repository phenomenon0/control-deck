/**
 * STT invocation surface. Mirrors the lib/inference/tts/types.ts shape so
 * callers get a symmetric voice pair — text → audio (TTS) and audio → text
 * (STT) — through structurally-identical APIs.
 */

export interface SttArgs {
  /** Audio payload. Blob is what `FormData.get("audio")` yields in Next route handlers. */
  audio: Blob;
  /**
   * Optional MIME type hint. If omitted, `audio.type` is used (most browsers
   * populate that automatically from the MediaRecorder codec).
   */
  mimeType?: string;
  /** Optional BCP-47 language hint (e.g. "en", "es", "zh"). */
  language?: string;
  /** Provider-specific model id (e.g. "whisper-1", "whisper-large-v3-turbo", "nova-3"). */
  model?: string;
  /** Ask for word-level timestamps if the provider supports them. */
  timestamps?: boolean;
}

export interface SttWord {
  text: string;
  /** Seconds from start of audio. */
  start: number;
  /** Seconds from start of audio. */
  end: number;
}

export interface SttResult {
  text: string;
  /** BCP-47 if the provider returns it. */
  language?: string;
  /** Seconds. */
  duration?: number;
  /** Word-level timestamps if `args.timestamps=true` and the provider supports them. */
  words?: SttWord[];
  /** Which provider handled the transcription. */
  providerId: string;
}
