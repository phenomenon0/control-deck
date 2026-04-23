/**
 * Local model suggestions — "given this PC, what are the best local models
 * per modality?"
 *
 * Seeded with a curated 2026-Q2 catalog of ~60 candidates across 6
 * local-capable modalities. Each candidate carries its VRAM + disk footprint
 * at a default quantisation so the fit scorer can answer "will this run".
 *
 * Fit buckets — sorted in the order the UI surfaces them:
 *   perfect         model ≤ 70% of capacity (plenty of context headroom)
 *   tight           70-90%  (runs, limited context headroom)
 *   overhead-risk   90-100% (runs slowly, no context headroom)
 *   too-big         > 100%  (filtered out of suggestion results)
 *
 * Apple Silicon handling: detectMacGpu already reports `gpu.vram` as 60% of
 * unified memory, so the fit scorer can treat it the same as discrete VRAM
 * without special casing here.
 */

import type { Modality } from "./types";
import type { SystemProfile, InferenceBackend } from "@/lib/system/detect";

export type FitScore = "perfect" | "tight" | "overhead-risk" | "too-big";

export type CandidateSource = "huggingface-live" | "curated-fallback" | "user-installed";

export interface LocalCandidate {
  /** Stable id used for sort stability + telemetry. */
  id: string;
  /** Human-readable label shown in the UI. */
  displayName: string;
  modality: Modality;
  /** Provider id that would serve this candidate (matches InferenceProvider.id). */
  providerId: string;
  /**
   * Ollama tag when pullable via Ollama. Gives us an exact match against
   * the user's installed list.
   */
  ollamaTag?: string;
  /** HF Hub repo id (for non-Ollama local paths). */
  hfRepo?: string;
  /**
   * Approximate VRAM required to load the weights at the default quant.
   * Does NOT include KV-cache context headroom — fit scorer adds it.
   */
  vramRequiredMB: number;
  /** On-disk size of the quantised weights. Used for storage fit. */
  diskMB: number;
  /** Default quantisation label (Q4_K_M, fp16, int8, etc.). */
  quantization: string;
  /** Rough context window the quantised variant supports without sliding. */
  contextWindow?: number;
  /**
   * Does this candidate run acceptably on CPU-only? Filters what we suggest
   * to backend=cpu machines.
   */
  cpuFriendly: boolean;
  /**
   * Backends we've seen this candidate run well on. `cpu` alone means a
   * backend=cpu machine should also suggest it.
   */
  backends: InferenceBackend[];
  /** Short rationale shown under the suggestion card. */
  summary: string;
  /** Model's origin family for grouping. */
  family: string;
  /** Licence label — "open", "commercial-ok", "research-only", "non-commercial", etc. */
  license: "apache-2.0" | "mit" | "llama-3" | "llama-4" | "gemma" | "qwen" | "research" | "commercial" | "other";
  /** Where this entry came from. UI shows a small source badge. */
  source?: CandidateSource;
  /** HF Hub weekly downloads (live entries only). Used for ranking + UI display. */
  downloads?: number;
  /** HF Hub likes count. */
  likes?: number;
  /** Leaderboard score (Open LLM Leaderboard normalised 0-100). */
  leaderboardScore?: number;
  /**
   * Community buzz score — derived from recent r/LocalLLaMA post mentions.
   * Normalised 0-100 so we can add it into the ranking weight.
   */
  buzzScore?: number;
}

/**
 * Storage assessment independent of VRAM fit. Split out so that disk-
 * limited suggestions still surface — the UX is "warn + pull-blocked"
 * rather than "silently disappear." Only genuinely-uninstallable models
 * (status="impossible", currently > 100 GB) get filtered out entirely.
 */
export type StorageFit =
  /** Free disk comfortably exceeds the pull size. */
  | { status: "ample" }
  /** Would fit but leaves very little headroom (< 2 GB after install). */
  | { status: "tight"; freeAfterGb: number }
  /** Can't install with current free space; user would need to clean up. */
  | { status: "needs-cleanup"; shortfallGb: number }
  /** So large we don't ever suggest it on this class of machine (filtered). */
  | { status: "impossible"; requiredGb: number }
  /** Storage info unavailable — skip check. */
  | { status: "unknown" };

export interface LocalSuggestion {
  candidate: LocalCandidate;
  fit: FitScore;
  /** True when we match one of the user's installed Ollama models. */
  installed: boolean;
  /**
   * Fit percentage — `candidateVram / capacity`. Surfaced in the UI as a
   * progress bar.
   */
  fillRatio: number;
  /** Short explanation shown below the card ("fits with 4.2 GB headroom"). */
  reasoning: string;
  /** Ready-to-copy install command when applicable. */
  installCommand?: string;
  /** Disk-space verdict — UI shows badges + disables Pull when blocked. */
  storage: StorageFit;
}

