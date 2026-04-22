/**
 * Curated provider/model benchmarks — 2026-Q2 snapshot.
 *
 * Sourced from the session's research pass: CodeSOTA (codesota.com/speech
 * + /llm), Artificial Analysis leaderboards, Inworld AI public benchmarks,
 * OpenRouter rankings, and vendor-published latency numbers. Every entry
 * carries a `source` + `asOf` so the UI can cite and stale-check.
 *
 * This is deliberately NOT an exhaustive matrix — it's the seed layer for
 * the Models pane's leaderboard strip + compare table. Live pricing is
 * merged from OpenRouter `/api/v1/models` at request time in `getBenchmarks`.
 *
 * Every `providerId` must match an `InferenceProvider.id` registered in
 * lib/inference/{modality}/register.ts for the UI to render it as an
 * actionable row.
 */

import type { Modality } from "./types";

export interface BenchmarkMetrics {
  /** Elo-style quality ranking (higher is better). Used for text + TTS. */
  qualityElo?: number;
  /** Mean Opinion Score (1-5, higher is better). TTS only. */
  qualityMos?: number;
  /** Word Error Rate on LibriSpeech (lower is better). STT only. */
  qualityWer?: number;
  /** MMLU-style benchmark accuracy (0-1). Text reasoning. */
  qualityMmlu?: number;
  /** Time to first token/audio, milliseconds. Lower is better. */
  timeToFirstMs?: number;
  /** Streaming token throughput. Higher is better. */
  tokensPerSecond?: number;
  /** p95 end-to-end latency for a typical request. */
  latencyP95Ms?: number;
  /** USD per 1M input tokens (text / vision). */
  costPer1MInput?: number;
  /** USD per 1M output tokens (text / vision). */
  costPer1MOutput?: number;
  /** USD per 1M characters (TTS). */
  costPer1MChars?: number;
  /** USD per generated image (image-gen). */
  costPerImage?: number;
  /** USD per hour of audio processed (STT). */
  costPerAudioHour?: number;
  /** USD per second of video generated (video-gen). */
  costPerVideoSecond?: number;
  /** Context window in tokens (text / vision). */
  contextWindow?: number;
}

export interface BenchmarkEntry {
  /** Matches lib/inference/registry.ts InferenceProvider.id. */
  providerId: string;
  /** Model identifier (matches one of defaultModels where applicable). */
  model: string;
  modality: Modality;
  metrics: BenchmarkMetrics;
  /** Short source attribution — shown on the card. */
  source: string;
  /** Full URL for the UI link-out. */
  sourceUrl?: string;
  /** ISO yyyy-mm — freshness indicator. */
  asOf: string;
  /** Optional one-liner shown on the leaderboard card. */
  note?: string;
}

/* ============================================================================
 * Curated benchmarks (seeded from 2026-04 session research)
 * ========================================================================== */

// -- text LLMs -------------------------------------------------------------

