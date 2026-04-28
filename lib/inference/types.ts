/**
 * Shared types for the unified inference control plane.
 *
 * Every modality (text, vision, image-gen, audio-gen, tts, stt, embedding,
 * rerank, 3d-gen, video-gen) is served by one or more providers. A provider
 * can span multiple modalities (OpenAI does text + vision + tts + stt +
 * embedding; ComfyUI does image-gen + audio-gen + 3d-gen via workflows).
 *
 * Slots per modality let the user pick a primary + optional alternates
 * ("fast", "quality", etc.) — same pattern as the text-LLM slots in
 * lib/llm/providers.ts, generalised.
 */

/** All modalities the deck can route. Add here + register a provider adapter. */
export type Modality =
  | "text"
  | "vision"
  | "image-gen"
  | "audio-gen"
  | "tts"
  | "stt"
  | "embedding"
  | "rerank"
  | "3d-gen"
  | "video-gen";

/** Metadata for the UI: modality human label + which slot names are supported. */
export interface ModalityMeta {
  id: Modality;
  name: string;
  description: string;
  /**
   * Slot names this modality supports. Most modalities just expose
   * "primary"; text additionally uses "fast". The Models pane renders one
   * selector per slot.
   */
  slots: string[];
}

/** Per-modality defaults declared in `ModalityMeta`. */
export const MODALITIES: Record<Modality, ModalityMeta> = {
  text: {
    id: "text",
    name: "Text",
    description: "Chat + reasoning LLMs",
    slots: ["primary", "fast"],
  },
  vision: {
    id: "vision",
    name: "Vision",
    description: "Image understanding / multimodal reasoning",
    slots: ["primary"],
  },
  "image-gen": {
    id: "image-gen",
    name: "Image generation",
    description: "Text-to-image + image-edit",
    slots: ["primary"],
  },
  "audio-gen": {
    id: "audio-gen",
    name: "Music / SFX",
    description: "Text-to-audio music and sound effects; speech lives under STT/TTS",
    slots: ["primary"],
  },
  tts: {
    id: "tts",
    name: "Text-to-speech",
    description: "Voice synthesis",
    slots: ["primary"],
  },
  stt: {
    id: "stt",
    name: "Speech-to-text",
    description: "Transcription",
    slots: ["primary"],
  },
  embedding: {
    id: "embedding",
    name: "Embeddings",
    description: "Vector representations for semantic search",
    slots: ["primary"],
  },
  rerank: {
    id: "rerank",
    name: "Rerank",
    description: "Cross-encoder result rescoring",
    slots: ["primary"],
  },
  "3d-gen": {
    id: "3d-gen",
    name: "3D generation",
    description: "Image-to-3D, text-to-3D meshes",
    slots: ["primary"],
  },
  "video-gen": {
    id: "video-gen",
    name: "Video generation",
    description: "Text-to-video, image-to-video",
    slots: ["primary"],
  },
};

/** User-supplied config for a specific provider (API key, endpoint, default model). */
export interface InferenceProviderConfig {
  /** Matches InferenceProvider.id of the selected provider. */
  providerId: string;
  apiKey?: string;
  /** Override the provider's default base URL (only meaningful for self-hostable providers). */
  baseURL?: string;
  /** Default model name to use on this slot. Modality-specific. */
  model?: string;
  /**
   * Opaque per-provider extras (e.g. ComfyUI workflow preset, ElevenLabs
   * voice id, Replicate model version pin). The provider adapter owns the
   * shape; the registry is agnostic.
   */
  extras?: Record<string, unknown>;
}

/** Static description of a provider — registered once, referenced many times. */
export interface InferenceProvider {
  /** Stable provider id. Must be unique across the whole registry. */
  id: string;
  /** Human label for UI. */
  name: string;
  /** One-line description shown in the provider picker. */
  description: string;
  /** Modalities this provider can serve. */
  modalities: Modality[];
  /** Whether the user must supply an API key for the provider to work. */
  requiresApiKey: boolean;
  /** Optional default base URL (for self-hostable providers like Ollama or ComfyUI). */
  defaultBaseURL?: string;
  /**
   * Suggested default model names, keyed by modality. The Models pane uses
   * these to pre-populate the model dropdown before the live list arrives.
   */
  defaultModels: Partial<Record<Modality, string[]>>;
  /** Optional reachability check. Return true only if the provider is usable now. */
  checkHealth?: (config: InferenceProviderConfig) => Promise<boolean>;
  /** Optional live list of models for a given modality. Falls back to defaultModels on error. */
  listModels?: (modality: Modality, config: InferenceProviderConfig) => Promise<string[]>;
}

/** A runtime-assigned (modality, slot) → provider choice. */
export interface SlotBinding {
  modality: Modality;
  slotName: string;
  providerId: string;
  config: InferenceProviderConfig;
}