/** Above this, a candidate is treated as impossible-to-install and filtered. */
const IMPOSSIBLE_DISK_GB = 100;
/** How much headroom beyond the candidate's size counts as "ample" storage. */
const AMPLE_HEADROOM_GB = 5;

/* ============================================================================
 * Curated CANDIDATES — 2026-Q2 snapshot
 * ========================================================================== */

// -- Text (refreshed 2026-04) ---------------------------------------------

const TEXT_CANDIDATES: LocalCandidate[] = [
  // Tier 0 — sub-2 GB, runs on literally anything
  c("qwen3:0.6b", "Qwen 3 0.6B", "text", "ollama", {
    ollamaTag: "qwen3:0.6b", vramRequiredMB: 500, diskMB: 500,
    quantization: "Q4_K_M", contextWindow: 32000, cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "qwen", license: "qwen",
    summary: "Router / draft model. 600M params, fits anywhere, fast on CPU.",
  }),
  c("deepseek-r1:1.5b", "DeepSeek R1 1.5B Distill", "text", "ollama", {
    ollamaTag: "deepseek-r1:1.5b", vramRequiredMB: 1100, diskMB: 1100,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "deepseek", license: "mit",
    summary: "R1 reasoning distilled into Qwen 1.5B. Chain-of-thought on a laptop.",
  }),
  c("llama3.2:1b", "Llama 3.2 1B", "text", "ollama", {
    ollamaTag: "llama3.2:1b", vramRequiredMB: 1300, diskMB: 1300,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "llama",
    license: "llama-3",
    summary: "Still a good tiny tool-call / routing model in 2026.",
  }),

  // Tier 1 — 2-5 GB, strong laptop tier
  c("llama3.2:3b", "Llama 3.2 3B", "text", "ollama", {
    ollamaTag: "llama3.2:3b", vramRequiredMB: 2000, diskMB: 2000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "llama", license: "llama-3",
    summary: "Laptop-friendly general chat. Usable on CPU, snappy on GPU.",
  }),
  c("gemma3:4b", "Gemma 3 4B", "text", "ollama", {
    ollamaTag: "gemma3:4b", vramRequiredMB: 2500, diskMB: 2500,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "cpu"], family: "gemma", license: "gemma",
    summary: "Gemma 3 4B — multimodal-capable, strong multilingual for its size.",
  }),
  c("qwen3:4b", "Qwen 3 4B", "text", "ollama", {
    ollamaTag: "qwen3:4b", vramRequiredMB: 2700, diskMB: 2700,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "cpu"], family: "qwen", license: "qwen",
    summary: "Qwen 3 4B — major jump over 2.5 series; strong multilingual.",
  }),
  c("deepseek-r1:7b", "DeepSeek R1 7B Distill", "text", "ollama", {
    ollamaTag: "deepseek-r1:7b", vramRequiredMB: 4700, diskMB: 4700,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "deepseek", license: "mit",
    summary: "R1-distilled Qwen 7B. Reasoning quality-for-size champion.",
  }),
  c("qwen3:8b", "Qwen 3 8B", "text", "ollama", {
    ollamaTag: "qwen3:8b", vramRequiredMB: 5100, diskMB: 5100,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "qwen", license: "qwen",
    summary: "Qwen 3 8B — 2026 workhorse. Tool-use, long-context, multilingual.",
  }),
  c("granite3.3:8b", "IBM Granite 3.3 8B", "text", "ollama", {
    ollamaTag: "granite3.3:8b", vramRequiredMB: 4900, diskMB: 4900,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "granite", license: "apache-2.0",
    summary: "IBM's enterprise-tuned 8B. Apache-2.0, strong code + RAG.",
  }),
  c("qwen3-coder:7b", "Qwen 3 Coder 7B", "text", "ollama", {
    ollamaTag: "qwen3-coder:7b", vramRequiredMB: 4700, diskMB: 4700,
    quantization: "Q4_K_M", contextWindow: 64000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "qwen", license: "qwen",
    summary: "Qwen 3 Coder 7B — best local model for inline code edits.",
  }),

  // Tier 2 — 6-12 GB, single mid-range GPU
  c("deepseek-r1:14b", "DeepSeek R1 14B Distill", "text", "ollama", {
    ollamaTag: "deepseek-r1:14b", vramRequiredMB: 9000, diskMB: 9000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "deepseek", license: "mit",
    summary: "R1-distilled Qwen 14B. Best reasoning that still fits 12 GB VRAM.",
  }),
  c("gemma3:12b", "Gemma 3 12B", "text", "ollama", {
    ollamaTag: "gemma3:12b", vramRequiredMB: 7200, diskMB: 7200,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "gemma", license: "gemma",
    summary: "Gemma 3 12B — multimodal; strong quality ceiling at this size.",
  }),
  c("phi-4:14b", "Phi 4 14B", "text", "ollama", {
    ollamaTag: "phi-4:14b", vramRequiredMB: 9000, diskMB: 9000,
    quantization: "Q4_K_M", contextWindow: 16000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "phi", license: "mit",
    summary: "Microsoft Phi 4 14B — outsize reasoning-per-parameter; MIT.",
  }),
  c("qwen3:14b", "Qwen 3 14B", "text", "ollama", {
    ollamaTag: "qwen3:14b", vramRequiredMB: 9000, diskMB: 9000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 3 14B — quality/size sweet spot for 16 GB machines.",
  }),

  // Tier 3 — 14-30 GB, high-end single GPU
  c("mistral-small3.2:24b", "Mistral Small 3.2 24B", "text", "ollama", {
    ollamaTag: "mistral-small3.2:24b", vramRequiredMB: 14000, diskMB: 14000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "mistral", license: "apache-2.0",
    summary: "Mistral Small 3.2 — hits GPT-4o-mini quality; apache licensed.",
  }),
  c("gemma3:27b", "Gemma 3 27B", "text", "ollama", {
    ollamaTag: "gemma3:27b", vramRequiredMB: 16000, diskMB: 16000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "gemma", license: "gemma",
    summary: "Gemma 3 flagship. 27B dense; multimodal-capable.",
  }),
  c("qwq:32b", "QwQ 32B", "text", "ollama", {
    ollamaTag: "qwq:32b", vramRequiredMB: 20000, diskMB: 20000,
    quantization: "Q4_K_M", contextWindow: 32000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "Qwen reasoning model. Open CoT alternative to closed o-series.",
  }),
  c("deepseek-r1:32b", "DeepSeek R1 32B Distill", "text", "ollama", {
    ollamaTag: "deepseek-r1:32b", vramRequiredMB: 20000, diskMB: 20000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "deepseek", license: "mit",
    summary: "R1-distilled Qwen 32B. Best open reasoning under 32 GB VRAM.",
  }),
  c("qwen3:32b", "Qwen 3 32B", "text", "ollama", {
    ollamaTag: "qwen3:32b", vramRequiredMB: 20000, diskMB: 20000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 3 32B — 2026 dense flagship. Multilingual leader.",
  }),
  c("qwen3-coder:30b-a3b", "Qwen 3 Coder 30B MoE", "text", "ollama", {
    ollamaTag: "qwen3-coder:30b-a3b", vramRequiredMB: 18000, diskMB: 18000,
    quantization: "Q4_K_M", contextWindow: 256000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "MoE code model. 3B active at inference → fast for 30B-tier quality.",
  }),
  c("llama4:16b", "Llama 4 Scout 16B", "text", "ollama", {
    ollamaTag: "llama4:16b", vramRequiredMB: 10500, diskMB: 10500,
    quantization: "Q4_K_M", contextWindow: 1048576, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "llama", license: "llama-4",
    summary: "Llama 4 Scout — 1M-token context at 16B.",
  }),

  // Tier 4 — 30-50 GB, multi-GPU or 48 GB rigs
  c("llama4:30b-a3b", "Llama 4 Maverick 30B MoE", "text", "ollama", {
    ollamaTag: "llama4:30b-a3b", vramRequiredMB: 20000, diskMB: 20000,
    quantization: "Q4_K_M", contextWindow: 1048576, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "llama", license: "llama-4",
    summary: "Llama 4 Maverick MoE — 30B total, 3B active. Cheap inference, big quality.",
  }),
  c("llama3.3:70b", "Llama 3.3 70B", "text", "ollama", {
    ollamaTag: "llama3.3:70b", vramRequiredMB: 40000, diskMB: 40000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["cuda"], family: "llama", license: "llama-3",
    summary: "Llama 3.3 70B — still a reference open model. Needs 48 GB+ VRAM.",
  }),
  c("llama4:70b", "Llama 4 70B", "text", "ollama", {
    ollamaTag: "llama4:70b", vramRequiredMB: 40000, diskMB: 40000,
    quantization: "Q4_K_M", contextWindow: 1048576, cpuFriendly: false,
    backends: ["cuda"], family: "llama", license: "llama-4",
    summary: "Llama 4 dense 70B — 1M context flagship.",
  }),
  c("deepseek-r1:70b", "DeepSeek R1 70B Distill", "text", "ollama", {
    ollamaTag: "deepseek-r1:70b", vramRequiredMB: 40000, diskMB: 40000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["cuda"], family: "deepseek", license: "mit",
    summary: "R1-distilled Llama 70B. Top open reasoning model.",
  }),
  c("qwen3:72b", "Qwen 3 72B", "text", "ollama", {
    ollamaTag: "qwen3:72b", vramRequiredMB: 47000, diskMB: 47000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 3 72B dense. Multilingual leader at 70B tier.",
  }),

  // Tier 5 — exotic MoE, mostly HF-direct
  c("qwen3-moe:235b-a22b", "Qwen 3 MoE 235B (22B active)", "text", "vllm", {
    hfRepo: "Qwen/Qwen3-235B-A22B", vramRequiredMB: 140000, diskMB: 140000,
    quantization: "fp16", contextWindow: 128000, cpuFriendly: false,
    backends: ["cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 3 235B MoE. 22B active. Multi-H100 or A100 80 GB cluster.",
  }),
  c("deepseek-v3.2", "DeepSeek V3.2", "text", "vllm", {
    hfRepo: "deepseek-ai/DeepSeek-V3.2", vramRequiredMB: 350000, diskMB: 350000,
    quantization: "fp8", contextWindow: 128000, cpuFriendly: false,
    backends: ["cuda"], family: "deepseek", license: "mit",
    summary: "671B MoE (37B active). Open weights; cluster-only.",
  }),
];