const TEXT: BenchmarkEntry[] = [
  {
    providerId: "openrouter",
    model: "MiMo-V2-Pro",
    modality: "text",
    metrics: {
      qualityElo: 1278,
      costPer1MInput: 2.5,
      costPer1MOutput: 10,
      tokensPerSecond: 180,
    },
    source: "OpenRouter Rankings",
    sourceUrl: "https://openrouter.ai/rankings",
    asOf: "2026-04",
    note: "#1 by weekly token volume — 4.65T tokens/wk, 22.3% share.",
  },
  {
    providerId: "openai",
    model: "gpt-5.4",
    modality: "text",
    metrics: {
      qualityElo: 1319,
      qualityMmlu: 0.923,
      costPer1MInput: 5,
      costPer1MOutput: 20,
      contextWindow: 1_000_000,
    },
    source: "OpenRouter Rankings",
    sourceUrl: "https://openrouter.ai/rankings",
    asOf: "2026-04",
    note: "Frontier benchmark leader. DeepSeek V3.2 reaches ~90% quality at 1/50 the cost.",
  },
  {
    providerId: "anthropic",
    model: "claude-opus-4-7",
    modality: "text",
    metrics: {
      qualityElo: 1305,
      qualityMmlu: 0.914,
      costPer1MInput: 15,
      costPer1MOutput: 75,
      contextWindow: 1_000_000,
    },
    source: "Anthropic + Artificial Analysis",
    sourceUrl: "https://artificialanalysis.ai/leaderboards/models",
    asOf: "2026-04",
    note: "Best agentic tool-use benchmarks; 1M context on the Opus tier.",
  },
  {
    providerId: "anthropic",
    model: "claude-sonnet-4-6",
    modality: "text",
    metrics: {
      qualityElo: 1271,
      qualityMmlu: 0.886,
      costPer1MInput: 3,
      costPer1MOutput: 15,
      contextWindow: 1_000_000,
    },
    source: "Anthropic + OpenRouter",
    asOf: "2026-04",
  },
  {
    providerId: "deepseek",
    model: "deepseek-chat",
    modality: "text",
    metrics: {
      qualityElo: 1288,
      qualityMmlu: 0.893,
      costPer1MInput: 0.27,
      costPer1MOutput: 1.1,
      contextWindow: 128_000,
    },
    source: "OpenRouter Rankings",
    sourceUrl: "https://openrouter.ai/rankings",
    asOf: "2026-04",
    note: "~90% of GPT-5.4 quality at roughly 1/50 the cost — the value leader.",
  },
  {
    providerId: "google",
    model: "gemini-3-pro",
    modality: "text",
    metrics: {
      qualityElo: 1296,
      qualityMmlu: 0.908,
      costPer1MInput: 1.25,
      costPer1MOutput: 5,
      contextWindow: 2_000_000,
    },
    source: "Google + Artificial Analysis",
    asOf: "2026-04",
    note: "2M context leader; strongest long-document benchmarks.",
  },
  {
    providerId: "openrouter",
    model: "qwen/qwen-3.6-plus",
    modality: "text",
    metrics: { qualityElo: 1241, costPer1MInput: 0, costPer1MOutput: 0 },
    source: "OpenRouter Free Models",
    sourceUrl: "https://openrouter.ai/collections/free-models",
    asOf: "2026-04",
    note: "Free tier — production-quality at zero per-token cost.",
  },
  {
    providerId: "ollama",
    model: "llama4:70b",
    modality: "text",
    metrics: { qualityMmlu: 0.842, tokensPerSecond: 40 },
    source: "Meta Llama 4 release notes",
    asOf: "2026-04",
    note: "Local; throughput depends on hardware. ~40 tok/s on 2× A6000.",
  },
];

// -- vision ----------------------------------------------------------------

const VISION: BenchmarkEntry[] = [
  {
    providerId: "openai",
    model: "gpt-4o",
    modality: "vision",
    metrics: { qualityElo: 1210, costPer1MInput: 2.5, costPer1MOutput: 10 },
    source: "Artificial Analysis Vision",
    asOf: "2026-04",
  },
  {
    providerId: "anthropic",
    model: "claude-sonnet-4-6",
    modality: "vision",
    metrics: { qualityElo: 1198, costPer1MInput: 3, costPer1MOutput: 15 },
    source: "Artificial Analysis Vision",
    asOf: "2026-04",
  },
  {
    providerId: "google",
    model: "gemini-3-pro",
    modality: "vision",
    metrics: { qualityElo: 1232, costPer1MInput: 1.25, costPer1MOutput: 5 },
    source: "Artificial Analysis Vision",
    asOf: "2026-04",
    note: "Leads vision leaderboards on document understanding + video.",
  },
  {
    providerId: "ollama",
    model: "llama3.2-vision:11b",
    modality: "vision",
    metrics: {},
    source: "Local default",
    asOf: "2026-04",
    note: "Local / private; baseline quality without API costs.",
  },
];

// -- tts -------------------------------------------------------------------

