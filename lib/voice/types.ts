/**
 * Voice domain types.
 *
 * Covers the three product surfaces in the Audio pane:
 *   - Assistant (conversational voice loop, session metadata)
 *   - Studio    (reference clips, clone/design jobs, previews)
 *   - Library   (published/draft voice assets + governance)
 *
 * These types are deliberately decoupled from the inference registry
 * (lib/inference/*). A voice asset carries a `providerId` + `engineId` +
 * `modelId` string triple so it can be fulfilled by *any* TTS/STT provider
 * registered in the inference registry, without this layer depending on the
 * registry's concrete adapters.
 */
import type { Modality } from "@/lib/inference/types";

// ─── Voice assets ──────────────────────────────────────────────────────────

export type VoiceAssetStatus = "draft" | "approved" | "restricted" | "archived";
export type VoiceAssetKind =
  | "native"
  | "cloned"
  | "designed"
  | "fine_tuned"
  | "imported";

export type VoiceConsentStatus =
  | "unknown"
  | "self_owner"
  | "licensed"
  | "consent_on_file"
  | "public_domain"
  | "disputed";

export type VoiceRightsStatus =
  | "unknown"
  | "all_rights"
  | "limited"
  | "not_for_commercial"
  | "restricted"
  | "revoked";

/** Structured-yet-open metadata blob kept on the asset row. */
export interface VoiceAssetMeta {
  /** C2PA / watermark-readiness data once we wire provenance signing. */
  provenance?: {
    c2paReady?: boolean;
    watermark?: string;
    notes?: string;
  };
  /** Free-form tags the UI may surface (e.g. "documentary", "gamedev"). */
  useCases?: string[];
  /** Speaker embedding vector — optional; used for similarity search. */
  speakerEmbedding?: number[];
  /** Anything else the engine adapter wants to attach. */
  [key: string]: unknown;
}

export interface VoiceAsset {
  id: string;
  name: string;
  slug: string;
  status: VoiceAssetStatus;
  kind: VoiceAssetKind;
  /** Registered provider id (matches `lib/inference/registry`). May be null for catalog-only drafts. */
  providerId: string | null;
  /** Engine family id (e.g. "elevenlabs-pvc", "fish-speech-s2"). */
  engineId: string | null;
  /** Specific model id within the engine (e.g. "eleven_v3"). */
  modelId: string | null;
  /** Provider-native voice id once a clone/preview is usable. */
  defaultVoiceId: string | null;
  language: string | null;
  accent: string | null;
  gender: string | null;
  styleTags: string[];
  description: string | null;
  consentStatus: VoiceConsentStatus;
  rightsStatus: VoiceRightsStatus;
  owner: string | null;
  meta: VoiceAssetMeta;
  createdAt: string;
  updatedAt: string;
}

// ─── Voice references ──────────────────────────────────────────────────────

export type VoiceReferenceSourceType =
  | "recording"
  | "upload"
  | "public_corpus"
  | "licensed"
  | "synthetic"
  | "unknown";

export interface VoiceReferenceMeta {
  sampleRateHz?: number;
  channels?: number;
  noiseFloorDb?: number;
  /** Segments (start/end in seconds) if the studio sliced this clip. */
  segments?: Array<{ start: number; end: number; label?: string }>;
  [key: string]: unknown;
}

export interface VoiceReference {
  id: string;
  voiceAssetId: string;
  /** Link to `artifacts.id` — the actual audio bytes. */
  artifactId: string;
  transcript: string | null;
  durationSeconds: number | null;
  speakerName: string | null;
  sourceType: VoiceReferenceSourceType;
  /** URL / note / artifact id that documents consent, when present. */
  consentDocument: string | null;
  /** 0–1 score from the studio's quality analysis step. */
  qualityScore: number | null;
  meta: VoiceReferenceMeta;
  createdAt: string;
}

// ─── Voice jobs ────────────────────────────────────────────────────────────

export type VoiceJobType =
  | "clone"
  | "fine_tune"
  | "design"
  | "preview"
  | "segment"
  | "transcribe"
  | "evaluate";