// -- Vision ----------------------------------------------------------------

const VISION_CANDIDATES: LocalCandidate[] = [
  c("llava:7b", "LLaVA 7B", "vision", "ollama", {
    ollamaTag: "llava:7b", vramRequiredMB: 4700, diskMB: 4700,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "llava", license: "llama-3",
    summary: "Classic open vision model. Good baseline VQA.",
  }),
  c("bakllava", "BakLLaVA", "vision", "ollama", {
    ollamaTag: "bakllava", vramRequiredMB: 4600, diskMB: 4600,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "llava", license: "apache-2.0",
    summary: "LLaVA on Mistral 7B backbone — Apache-licensed.",
  }),
  c("qwen2.5-vl:7b", "Qwen 2.5 VL 7B", "vision", "ollama", {
    ollamaTag: "qwen2.5-vl:7b", vramRequiredMB: 5000, diskMB: 5000,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 2.5 VL — strong OCR + document understanding at 7B.",
  }),
  c("llama3.2-vision:11b", "Llama 3.2 Vision 11B", "vision", "ollama", {
    ollamaTag: "llama3.2-vision:11b", vramRequiredMB: 7900, diskMB: 7900,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "llama", license: "llama-3",
    summary: "Meta's vision model. Currently the deck's default.",
  }),
  c("llama3.2-vision:90b", "Llama 3.2 Vision 90B", "vision", "ollama", {
    ollamaTag: "llama3.2-vision:90b", vramRequiredMB: 55000, diskMB: 55000,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["cuda"], family: "llama", license: "llama-3",
    summary: "Top-tier open vision model. Needs 64 GB+ VRAM.",
  }),
  c("qwen2.5-vl:72b", "Qwen 2.5 VL 72B", "vision", "ollama", {
    ollamaTag: "qwen2.5-vl:72b", vramRequiredMB: 47000, diskMB: 47000,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["cuda"], family: "qwen", license: "qwen",
    summary: "Qwen's 72B VL flagship. Document + chart benchmarks leader.",
  }),
];