const TTS: BenchmarkEntry[] = [
  {
    providerId: "elevenlabs",
    model: "eleven_v3",
    modality: "tts",
    metrics: { qualityElo: 1198, qualityMos: 4.55, timeToFirstMs: 250, costPer1MChars: 330 },
    source: "Artificial Analysis TTS",
    sourceUrl: "https://artificialanalysis.ai/text-to-speech",
    asOf: "2026-04",
    note: "Category king for voice cloning + emotional range.",
  },
  {
    providerId: "cartesia",
    model: "sonic-turbo",
    modality: "tts",
    metrics: { qualityMos: 4.2, timeToFirstMs: 40, costPer1MChars: 50 },
    source: "Cartesia + Inworld benchmarks",
    sourceUrl: "https://inworld.ai/resources/best-voice-ai-tts-apis-for-real-time-voice-agents-2026-benchmarks",
    asOf: "2026-04",
    note: "40ms TTFA — the lowest-latency cloud TTS as of 2026-04.",
  },
  {
    providerId: "cartesia",
    model: "sonic-3",
    modality: "tts",
    metrics: { qualityMos: 4.35, timeToFirstMs: 90, costPer1MChars: 65 },
    source: "Cartesia release notes",
    asOf: "2026-04",
    note: "Primary quality-vs-latency sweet spot at 90ms TTFA.",
  },
  {
    providerId: "openai",
    model: "gpt-4o-mini-tts",
    modality: "tts",
    metrics: { qualityMos: 4.1, timeToFirstMs: 320, costPer1MChars: 12 },
    source: "OpenAI pricing + community benchmarks",
    asOf: "2026-04",
    note: "Best cost-per-char on the cloud tier; prompt-steered voice style.",
  },
  {
    providerId: "openai",
    model: "tts-1-hd",
    modality: "tts",
    metrics: { qualityMos: 4.0, timeToFirstMs: 400, costPer1MChars: 30 },
    source: "OpenAI pricing",
    asOf: "2026-04",
  },
  {
    providerId: "voice-api",
    model: "piper",
    modality: "tts",
    metrics: { qualityMos: 3.6, timeToFirstMs: 180 },
    source: "Local sidecar",
    asOf: "2026-04",
    note: "Local / free / offline. Jenny voice default.",
  },
];

// -- stt -------------------------------------------------------------------

const STT: BenchmarkEntry[] = [
  {
    providerId: "groq",
    model: "whisper-large-v3-turbo",
    modality: "stt",
    metrics: { qualityWer: 0.089, timeToFirstMs: 380, costPerAudioHour: 0.04 },
    source: "Groq public benchmarks",
    sourceUrl: "https://console.groq.com/docs/speech-text",
    asOf: "2026-04",
    note: "Sub-400ms TTFA + free tier. Category leader for latency-per-dollar.",
  },
  {
    providerId: "deepgram",
    model: "nova-3",
    modality: "stt",
    metrics: { qualityWer: 0.072, timeToFirstMs: 300, costPerAudioHour: 0.43 },
    source: "Deepgram + Artificial Analysis",
    asOf: "2026-04",
    note: "Strong diarization + real-time streaming.",
  },
  {
    providerId: "openai",
    model: "gpt-4o-transcribe",
    modality: "stt",
    metrics: { qualityWer: 0.068, timeToFirstMs: 900, costPerAudioHour: 6.0 },
    source: "OpenAI Audio",
    asOf: "2026-04",
  },
  {
    providerId: "openai",
    model: "whisper-1",
    modality: "stt",
    metrics: { qualityWer: 0.085, costPerAudioHour: 0.36 },
    source: "OpenAI Audio",
    asOf: "2026-04",
  },
  {
    providerId: "voice-api",
    model: "whisper",
    modality: "stt",
    metrics: { qualityWer: 0.09 },
    source: "Local sidecar",
    asOf: "2026-04",
    note: "Local Whisper via VOICE_API_URL; exact WER depends on model size.",
  },
];

// -- image-gen -------------------------------------------------------------

const IMAGE_GEN: BenchmarkEntry[] = [
  {
    providerId: "bfl",
    model: "flux-pro-1.1-ultra",
    modality: "image-gen",
    metrics: { qualityElo: 1156, latencyP95Ms: 9_000, costPerImage: 0.06 },
    source: "Artificial Analysis Image",
    sourceUrl: "https://artificialanalysis.ai/text-to-image",
    asOf: "2026-04",
    note: "Category leader on prompt adherence + detail (AA Q1 2026).",
  },
  {
    providerId: "openai",
    model: "dall-e-3",
    modality: "image-gen",
    metrics: { qualityElo: 1083, latencyP95Ms: 12_000, costPerImage: 0.04 },
    source: "OpenAI pricing",
    asOf: "2026-04",
  },
  {
    providerId: "stability",
    model: "sd3-ultra",
    modality: "image-gen",
    metrics: { qualityElo: 1104, latencyP95Ms: 8_000, costPerImage: 0.08 },
    source: "Stability AI",
    asOf: "2026-04",
  },
  {
    providerId: "fal",
    model: "fal-ai/flux/schnell",
    modality: "image-gen",
    metrics: { qualityElo: 1040, latencyP95Ms: 1_200, costPerImage: 0.003 },
    source: "fal.ai benchmarks",
    asOf: "2026-04",
    note: "~1s generation; cheapest + fastest path to FLUX quality.",
  },
  {
    providerId: "replicate",
    model: "any-flux-or-sdxl",
    modality: "image-gen",
    metrics: { latencyP95Ms: 6_000, costPerImage: 0.003 },
    source: "Replicate",
    sourceUrl: "https://replicate.com/explore",
    asOf: "2026-04",
    note: "Aggregator — 50+ image models by version hash.",
  },
];

