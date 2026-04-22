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
}

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
}

/* ============================================================================
 * Curated CANDIDATES — 2026-Q2 snapshot
 * ========================================================================== */

// -- Text ------------------------------------------------------------------

const TEXT_CANDIDATES: LocalCandidate[] = [
  c("llama3.2:1b", "Llama 3.2 1B", "text", "ollama", {
    ollamaTag: "llama3.2:1b", vramRequiredMB: 1300, diskMB: 1300,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "llama",
    license: "llama-3",
    summary: "Tiny draft / routing model. Runs on any machine with 2 GB free.",
  }),
  c("llama3.2:3b", "Llama 3.2 3B", "text", "ollama", {
    ollamaTag: "llama3.2:3b", vramRequiredMB: 2000, diskMB: 2000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "rocm", "cpu"], family: "llama",
    license: "llama-3",
    summary: "Laptop-friendly general chat. Usable on CPU, snappy on GPU.",
  }),
  c("gemma3:4b", "Gemma 3 4B", "text", "ollama", {
    ollamaTag: "gemma3:4b", vramRequiredMB: 2500, diskMB: 2500,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: true,
    backends: ["metal", "cuda", "cpu"], family: "gemma", license: "gemma",
    summary: "Google Gemma 3 tier. Strong multilingual for its size.",
  }),
  c("qwen2.5:7b", "Qwen 2.5 7B", "text", "ollama", {
    ollamaTag: "qwen2.5:7b", vramRequiredMB: 4700, diskMB: 4700,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "qwen", license: "qwen",
    summary: "Reliable 7B workhorse. Good balance of quality vs speed.",
  }),
  c("qwen2.5-coder:7b", "Qwen 2.5 Coder 7B", "text", "ollama", {
    ollamaTag: "qwen2.5-coder:7b", vramRequiredMB: 4700, diskMB: 4700,
    quantization: "Q4_K_M", contextWindow: 32000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "qwen", license: "qwen",
    summary: "Code-specialised 7B. Best local model for inline code edits.",
  }),
  c("llama3.1:8b", "Llama 3.1 8B", "text", "ollama", {
    ollamaTag: "llama3.1:8b", vramRequiredMB: 5200, diskMB: 5200,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "llama", license: "llama-3",
    summary: "Meta's 8B. Robust general-purpose; widely supported tooling.",
  }),
  c("mistral-nemo:12b", "Mistral Nemo 12B", "text", "ollama", {
    ollamaTag: "mistral-nemo:12b", vramRequiredMB: 7100, diskMB: 7100,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda", "rocm"], family: "mistral", license: "apache-2.0",
    summary: "Nemo 12B — Mistral's workhorse. Wide tool support, apache licence.",
  }),
  c("gemma3:12b", "Gemma 3 12B", "text", "ollama", {
    ollamaTag: "gemma3:12b", vramRequiredMB: 7200, diskMB: 7200,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "gemma", license: "gemma",
    summary: "Gemma 3 at 12B. Strong multilingual + vision capable at 27B tier.",
  }),
  c("phi-4:14b", "Phi 4 14B", "text", "ollama", {
    ollamaTag: "phi-4:14b", vramRequiredMB: 9000, diskMB: 9000,
    quantization: "Q4_K_M", contextWindow: 16000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "phi", license: "mit",
    summary: "Microsoft Phi 4. Excellent reasoning for 14B; MIT licensed.",
  }),
  c("qwen2.5:14b", "Qwen 2.5 14B", "text", "ollama", {
    ollamaTag: "qwen2.5:14b", vramRequiredMB: 9000, diskMB: 9000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 14B — smart generalist, 128k context.",
  }),
  c("llama4:16b", "Llama 4 16B", "text", "ollama", {
    ollamaTag: "llama4:16b", vramRequiredMB: 10500, diskMB: 10500,
    quantization: "Q4_K_M", contextWindow: 1048576, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "llama", license: "llama-4",
    summary: "Llama 4 16B — 1M-token context, 2026 release.",
  }),
  c("mistral-small:24b", "Mistral Small 24B", "text", "ollama", {
    ollamaTag: "mistral-small:24b", vramRequiredMB: 14000, diskMB: 14000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "mistral", license: "apache-2.0",
    summary: "Mistral Small 24B. Hits GPT-4o-mini quality on benchmarks.",
  }),
  c("gemma3:27b", "Gemma 3 27B", "text", "ollama", {
    ollamaTag: "gemma3:27b", vramRequiredMB: 16000, diskMB: 16000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "gemma", license: "gemma",
    summary: "Gemma 3 flagship. Single-GPU-friendly quality ceiling.",
  }),
  c("qwq:32b", "QwQ 32B", "text", "ollama", {
    ollamaTag: "qwq:32b", vramRequiredMB: 20000, diskMB: 20000,
    quantization: "Q4_K_M", contextWindow: 32000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "Qwen reasoning model. Chain-of-thought open alternative to o-series.",
  }),
  c("qwen2.5:32b", "Qwen 2.5 32B", "text", "ollama", {
    ollamaTag: "qwen2.5:32b", vramRequiredMB: 20000, diskMB: 20000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 32B — strong all-rounder when you have 24 GB VRAM.",
  }),
  c("mixtral:8x7b", "Mixtral 8x7B MoE", "text", "ollama", {
    ollamaTag: "mixtral:8x7b", vramRequiredMB: 26000, diskMB: 26000,
    quantization: "Q4_K_M", contextWindow: 32000, cpuFriendly: false,
    backends: ["metal", "cuda"], family: "mistral", license: "apache-2.0",
    summary: "Sparse MoE — 13B active, 47B total. Fast inference for the size.",
  }),
  c("llama3.3:70b", "Llama 3.3 70B", "text", "ollama", {
    ollamaTag: "llama3.3:70b", vramRequiredMB: 40000, diskMB: 40000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["cuda"], family: "llama", license: "llama-3",
    summary: "Meta's 70B tier. Needs 48 GB+ VRAM realistically.",
  }),
  c("llama4:70b", "Llama 4 70B", "text", "ollama", {
    ollamaTag: "llama4:70b", vramRequiredMB: 40000, diskMB: 40000,
    quantization: "Q4_K_M", contextWindow: 1048576, cpuFriendly: false,
    backends: ["cuda"], family: "llama", license: "llama-4",
    summary: "Llama 4 flagship. 1M context at 70B tier.",
  }),
  c("qwen2.5:72b", "Qwen 2.5 72B", "text", "ollama", {
    ollamaTag: "qwen2.5:72b", vramRequiredMB: 47000, diskMB: 47000,
    quantization: "Q4_K_M", contextWindow: 128000, cpuFriendly: false,
    backends: ["cuda"], family: "qwen", license: "qwen",
    summary: "Qwen 72B — multilingual 70B-tier competitor.",
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
];

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

  // Storage filter — if we know free disk and the candidate would exceed it.
  if (profile.storage && candidate.diskMB > profile.storage.freeGb * 1024 - 2048) {
    return { fit: "too-big", fillRatio: Number.POSITIVE_INFINITY };
  }

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
  if (fit === "too-big") return "Exceeds this machine's capacity.";
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

export function suggestForModality(
  profile: SystemProfile,
  installed: Array<{ name: string }>,
  modality: Modality,
  limit = 8,
): LocalSuggestion[] {
  const bucket = CANDIDATES.filter((c) => c.modality === modality);
  const scored = bucket.map((candidate) => {
    const { fit, fillRatio } = scoreFit(profile, candidate);
    const isIn = isInstalled(candidate, installed);
    return {
      candidate,
      fit,
      fillRatio,
      installed: isIn,
      reasoning: reasoningFor(profile, candidate, fit, fillRatio, isIn),
      installCommand: installCommandFor(candidate),
    } satisfies LocalSuggestion;
  });

  // Filter out too-big entries. Sort: installed first, then fit quality,
  // then highest VRAM within fit bucket (= best quality that still fits).
  const fitOrder: Record<FitScore, number> = {
    perfect: 0,
    tight: 1,
    "overhead-risk": 2,
    "too-big": 3,
  };
  return scored
    .filter((s) => s.fit !== "too-big")
    .sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (a.fit !== b.fit) return fitOrder[a.fit] - fitOrder[b.fit];
      // Within the same bucket, prefer larger models (= higher quality).
      return b.candidate.vramRequiredMB - a.candidate.vramRequiredMB;
    })
    .slice(0, limit);
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