// -- STT (whisper.cpp / faster-whisper; not Ollama) ------------------------

const STT_CANDIDATES: LocalCandidate[] = [
  c("whisper-tiny", "Whisper Tiny", "stt", "voice-api", {
    hfRepo: "openai/whisper-tiny", vramRequiredMB: 75, diskMB: 75,
    quantization: "fp16", cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "whisper", license: "mit",
    summary: "Runs on any device. Trade accuracy for speed.",
  }),
  c("whisper-base", "Whisper Base", "stt", "voice-api", {
    hfRepo: "openai/whisper-base", vramRequiredMB: 145, diskMB: 145,
    quantization: "fp16", cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "whisper", license: "mit",
    summary: "Good starting point for CPU-only. 5x realtime on modern laptops.",
  }),
  c("whisper-small", "Whisper Small", "stt", "voice-api", {
    hfRepo: "openai/whisper-small", vramRequiredMB: 465, diskMB: 465,
    quantization: "fp16", cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "whisper", license: "mit",
    summary: "Balanced CPU path. Acceptable accuracy for dictation.",
  }),
  c("whisper-medium", "Whisper Medium", "stt", "voice-api", {
    hfRepo: "openai/whisper-medium", vramRequiredMB: 1500, diskMB: 1500,
    quantization: "fp16", cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "whisper", license: "mit",
    summary: "Strong quality without going all the way to large.",
  }),
  c("whisper-large-v3-turbo", "Whisper Large v3 Turbo", "stt", "voice-api", {
    hfRepo: "openai/whisper-large-v3-turbo", vramRequiredMB: 1600, diskMB: 1600,
    quantization: "fp16", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "whisper", license: "mit",
    summary: "Best quality-per-ms. Only slightly larger than medium.",
  }),
  c("whisper-large-v3", "Whisper Large v3", "stt", "voice-api", {
    hfRepo: "openai/whisper-large-v3", vramRequiredMB: 2900, diskMB: 2900,
    quantization: "fp16", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "whisper", license: "mit",
    summary: "Accuracy ceiling for Whisper family. Slower than turbo.",
  }),
  c("parakeet-tdt-1.1b", "NVIDIA Parakeet TDT 1.1B", "stt", "voice-api", {
    hfRepo: "nvidia/parakeet-tdt-1.1b", vramRequiredMB: 3800, diskMB: 3800,
    quantization: "fp16", cpuFriendly: false,
    backends: ["cuda"], family: "parakeet", license: "commercial",
    summary: "1.8% WER on LibriSpeech — beats all Whisper variants.",
  }),
];

