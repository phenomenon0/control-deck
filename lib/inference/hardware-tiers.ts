/**
 * Hardware-tier voice bundles.
 *
 * Three named tiers, each describing a complete voice-assistant stack tuned
 * for one class of hardware. Layered on top of the per-modality preset system
 * in `local-defaults.ts` — picking a tier auto-binds STT/TTS/text slots to a
 * coherent set of models the user can pull with one click.
 *
 * Each tier exposes:
 *   - `cascade`: a STT → text → TTS pipeline (the install default — the most
 *     stable and tool-friendly path)
 *   - `omni` (optional): a single speech-to-speech model for the lowest
 *     end-to-end latency feel, when hardware allows
 *
 * Tier choice is orthogonal to the existing quick/balanced/quality preset.
 * The preset answers "how much quality do you want for a given hardware?".
 * The tier answers "which hardware are you on?". Picking a tier sets a
 * sensible default preset, but the user can still override.
 *
 * `recommendTier(...)` returns the best tier for a given system profile, used
 * by the UI to pre-highlight a card.
 */

import type { GpuInfo, InferenceBackend } from "@/lib/system/detect";
import type { LocalModelDefault } from "./local-defaults";

export type TierId = "T1_MAC" | "T2_CUDA" | "T3_CPU";

export interface TierLaneCascade {
  stt: LocalModelDefault & { id: string };
  tts: LocalModelDefault & { id: string };
  llm: LocalModelDefault & { id: string };
}

export interface TierLaneOmni {
  /** Stable id used by the omni provider (e.g. `qwen-omni-local`, `moshi-7b`). */
  engineId: string;
  /** Human label shown on the card. */
  label: string;
  /** Sidecar that hosts this engine — `qwen-omni` (existing) or `voice-engines` (new). */
  sidecar: "qwen-omni" | "voice-engines";
  /** Model identifier the sidecar's `/pull` endpoint understands (HF repo id usually). */
  modelId: string;
  /** Rough disk footprint, MB. */
  sizeMb: number;
  /** One-line note rendered under the omni toggle. */
  note: string;
}

export interface TierBundle {
  id: TierId;
  label: string;
  /** Short hardware-match line shown under the title. */
  hardwareMatch: string;
  /** Long-form rationale shown on hover / in the side panel. */
  rationale: string;
  cascade: TierLaneCascade;
  omni?: TierLaneOmni;
  /** Preset that maps best to this tier, used to seed `LocalModelsPanel`. */
  defaultPreset: "quick" | "balanced" | "quality";
  /**
   * Predicate over a system profile. Highest-scoring tier is recommended;
   * ties broken by tier order (Mac > CUDA > CPU). Returns 0 = no match,
   * higher = stronger fit. Callers don't see this directly — use
   * `recommendTier(...)` instead.
   */
  fits(input: { backend: InferenceBackend; gpu: GpuInfo | null; ramGb: number }): number;
}

// ---------------------------------------------------------------------------
// Model identifiers introduced by the tiered system.
//
// These ids must agree with the ones the new `voice-engines-sidecar.py`
// understands (see `scripts/voice-engines-sidecar.py`). Keep in sync.

export const VOICE_ENGINE_IDS = {
  // STT
  WHISPER_TURBO_CPP: "whisper-large-v3-turbo-cpp", // whisper.cpp Metal/CoreML on Mac
  PARAKEET_TDT_V2: "parakeet-tdt-0.6b-v2",         // NeMo CUDA
  MOONSHINE_TINY: "moonshine-tiny",                // ONNX, CPU-streaming
  // TTS
  KOKORO_82M: "kokoro-82m",                        // Apache 2.0, all tiers
  ORPHEUS_3B: "orpheus-3b",                        // expressive, CUDA-only
  // Omni
  MOSHI_7B_INT4: "moshi-7b-int4",                  // MLX, Mac
  QWEN_OMNI_7B_AWQ: "qwen2.5-omni-7b-awq",         // existing qwen-omni-sidecar
} as const;

export type VoiceEngineId = (typeof VOICE_ENGINE_IDS)[keyof typeof VOICE_ENGINE_IDS];