// -- audio-gen -------------------------------------------------------------

const AUDIO_GEN: BenchmarkEntry[] = [
  {
    providerId: "elevenlabs",
    model: "sound-generation",
    modality: "audio-gen",
    metrics: { latencyP95Ms: 3_500, qualityMos: 4.2 },
    source: "ElevenLabs SFX",
    asOf: "2026-04",
    note: "Best SFX quality; 22s max duration.",
  },
  {
    providerId: "fal",
    model: "fal-ai/stable-audio",
    modality: "audio-gen",
    metrics: { latencyP95Ms: 4_000 },
    source: "fal.ai",
    asOf: "2026-04",
  },
  {
    providerId: "replicate",
    model: "meta/musicgen",
    modality: "audio-gen",
    metrics: { latencyP95Ms: 15_000 },
    source: "Replicate",
    asOf: "2026-04",
    note: "MusicGen family — melody-conditioned music generation.",
  },
];

// -- embedding -------------------------------------------------------------

const EMBEDDING: BenchmarkEntry[] = [
  {
    providerId: "voyage",
    model: "voyage-3-large",
    modality: "embedding",
    metrics: { costPer1MInput: 0.12 },
    source: "MTEB + Voyage publications",
    asOf: "2026-04",
    note: "Top of MTEB retrieval benchmarks for long-context + code.",
  },
  {
    providerId: "openai",
    model: "text-embedding-3-large",
    modality: "embedding",
    metrics: { costPer1MInput: 0.13 },
    source: "MTEB",
    asOf: "2026-04",
  },
  {
    providerId: "cohere",
    model: "embed-english-v3.0",
    modality: "embedding",
    metrics: { costPer1MInput: 0.1 },
    source: "MTEB",
    asOf: "2026-04",
    note: "Strong classification + clustering; supports binary embeddings.",
  },
  {
    providerId: "jina",
    model: "jina-embeddings-v3",
    modality: "embedding",
    metrics: { costPer1MInput: 0.02 },
    source: "Jina + MTEB",
    asOf: "2026-04",
    note: "Cheapest cloud tier; 8192-token context.",
  },
  {
    providerId: "ollama",
    model: "nomic-embed-text",
    modality: "embedding",
    metrics: {},
    source: "Nomic / local",
    asOf: "2026-04",
    note: "Local / free; 768-dim.",
  },
];

// -- rerank ----------------------------------------------------------------

const RERANK: BenchmarkEntry[] = [
  {
    providerId: "cohere",
    model: "rerank-v3.5",
    modality: "rerank",
    metrics: { latencyP95Ms: 400 },
    source: "Cohere benchmarks",
    asOf: "2026-04",
    note: "Industry-reference cross-encoder; 100-lang support.",
  },
  {
    providerId: "jina",
    model: "jina-reranker-v2-base-multilingual",
    modality: "rerank",
    metrics: { latencyP95Ms: 350 },
    source: "Jina benchmarks",
    asOf: "2026-04",
    note: "Open-weight option — also self-hostable.",
  },
  {
    providerId: "voyage",
    model: "rerank-2",
    modality: "rerank",
    metrics: { latencyP95Ms: 500 },
    source: "Voyage benchmarks",
    asOf: "2026-04",
  },
];

// -- 3d-gen ----------------------------------------------------------------

const THREE_D_GEN: BenchmarkEntry[] = [
  {
    providerId: "meshy",
    model: "meshy-4",
    modality: "3d-gen",
    metrics: { latencyP95Ms: 45_000, costPerImage: 0.15 },
    source: "Meshy publications",
    asOf: "2026-04",
    note: "Best topology quality among cloud providers.",
  },
  {
    providerId: "luma",
    model: "genie-1",
    modality: "3d-gen",
    metrics: { latencyP95Ms: 12_000, costPerImage: 0.08 },
    source: "Luma Genie",
    asOf: "2026-04",
    note: "~12s text-to-3D; fastest cloud path.",
  },
  {
    providerId: "tripo",
    model: "v2.5",
    modality: "3d-gen",
    metrics: { latencyP95Ms: 30_000, costPerImage: 0.1 },
    source: "Tripo3D",
    asOf: "2026-04",
  },
];

// -- video-gen -------------------------------------------------------------