// -- TTS -------------------------------------------------------------------

const TTS_CANDIDATES: LocalCandidate[] = [
  c("piper-en_US-jenny", "Piper (Jenny voice)", "tts", "voice-api", {
    vramRequiredMB: 50, diskMB: 50,
    quantization: "int8", cpuFriendly: true,
    backends: ["cpu"], family: "piper", license: "mit",
    summary: "Runs on any CPU. Fast + private. Lower quality ceiling.",
  }),
  c("kokoro-82m", "Kokoro 82M", "tts", "voice-api", {
    hfRepo: "hexgrad/Kokoro-82M", vramRequiredMB: 327, diskMB: 327,
    quantization: "fp16", cpuFriendly: true,
    backends: ["metal", "cuda", "cpu"], family: "kokoro", license: "apache-2.0",
    summary: "Apache-licensed; rivals commercial TTS at 82M params.",
  }),
  c("xtts-v2", "XTTS v2", "tts", "voice-api", {
    hfRepo: "coqui/XTTS-v2", vramRequiredMB: 1800, diskMB: 1800,
    quantization: "fp16", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "xtts", license: "other",
    summary: "Voice cloning from short samples. 17 languages.",
  }),
  c("sesame-csm-1b", "Sesame CSM 1B", "tts", "voice-api", {
    hfRepo: "sesame/csm-1b", vramRequiredMB: 6000, diskMB: 6000,
    quantization: "fp16", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "sesame", license: "apache-2.0",
    summary: "2026 release. MOS 4.7 — matches cloud quality on a single GPU.",
  }),
];

// -- Embedding -------------------------------------------------------------

const EMBEDDING_CANDIDATES: LocalCandidate[] = [
  c("all-minilm", "All-MiniLM-L6-v2", "embedding", "ollama", {
    ollamaTag: "all-minilm", vramRequiredMB: 46, diskMB: 46,
    quantization: "fp16", cpuFriendly: true,
    backends: ["cpu", "metal", "cuda"], family: "minilm", license: "apache-2.0",
    summary: "Tiny, fast, 384-dim. CPU-friendly default for small corpora.",
  }),
  c("nomic-embed-text", "Nomic Embed Text", "embedding", "ollama", {
    ollamaTag: "nomic-embed-text", vramRequiredMB: 274, diskMB: 274,
    quantization: "fp16", cpuFriendly: true,
    backends: ["cpu", "metal", "cuda"], family: "nomic", license: "apache-2.0",
    summary: "768-dim, 8192-token context. Strong general-purpose baseline.",
  }),
  c("mxbai-embed-large", "MixedBread Embed Large", "embedding", "ollama", {
    ollamaTag: "mxbai-embed-large", vramRequiredMB: 670, diskMB: 670,
    quantization: "fp16", cpuFriendly: true,
    backends: ["cpu", "metal", "cuda"], family: "mxbai", license: "apache-2.0",
    summary: "MTEB-competitive open embedder. 1024-dim.",
  }),
  c("snowflake-arctic-embed", "Snowflake Arctic Embed", "embedding", "ollama", {
    ollamaTag: "snowflake-arctic-embed", vramRequiredMB: 670, diskMB: 670,
    quantization: "fp16", cpuFriendly: true,
    backends: ["cpu", "metal", "cuda"], family: "snowflake", license: "apache-2.0",
    summary: "Snowflake's retrieval-tuned embedder. Good on code.",
  }),
  c("bge-m3", "BGE M3", "embedding", "ollama", {
    ollamaTag: "bge-m3", vramRequiredMB: 2300, diskMB: 2300,
    quantization: "fp16", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "bge", license: "mit",
    summary: "Multilingual + long context. Best open embedder quality.",
  }),
];