/** Model ids served by the new in-repo voice-engines-sidecar (port 9101). */
export const VOICE_ENGINES_SIDECAR_IDS: ReadonlySet<string> = new Set([
  VOICE_ENGINE_IDS.WHISPER_TURBO_CPP,
  VOICE_ENGINE_IDS.PARAKEET_TDT_V2,
  VOICE_ENGINE_IDS.MOONSHINE_TINY,
  VOICE_ENGINE_IDS.KOKORO_82M,
  VOICE_ENGINE_IDS.ORPHEUS_3B,
  VOICE_ENGINE_IDS.MOSHI_7B_INT4,
]);

// ---------------------------------------------------------------------------

export const HARDWARE_TIERS: Record<TierId, TierBundle> = {
  T1_MAC: {
    id: "T1_MAC",
    label: "Mac M1–M4",
    hardwareMatch: "Apple Silicon · ≥16 GB unified memory",
    rationale:
      "Whisper-turbo runs on the Apple Neural Engine via whisper.cpp + CoreML, " +
      "so STT cost is near-zero. Kokoro is the smallest natural-sounding TTS in " +
      "the open-source ladder. Optional Moshi omni gives full-duplex feel.",
    defaultPreset: "balanced",
    cascade: {
      stt: {
        runner: "voice-sidecar",
        id: VOICE_ENGINE_IDS.WHISPER_TURBO_CPP,
        label: "Whisper large-v3-turbo (whisper.cpp)",
        sizeMb: 1600,
        expectedP50Ms: 180,
        note: "ANE-accelerated via CoreML. ~50× realtime on M-series.",
      },
      tts: {
        runner: "voice-sidecar",
        id: VOICE_ENGINE_IDS.KOKORO_82M,
        label: "Kokoro 82M",
        sizeMb: 330,
        expectedP50Ms: 180,
        note: "Apache-2.0. ~150 ms first chunk. 50+ baked voices.",
      },
      llm: {
        runner: "ollama",
        id: "qwen3:8b",
        label: "Qwen3 8B",
        sizeMb: 5200,
        expectedP50Ms: 400,
        note: "Default text brain — strong open-weight chat + tool use.",
      },
    },
    omni: {
      engineId: "moshi-mlx",
      label: "Moshi 7B (int4 / MLX)",
      sidecar: "voice-engines",
      modelId: VOICE_ENGINE_IDS.MOSHI_7B_INT4,
      sizeMb: 4200,
      note: "Full-duplex S2S, ~200 ms TTFA on M-series. CC-BY-4.0.",
    },
    fits({ backend, ramGb }) {
      if (backend === "metal" && ramGb >= 14) return 100;
      if (backend === "metal") return 60; // 8 GB Mac — works but tight
      return 0;
    },
  },

  T2_CUDA: {
    id: "T2_CUDA",
    label: "NVIDIA GPU",
    hardwareMatch: "CUDA · ≥12 GB VRAM (RTX 4060 Ti / 4070 / 5070-class)",
    rationale:
      "Parakeet TDT is the current Open-ASR-Leaderboard leader at 600 M params " +
      "and ~RTF 0.06 on a single mid-range NVIDIA card. Kokoro covers the daily " +
      "TTS, Orpheus is a one-toggle upgrade for expressive output. Optional " +
      "Qwen2.5-Omni-7B (already in-repo) supplies the omni lane.",
    defaultPreset: "quality",
    cascade: {
      stt: {
        runner: "voice-sidecar",
        id: VOICE_ENGINE_IDS.PARAKEET_TDT_V2,
        label: "NVIDIA Parakeet TDT 0.6B v2",
        sizeMb: 1300,
        expectedP50Ms: 90,
        note: "Open ASR Leaderboard #1, streaming, ~1.5 GB VRAM.",
      },
      tts: {
        runner: "voice-sidecar",
        id: VOICE_ENGINE_IDS.KOKORO_82M,
        label: "Kokoro 82M (toggle Orpheus 3B for expressive)",
        sizeMb: 330,
        expectedP50Ms: 90,
        note: "<100 ms first chunk on CUDA. Orpheus 3B available as upgrade.",
      },
      llm: {
        runner: "ollama",
        id: "qwen3.5:9b-q4_K_M",
        label: "Qwen3.5 9B (Q4_K_M)",
        sizeMb: 6600,
        expectedP50Ms: 300,
        note: "Top open-weight reasoning in the 8–10 B range.",
      },
    },
    omni: {
      engineId: "qwen-omni-local",
      label: "Qwen2.5-Omni 7B (AWQ, in-repo sidecar)",
      sidecar: "qwen-omni",
      modelId: VOICE_ENGINE_IDS.QWEN_OMNI_7B_AWQ,
      sizeMb: 10240,
      note: "Single S2S model. ~300 ms TTFA. Apache-2.0.",
    },
    fits({ backend, gpu }) {
      if (backend !== "cuda" || !gpu) return 0;
      if (gpu.vram >= 12000) return 100;
      if (gpu.vram >= 8000) return 70; // 8 GB cards still run cascade fine
      return 30;
    },
  },

  T3_CPU: {
    id: "T3_CPU",
    label: "Consumer · CPU",
    hardwareMatch: "No usable dGPU · 16 GB RAM",
    rationale:
      "End-to-end omni doesn't run on CPU at conversational latency — this tier " +
      "is cascade-only. Moonshine-Tiny is purpose-built for CPU streaming ASR; " +
      "Kokoro ONNX runs in ~400 ms first chunk on a modern laptop. Llama-3.2-3B " +
      "is the LLM ceiling that still feels responsive.",
    defaultPreset: "quick",
    cascade: {
      stt: {
        runner: "voice-sidecar",
        id: VOICE_ENGINE_IDS.MOONSHINE_TINY,
        label: "Moonshine-Tiny (ONNX, CPU)",
        sizeMb: 200,
        expectedP50Ms: 60,
        note: "Apache-2.0, ~60 ms first partial on laptop CPUs, true streaming.",
      },
      tts: {
        runner: "voice-sidecar",
        id: VOICE_ENGINE_IDS.KOKORO_82M,
        label: "Kokoro 82M (ONNX, CPU)",
        sizeMb: 330,
        expectedP50Ms: 450,
        note: "~400–600 ms first chunk on CPU. Tolerable for short turns.",
      },
      llm: {
        runner: "ollama",
        id: "llama3.2:3b",
        label: "Llama 3.2 3B",
        sizeMb: 2000,
        expectedP50Ms: 350,
        note: "Privacy-first ceiling — 5–20 tok/s on a modern laptop CPU.",
      },
    },
    // No omni — S2S models are not feasible at this hardware level.
    fits({ backend, gpu, ramGb }) {
      if (ramGb < 8) return 0;
      if (backend === "cpu") return 100;
      // Catch-all: if Mac/CUDA tiers don't fit, this still works.
      if (gpu && gpu.vram < 4000) return 80;
      return 20;
    },
  },
};