const VIDEO_GEN: BenchmarkEntry[] = [
  {
    providerId: "runway",
    model: "gen3a_turbo",
    modality: "video-gen",
    metrics: { latencyP95Ms: 30_000, costPerVideoSecond: 0.25 },
    source: "Runway + Artificial Analysis",
    sourceUrl: "https://artificialanalysis.ai/text-to-video",
    asOf: "2026-04",
    note: "Premium quality; strongest on camera control + motion.",
  },
  {
    providerId: "luma",
    model: "ray-2",
    modality: "video-gen",
    metrics: { latencyP95Ms: 40_000, costPerVideoSecond: 0.2 },
    source: "Luma Dream Machine",
    asOf: "2026-04",
    note: "Best keyframe-driven image-to-video.",
  },
  {
    providerId: "pika",
    model: "pika-2.0",
    modality: "video-gen",
    metrics: { latencyP95Ms: 25_000, costPerVideoSecond: 0.08 },
    source: "Pika",
    asOf: "2026-04",
    note: "Lower cost; strong effects catalog.",
  },
  {
    providerId: "replicate",
    model: "tencent/hunyuan-video",
    modality: "video-gen",
    metrics: { latencyP95Ms: 60_000, costPerVideoSecond: 0.05 },
    source: "Replicate",
    asOf: "2026-04",
    note: "Open-weight HunyuanVideo — cheapest via version-hash routing.",
  },
];

const CURATED: BenchmarkEntry[] = [
  ...TEXT,
  ...VISION,
  ...TTS,
  ...STT,
  ...IMAGE_GEN,
  ...AUDIO_GEN,
  ...EMBEDDING,
  ...RERANK,
  ...THREE_D_GEN,
  ...VIDEO_GEN,
];

/* ============================================================================
 * Live merge with OpenRouter pricing
 * ========================================================================== */

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

interface CacheEntry {
  ts: number;
  data: BenchmarkEntry[];
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function curatedBenchmarks(): BenchmarkEntry[] {
  return CURATED;
}

export function curatedForModality(modality: Modality): BenchmarkEntry[] {
  return CURATED.filter((e) => e.modality === modality);
}

/**
 * Returns curated benchmarks for a modality, merged with live OpenRouter
 * pricing when the provider/model is reachable via OpenRouter. Cached 1h.
 */
export async function getBenchmarks(modality: Modality): Promise<BenchmarkEntry[]> {
  const key = `m::${modality}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

  const curated = curatedForModality(modality);
  // Only text + vision benefit from OpenRouter merge; other modalities
  // OpenRouter doesn't cover.
  if (modality !== "text" && modality !== "vision") {
    cache.set(key, { ts: Date.now(), data: curated });
    return curated;
  }

  let openRouter: OpenRouterModel[] = [];
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: OpenRouterModel[] };
      openRouter = json.data ?? [];
    }
  } catch {
    // Network failure is non-fatal — fall back to curated only.
  }

  const merged = curated.map((entry) => {
    const match = openRouter.find((m) => idsOverlap(m.id, entry.model));
    if (!match) return entry;
    const nextMetrics = { ...entry.metrics };
    const live = match.pricing ?? {};
    if (live.prompt) {
      const perToken = Number.parseFloat(live.prompt);
      if (Number.isFinite(perToken) && perToken > 0) {
        nextMetrics.costPer1MInput = Math.round(perToken * 1_000_000 * 100) / 100;
      }
    }
    if (live.completion) {
      const perToken = Number.parseFloat(live.completion);
      if (Number.isFinite(perToken) && perToken > 0) {
        nextMetrics.costPer1MOutput = Math.round(perToken * 1_000_000 * 100) / 100;
      }
    }
    if (match.context_length && !entry.metrics.contextWindow) {
      nextMetrics.contextWindow = match.context_length;
    }
    return { ...entry, metrics: nextMetrics, source: `${entry.source} + OpenRouter live` };
  });

  cache.set(key, { ts: Date.now(), data: merged });
  return merged;
}

function idsOverlap(openRouterId: string, curatedModel: string): boolean {
  const a = openRouterId.toLowerCase();
  const b = curatedModel.toLowerCase();
  if (a === b) return true;
  // OpenRouter ids are "vendor/model" — match against the trailing segment.
  const tail = a.includes("/") ? a.slice(a.lastIndexOf("/") + 1) : a;
  return tail === b || tail.includes(b) || b.includes(tail);
}

/** Test-only. */
export function __clearBenchmarkCache(): void {
  cache.clear();
}