// -- Image generation -----------------------------------------------------

const IMAGE_GEN_CANDIDATES: LocalCandidate[] = [
  c("sd-turbo-onnx", "SD Turbo (ONNX / CPU)", "image-gen", "lite-onnx", {
    hfRepo: "stabilityai/sd-turbo", vramRequiredMB: 2500, diskMB: 2500,
    quantization: "int8", cpuFriendly: true,
    backends: ["cpu"], family: "sd", license: "other",
    summary: "CPU-only fallback. ~10s per 512px image.",
  }),
  c("sdxl-turbo", "SDXL Turbo", "image-gen", "comfyui", {
    hfRepo: "stabilityai/sdxl-turbo", vramRequiredMB: 6600, diskMB: 6600,
    quantization: "fp16", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "sdxl", license: "other",
    summary: "4-step SDXL. Good quality/speed trade-off for single-GPU.",
  }),
  c("flux1-schnell-gguf-q4", "FLUX.1 Schnell GGUF Q4", "image-gen", "comfyui", {
    hfRepo: "city96/FLUX.1-schnell-gguf", vramRequiredMB: 7000, diskMB: 7000,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "flux", license: "apache-2.0",
    summary: "4-step FLUX Schnell quantised. Fits 8 GB VRAM.",
  }),
  c("flux1-dev-gguf-q4", "FLUX.1 Dev GGUF Q4", "image-gen", "comfyui", {
    hfRepo: "city96/FLUX.1-dev-gguf", vramRequiredMB: 8000, diskMB: 8000,
    quantization: "Q4_K_M", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "flux", license: "other",
    summary: "Higher-quality FLUX Dev at Q4. Needs ~10 GB VRAM headroom.",
  }),
  c("flux1-dev-nunchaku-int4", "FLUX.1 Dev Nunchaku INT4", "image-gen", "comfyui", {
    hfRepo: "mit-han-lab/svdq-int4-flux.1-dev", vramRequiredMB: 8000, diskMB: 8000,
    quantization: "int4", cpuFriendly: false,
    backends: ["metal", "cuda"], family: "flux", license: "other",
    summary: "FLUX Dev via Nunchaku INT4 — 8 GB fits same quality as Q4 GGUF.",
  }),
  c("sd3-medium", "Stable Diffusion 3 Medium", "image-gen", "comfyui", {
    hfRepo: "stabilityai/stable-diffusion-3-medium", vramRequiredMB: 10000, diskMB: 10000,
    quantization: "fp16", cpuFriendly: false,
    backends: ["cuda"], family: "sd3", license: "other",
    summary: "Stability's SD3 family. Best prompt adherence among SD lineage.",
  }),
];

const CANDIDATES: LocalCandidate[] = [
  ...TEXT_CANDIDATES,
  ...VISION_CANDIDATES,
  ...STT_CANDIDATES,
  ...TTS_CANDIDATES,
  ...EMBEDDING_CANDIDATES,
  ...IMAGE_GEN_CANDIDATES,
].map((c) => ({ ...c, source: "curated-fallback" as CandidateSource }));

/* ============================================================================
 * Fit scoring
 * ========================================================================== */

/** Capacity budget (MB) available to a single model's weights. */
function capacityMb(profile: SystemProfile): number {
  // No GPU at all → fall back to a conservative slice of system RAM for CPU inference.
  if (!profile.gpu) {
    return Math.round(profile.ram * 1024 * 0.5);
  }
  return profile.gpu.vram;
}

/**
 * fit score for a candidate on this machine. Also filters out candidates
 * whose backends don't match, CPU-only machines that would blow up on GPU-only
 * candidates, and over-storage pulls.
 */
export function scoreFit(
  profile: SystemProfile,
  candidate: LocalCandidate,
): { fit: FitScore; fillRatio: number } {
  // Backend compatibility: CPU-friendly candidates run anywhere (they gracefully
  // degrade to CPU on machines without the listed accelerator). Non-CPU-friendly
  // candidates need this machine's exact backend in their tested-backends list.
  const backendOk =
    candidate.cpuFriendly || candidate.backends.includes(profile.backend);
  // A backend=cpu machine can only run CPU-friendly candidates regardless
  // of what backends they list.
  const cpuMachineOk = profile.backend === "cpu" ? candidate.cpuFriendly : true;
  if (!backendOk || !cpuMachineOk) {
    return { fit: "too-big", fillRatio: Number.POSITIVE_INFINITY };
  }

  // NOTE: storage is NOT a VRAM-fit filter anymore. A 70B Q4 model on a
  // disk-constrained laptop should still show up — we just warn the user
  // to free space. See assessStorage() for the separate verdict.

  const capacity = capacityMb(profile);
  // Add a context-scratch overhead (~15%) so "perfect" means "runs with room
  // to stretch", not just "weights barely fit".
  const effective = candidate.vramRequiredMB * 1.15;
  const ratio = capacity > 0 ? effective / capacity : Number.POSITIVE_INFINITY;

  if (ratio <= 0.7) return { fit: "perfect", fillRatio: ratio };
  if (ratio <= 0.9) return { fit: "tight", fillRatio: ratio };
  if (ratio <= 1.0) return { fit: "overhead-risk", fillRatio: ratio };
  return { fit: "too-big", fillRatio: ratio };
}