export function tierList(): TierBundle[] {
  return [HARDWARE_TIERS.T1_MAC, HARDWARE_TIERS.T2_CUDA, HARDWARE_TIERS.T3_CPU];
}

export function getTier(id: TierId): TierBundle {
  return HARDWARE_TIERS[id];
}

export interface TierRecommendation {
  best: TierId;
  scores: Record<TierId, number>;
}

/**
 * Pick the best tier for a hardware profile.
 *
 * Returns both the winning tier and the per-tier scores so the UI can render
 * "primary recommendation + viable alternates" without re-running the logic.
 */
export function recommendTier(input: {
  backend: InferenceBackend;
  gpu: GpuInfo | null;
  ramGb: number;
}): TierRecommendation {
  const scores = {
    T1_MAC: HARDWARE_TIERS.T1_MAC.fits(input),
    T2_CUDA: HARDWARE_TIERS.T2_CUDA.fits(input),
    T3_CPU: HARDWARE_TIERS.T3_CPU.fits(input),
  } satisfies Record<TierId, number>;

  // Pick highest score; ties broken by Mac > CUDA > CPU (the order in tierList).
  let best: TierId = "T3_CPU";
  let bestScore = -1;
  for (const tier of tierList()) {
    const s = scores[tier.id];
    if (s > bestScore) {
      bestScore = s;
      best = tier.id;
    }
  }
  return { best, scores };
}

/**
 * Total disk required to install a tier (cascade only by default; pass
 * `includeOmni: true` to add the omni lane).
 */
export function tierDiskMb(tier: TierBundle, opts: { includeOmni?: boolean } = {}): number {
  const cascade =
    (tier.cascade.stt.sizeMb ?? 0) +
    (tier.cascade.tts.sizeMb ?? 0) +
    (tier.cascade.llm.sizeMb ?? 0);
  if (opts.includeOmni && tier.omni) return cascade + tier.omni.sizeMb;
  return cascade;
}
