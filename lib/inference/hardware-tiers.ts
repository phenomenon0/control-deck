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
import { QWEN_OMNI_MODEL_ID } from "./omni/local";

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
  /** Sidecar that hosts this engine. */
  sidecar: "qwen-omni";
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

const S2S_STT_LANE: LocalModelDefault & { id: string } = {
  runner: "s2s",
  id: "s2s-realtime-stt",
  label: "Realtime S2S transcription",
  sizeMb: null,
  expectedP50Ms: null,
  note: "Provided by the speech-to-speech realtime pool.",
};

const S2S_TTS_LANE: LocalModelDefault & { id: string } = {
  runner: "s2s",
  id: "s2s-realtime-tts",
  label: "Realtime S2S speech output",
  sizeMb: null,
  expectedP50Ms: null,
  note: "Provided by the speech-to-speech realtime pool.",
};

// ---------------------------------------------------------------------------

export const HARDWARE_TIERS: Record<TierId, TierBundle> = {
  T1_MAC: {
    id: "T1_MAC",
    label: "Mac M1–M4",
    hardwareMatch: "Apple Silicon · ≥16 GB unified memory",
    rationale:
      "Realtime local voice is handled by the s2s pool. This tier pairs it " +
      "with a compact local text model that fits Apple Silicon comfortably.",
    defaultPreset: "balanced",
    cascade: {
      stt: S2S_STT_LANE,
      tts: S2S_TTS_LANE,
      llm: {
        runner: "ollama",
        id: "qwen3:8b",
        label: "Qwen3 8B",
        sizeMb: 5200,
        expectedP50Ms: 400,
        note: "Default text brain — strong open-weight chat + tool use.",
      },
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
      "Realtime local voice is handled by the s2s pool. Optional " +
      "Qwen2.5-Omni-7B supplies the single-model speech lane when the GPU " +
      "has enough VRAM.",
    defaultPreset: "quality",
    cascade: {
      stt: S2S_STT_LANE,
      tts: S2S_TTS_LANE,
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
      modelId: QWEN_OMNI_MODEL_ID,
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
      "End-to-end omni doesn't run on CPU at conversational latency, so this " +
      "tier relies on the realtime s2s pool for voice and keeps the local LLM small.",
    defaultPreset: "quick",
    cascade: {
      stt: S2S_STT_LANE,
      tts: S2S_TTS_LANE,
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