/**
 * Disk-space verdict for a candidate. Returns "impossible" only for
 * genuinely-huge pulls (> IMPOSSIBLE_DISK_GB); everything else returns a
 * status that the UI turns into a warning chip.
 */
export function assessStorage(
  profile: SystemProfile,
  candidate: LocalCandidate,
): StorageFit {
  const diskGb = candidate.diskMB / 1024;

  // Super-large filter — even with cleanup, a 200 GB model isn't a
  // realistic suggestion on a laptop. Filter these out so the list
  // doesn't get flooded with datacentre-tier entries.
  if (diskGb > IMPOSSIBLE_DISK_GB) {
    return { status: "impossible", requiredGb: Math.round(diskGb) };
  }

  if (!profile.storage) return { status: "unknown" };

  const free = profile.storage.freeGb;
  const freeAfter = free - diskGb;

  if (freeAfter >= AMPLE_HEADROOM_GB) return { status: "ample" };
  if (freeAfter >= 0) return { status: "tight", freeAfterGb: Math.round(freeAfter) };
  return {
    status: "needs-cleanup",
    shortfallGb: Math.max(1, Math.round(Math.abs(freeAfter) + 2)), // +2 GB safety margin
  };
}

/**
 * Match a candidate against the installed Ollama list. Checks exact tag,
 * then falls back to family+size fuzzy matching so "qwen2.5:7b" counts as
 * "installed" even when the user has `qwen2.5:7b-instruct-q8_0` pulled
 * under a slightly different tag suffix.
 */
function isInstalled(
  candidate: LocalCandidate,
  installed: Array<{ name: string }>,
): boolean {
  if (!candidate.ollamaTag) return false;
  if (installed.some((m) => m.name === candidate.ollamaTag)) return true;
  // Fuzzy: base name (before colon) + size suffix match.
  const base = candidate.ollamaTag.split(":")[0];
  const size = candidate.ollamaTag.split(":")[1] ?? "";
  return installed.some((m) => {
    const [mBase, mSize] = m.name.split(":");
    if (mBase !== base) return false;
    // Match e.g. "7b" against "7b-instruct-q8_0"
    return (mSize ?? "").startsWith(size);
  });
}

function reasoningFor(
  profile: SystemProfile,
  candidate: LocalCandidate,
  fit: FitScore,
  fillRatio: number,
  installed: boolean,
): string {
  if (installed) return "Already installed — pick it immediately.";
  if (fit === "too-big") return "Exceeds this machine's VRAM capacity.";
  const capacity = capacityMb(profile);
  const used = Math.round(candidate.vramRequiredMB * 1.15);
  const headroom = capacity - used;
  const pct = Math.round(fillRatio * 100);
  const unit = profile.gpu?.unifiedMemory ? "unified mem" : "VRAM";
  if (fit === "perfect") {
    return `Uses ~${pct}% of ${unit}; leaves ${headroom > 1000 ? `${(headroom / 1024).toFixed(1)} GB` : `${headroom} MB`} for context + OS.`;
  }
  if (fit === "tight") {
    return `${pct}% of ${unit}. Runs well with short context; may spill to host RAM for long prompts.`;
  }
  return `${pct}% of ${unit}. Expect slow inference; consider a smaller quant.`;
}

function installCommandFor(candidate: LocalCandidate): string | undefined {
  if (candidate.ollamaTag) return `ollama pull ${candidate.ollamaTag}`;
  if (candidate.hfRepo) return `huggingface-cli download ${candidate.hfRepo}`;
  return undefined;
}

export interface SuggestOptions {
  /**
   * When true, candidates whose VRAM exceeds the machine's capacity are
   * returned anyway (marked fit="too-big"). Lets the System tab's
   * "Local SOTA" pill show e.g. Llama 4 70B to a 16 GB laptop user with
   * a clear "needs 40 GB VRAM" warning — rather than hiding it.
   */
  includeOversized?: boolean;
}