export type VoiceJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface VoiceJobInput {
  /** Text prompt for preview generation. */
  text?: string;
  /** Reference artifact ids used by this job, if any. */
  referenceArtifactIds?: string[];
  /** Engine-specific knobs (stability, similarity, guidance, etc). */
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VoiceJobOutput {
  /** Preview artifact ids produced. */
  previewArtifactIds?: string[];
  /** Provider-native voice id assigned after a clone/design. */
  providerVoiceId?: string;
  metrics?: Record<string, number>;
  [key: string]: unknown;
}

export interface VoiceJob {
  id: string;
  voiceAssetId: string;
  jobType: VoiceJobType;
  providerId: string | null;
  engineId: string | null;
  modelId: string | null;
  status: VoiceJobStatus;
  input: VoiceJobInput;
  output: VoiceJobOutput | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

// ─── Voice previews ────────────────────────────────────────────────────────

export interface VoicePreviewMeta {
  engine?: string;
  model?: string;
  voiceId?: string;
  /** Any engine extras captured at generation time for reproducibility. */
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VoicePreview {
  id: string;
  voiceAssetId: string;
  jobId: string | null;
  artifactId: string;
  promptText: string;
  /** 0–5 user ratings (nullable until a human rates them). */
  ratingSimilarity: number | null;
  ratingQuality: number | null;
  /** Latency in ms (ttfb or p95 from the generation step). */
  ratingLatency: number | null;
  meta: VoicePreviewMeta;
  createdAt: string;
}

// ─── Voice sessions ────────────────────────────────────────────────────────

export type VoiceSessionMode =
  | "push_to_talk"
  | "toggle"
  | "vad"
  | "continuous"
  | "full_duplex";

export interface VoiceSessionLatencySummary {
  /** Milliseconds from end-of-speech to first transcript chunk. */
  sttP50Ms?: number;
  sttP95Ms?: number;
  /** Milliseconds from agent output start to first audio byte. */
  ttsP50Ms?: number;
  ttsP95Ms?: number;
  /** Full round-trip turns. */
  turns?: number;
}

export interface VoiceSessionMeta {
  barge?: { count?: number };
  [key: string]: unknown;
}

export interface VoiceSession {
  id: string;
  threadId: string | null;
  runId: string | null;
  sttProviderId: string | null;
  ttsProviderId: string | null;
  voiceAssetId: string | null;
  mode: VoiceSessionMode;
  latencySummary: VoiceSessionLatencySummary;
  meta: VoiceSessionMeta;
  createdAt: string;
}

// ─── Engine metadata (used by Studio engine picker) ────────────────────────

export type VoiceEngineFamily =
  // Cloud cloning engines — hosted, real inference today.
  | "elevenlabs-pvc"
  | "elevenlabs-ivc"
  | "cartesia-ivc"
  | "inworld-tts-clone"
  // Cloud voice design (generate a voice from a text description).
  | "hume-octave"
  // Cloud expressive TTS (SOTA 2026).
  | "gemini-tts"
  // Local engines via the voice-core sidecar.
  | "xtts-v2"
  | "chatterbox"
  | "chatterbox-turbo"
  | "kokoro"
  // Local engines on the 2026 roadmap — catalogued only, sidecar support pending.
  | "f5-tts"
  | "orpheus"
  | "cosyvoice-3"
  | "fish-speech-s2"
  | "qwen3-tts"
  | "indextts-2";

export type VoiceEngineCapability =
  | "clone"
  | "fine_tune"
  | "design"
  | "tts"
  | "stt"
  | "multilingual"
  | "streaming"
  | "expressive"
  | "local"
  | "cloud";

export interface VoiceEngineDescriptor {
  id: VoiceEngineFamily;
  name: string;
  providerId: string;
  modalities: Modality[];
  capabilities: VoiceEngineCapability[];
  /** Short marketing-free description shown in the Studio engine picker. */
  description: string;
  /** Rough "gold | silver | bronze | legacy" tier used to rank defaults. */
  tier: "gold" | "silver" | "bronze" | "legacy";
  /** Minutes of reference audio this engine wants to produce a clone. */
  minReferenceMinutes?: number;
  /** Whether this engine is actually runnable in this build. */
  implemented: boolean;
  /** License flag — surfaced in the picker when non-commercial or gated. */
  licenseNote?: string;
}