/**
 * Rank suggestions for a modality. Live HF Hub source is primary; the
 * curated candidate table is the fallback when live is unavailable.
 *
 * Merge rule: when both sources have the same `hfRepo`, the live entry
 * wins (fresh download counts + community signal). Live-only repos and
 * curated-only entries both survive.
 */
export async function suggestForModality(
  profile: SystemProfile,
  installed: Array<{ name: string }>,
  modality: Modality,
  limit = 8,
  options: SuggestOptions = {},
): Promise<LocalSuggestion[]> {
  // Lazy-import the live fetcher so nothing that reaches this module
  // eagerly pulls the HF client code.
  const { getLiveCandidates } = await import("./live-candidates");
  const live = await getLiveCandidates(modality);
  const curated = CANDIDATES.filter((c) => c.modality === modality);

  const liveRepoIds = new Set(
    live.map((c) => c.hfRepo).filter(Boolean) as string[],
  );
  const merged: LocalCandidate[] = [
    ...live,
    ...curated.filter((c) => !(c.hfRepo && liveRepoIds.has(c.hfRepo))),
  ];

  const scored = merged.map((candidate) => {
    const { fit, fillRatio } = scoreFit(profile, candidate);
    const storage = assessStorage(profile, candidate);
    const isIn = isInstalled(candidate, installed);
    return {
      candidate,
      fit,
      fillRatio,
      installed: isIn,
      reasoning: reasoningFor(profile, candidate, fit, fillRatio, isIn),
      installCommand: installCommandFor(candidate),
      storage,
    } satisfies LocalSuggestion;
  });

  const fitOrder: Record<FitScore, number> = {
    perfect: 0,
    tight: 1,
    "overhead-risk": 2,
    "too-big": 3,
  };
  // Storage-status ranking: ample/unknown sort equal and above tight, which
  // is above needs-cleanup. Never completely demotes below fit rank though.
  const storageOrder: Record<StorageFit["status"], number> = {
    ample: 0,
    unknown: 0,
    tight: 1,
    "needs-cleanup": 2,
    impossible: 3,
  };
  const baseFiltered = scored
    .filter((s) => options.includeOversized || s.fit !== "too-big")
    .filter((s) => s.storage.status !== "impossible");

  // Local SOTA mode: rank by community signal + size, NOT by fit. The
  // whole point is to show the open-weight ceiling regardless of whether
  // it fits this specific machine; the UI decorates non-fitting cards
  // with a "Needs N GB VRAM" warning. In Runnable mode we keep fit-first
  // ranking so the top recommendations are actually installable.
  if (options.includeOversized) {
    return baseFiltered
      .sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        const aScore = signalScore(a.candidate);
        const bScore = signalScore(b.candidate);
        if (aScore !== bScore) return bScore - aScore;
        // Size desc as the tiebreaker — shows off the ceiling.
        return b.candidate.vramRequiredMB - a.candidate.vramRequiredMB;
      })
      .slice(0, limit);
  }

  return baseFiltered
    .sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (a.fit !== b.fit) return fitOrder[a.fit] - fitOrder[b.fit];
      // Community signal wins next — fresh trending models rank above
      // curated fallbacks with no downloads data.
      const aScore = signalScore(a.candidate);
      const bScore = signalScore(b.candidate);
      if (aScore !== bScore) return bScore - aScore;
      // Then storage status — ample is preferred, but needs-cleanup still
      // appears in the result set, just lower.
      const aStor = storageOrder[a.storage.status];
      const bStor = storageOrder[b.storage.status];
      if (aStor !== bStor) return aStor - bStor;
      // Final tiebreaker: larger model = better quality at equal fit.
      return b.candidate.vramRequiredMB - a.candidate.vramRequiredMB;
    })
    .slice(0, limit);
}

/** Combine HF downloads + likes + leaderboard + buzz into a single rank score. */
function signalScore(c: LocalCandidate): number {
  const downloads = Math.log10((c.downloads ?? 0) + 1) * 10;
  const likes = (c.likes ?? 0) * 0.1;
  const leaderboard = (c.leaderboardScore ?? 0) * 0.5;
  const buzz = (c.buzzScore ?? 0) * 0.3;
  return downloads + likes + leaderboard + buzz;
}

/** All candidates — for debugging / full-matrix rendering. */
export function allCandidates(): LocalCandidate[] {
  return CANDIDATES;
}

// -- helpers ---------------------------------------------------------------

function c(
  id: string,
  displayName: string,
  modality: Modality,
  providerId: string,
  rest: Omit<LocalCandidate, "id" | "displayName" | "modality" | "providerId">,
): LocalCandidate {
  return { id, displayName, modality, providerId, ...rest };
}
