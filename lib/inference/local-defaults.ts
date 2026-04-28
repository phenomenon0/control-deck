/**
 * Per-modality local-first defaults.
 *
 * One recommended local model per modality, per preset (quick/balanced/quality).
 * Consumed by:
 *   - `/api/local-models/status` — tells the UI what's installed, what the
 *     recommended default is, and whether the app can pull it from here.
 *   - The Models pane — shows per-modality rows with a "Pull default" button
 *     and a preset switcher.
 *
 * This is a pure data file. No runtime side effects. Update when a better
 * local checkpoint ships for a modality or when hardware targets shift.
 *
 * ## Runner types
 * - `ollama` — pullable from this app via POST /api/ollama/tags. Status
 *   comes from /api/ollama/ps + /api/ollama/tags (GET).
 * - `voice-sidecar` — engines hosted by the in-repo voice-core service
 *   (port 4245). The app can't pull these directly; it reports whether the
 *   sidecar is up and whether the engine is the one the resolver picked.
 * - `unavailable` — no local runner wired up today. The UI should show the
 *   modality greyed with a "cloud-only for now" hint.
 */

import type { Modality } from "./types";

export type LocalRunner = "ollama" | "voice-sidecar" | "unavailable";

export type LocalPreset = "quick" | "balanced" | "quality";

export interface LocalModelDefault {
  /** Runner that owns the lifecycle (pull + load + invoke). */
  runner: LocalRunner;
  /**
   * Identifier the runner understands. For `ollama` this is the tag you'd
   * hand to `ollama pull` (e.g. `llama3.2:3b`). For `voice-sidecar` this is
   * the engine id the sidecar advertises. Null when runner is `unavailable`.
   */
  id: string | null;
  /** Short human label for the UI. */
  label: string;
  /** Rough disk footprint, in MB. Hand-measured; revise when it drifts. */
  sizeMb: number | null;
  /**
   * Expected p50 latency on a laptop-class machine (M-series / RTX 3060 tier).
   * Used to sketch the trade-off between presets in the UI; real numbers
   * always override once `lib/inference/metrics.ts` has measured them.
   */
  expectedP50Ms: number | null;
  /** One-sentence note on what makes this the pick for this preset. */
  note: string;
}

/** What the UI renders per modality row. */
export interface LocalModalityEntry {
  modality: Modality;
  /** Human label shown as the row heading. */
  name: string;
  /** Short description of why this modality matters. */
  description: string;
  /** Recommended defaults, one per preset. */
  defaults: Record<LocalPreset, LocalModelDefault>;
}

/**
 * The manifest. Keep `quick` small enough to run on a laptop with no GPU,
 * `quality` large enough to feel competitive with cloud, `balanced` as the
 * first-run default.
 */
export const LOCAL_DEFAULTS: Record<Modality, LocalModalityEntry> = {
  text: {
    modality: "text",
    name: "Text",
    description: "Chat + reasoning LLMs",
    defaults: {
      quick: {
        runner: "ollama",
        id: "llama3.2:1b",
        label: "Llama 3.2 1B",
        sizeMb: 1300,
        expectedP50Ms: 180,
        note: "Fits in ~2GB. Handles short chat turns fast; loses coherence on long reasoning.",
      },
      balanced: {
        runner: "ollama",
        id: "qwen3:8b",
        label: "Qwen3 8B",
        sizeMb: 5200,
        expectedP50Ms: 400,
        note: "Strong open-weight chat + tool-use. Competitive with Llama 3.1 8B, better on code.",
      },
      quality: {
        runner: "ollama",
        id: "qwen3.5:9b-q4_K_M",
        label: "Qwen3.5 9B (Q4_K_M)",
        sizeMb: 6600,
        expectedP50Ms: 650,
        note: "Top open-weight reasoning model in the 8–10B range. Needs ~8GB VRAM or fast CPU.",
      },
    },
  },

  vision: {
    modality: "vision",
    name: "Vision",
    description: "Image understanding + multimodal reasoning",
    defaults: {
      quick: {
        runner: "ollama",
        id: "minicpm-v",
        label: "MiniCPM-V",
        sizeMb: 5500,
        expectedP50Ms: 600,
        note: "Compact multimodal. Fast OCR + scene Q&A; good balance for quick vision tasks.",
      },
      balanced: {
        runner: "ollama",
        id: "qwen2.5vl:7b",
        label: "Qwen2.5-VL 7B",
        sizeMb: 6000,
        expectedP50Ms: 900,
        note: "Strong on documents, UI screenshots, and fine-grained grounding. Current sweet spot.",
      },
      quality: {
        runner: "ollama",
        id: "qwen2.5vl:7b",
        label: "Qwen2.5-VL 7B",
        sizeMb: 6000,
        expectedP50Ms: 900,
        note: "Same as balanced until a 32B/72B pull is on disk. Swap to qwen2.5vl:32b for SOTA.",
      },
    },
  },

  embedding: {
    modality: "embedding",
    name: "Embeddings",
    description: "Semantic search + retrieval",
    defaults: {
      quick: {
        runner: "ollama",
        id: "all-minilm",
        label: "all-MiniLM",
        sizeMb: 46,
        expectedP50Ms: 30,
        note: "Tiny + very fast. Good enough for most in-app retrieval.",
      },
      balanced: {
        runner: "ollama",
        id: "nomic-embed-text",
        label: "Nomic Embed Text",
        sizeMb: 274,
        expectedP50Ms: 60,
        note: "Strong open-weight default; matches or beats OpenAI ada on most benchmarks.",
      },
      quality: {
        runner: "ollama",
        id: "mxbai-embed-large",
        label: "MixedBread Embed Large",
        sizeMb: 670,
        expectedP50Ms: 120,
        note: "Larger embeddings, better separation; worth it for bigger corpora.",
      },
    },
  },

  stt: {
    modality: "stt",
    name: "Speech-to-text",
    description: "Transcribing the user's microphone",
    defaults: {
      quick: {
        runner: "voice-sidecar",
        id: "sherpa-onnx-streaming",
        label: "sherpa-onnx streaming (Zipformer EN)",
        sizeMb: 320,
        expectedP50Ms: 90,
        note: "Endpoint-aware streaming transducer. Reliable on CPU; default for laptops.",
      },
      balanced: {
        runner: "voice-sidecar",
        id: "sherpa-onnx-streaming",
        label: "sherpa-onnx streaming",
        sizeMb: 350,
        expectedP50Ms: 90,
        note: "Endpoint-aware streaming transducer. Strong for live partials on CPU/CUDA.",
      },
      quality: {
        runner: "voice-sidecar",
        id: "parakeet-tdt-0.6b-v2",
        label: "NVIDIA Parakeet TDT 0.6B v2",
        sizeMb: 1300,
        expectedP50Ms: 90,
        note: "Open-ASR-Leaderboard #1 (CUDA). Used as final-correction pass.",
      },
    },
  },

  tts: {
    modality: "tts",
    name: "Text-to-speech",
    description: "Speaking back to the user",
    defaults: {
      quick: {
        runner: "voice-sidecar",
        id: "sherpa-onnx-tts",
        label: "sherpa-onnx VITS",
        sizeMb: 90,
        expectedP50Ms: 80,
        note: "Lightweight VITS via sherpa-onnx. Robotic but instant.",
      },
      balanced: {
        runner: "voice-sidecar",
        id: "sherpa-onnx-tts",
        label: "sherpa-onnx VITS (Piper amy-medium)",
        sizeMb: 90,
        expectedP50Ms: 180,
        note: "Default — clear English voice, runs on CPU, ~180 ms first chunk.",
      },
      quality: {
        runner: "voice-sidecar",
        id: "chatterbox",
        label: "Chatterbox (expressive)",
        sizeMb: 1200,
        expectedP50Ms: 350,
        note: "Expressive prosody for longer narration turns. Lazy-loads on first request.",
      },
    },
  },

  // Local-only rerankers aren't plugged in yet. `bge-reranker` variants work
  // via an HF Transformers runner, but we don't run one today. Show the row
  // so the user can see the gap, even if we can't fill it from here yet.
  rerank: {
    modality: "rerank",
    name: "Rerank",
    description: "Re-ordering retrieval candidates",
    defaults: {
      quick: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local reranker runner wired up yet. Cloud rerank still works.",
      },
      balanced: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local reranker runner wired up yet. Cloud rerank still works.",
      },
      quality: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local reranker runner wired up yet. Cloud rerank still works.",
      },
    },
  },

  "image-gen": {
    modality: "image-gen",
    name: "Image generation",
    description: "Text-to-image, inpainting",
    defaults: {
      quick: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local SDXL/Flux runner wired up yet. Route to cloud providers.",
      },
      balanced: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local SDXL/Flux runner wired up yet. Route to cloud providers.",
      },
      quality: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local SDXL/Flux runner wired up yet. Route to cloud providers.",
      },
    },
  },

  "audio-gen": {
    modality: "audio-gen",
    name: "Music / SFX",
    description: "Music + sound-effect synthesis",
    defaults: {
      quick: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local audio-gen runner wired up yet.",
      },
      balanced: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local audio-gen runner wired up yet.",
      },
      quality: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local audio-gen runner wired up yet.",
      },
    },
  },

  "video-gen": {
    modality: "video-gen",
    name: "Video generation",
    description: "Text-to-video, image-to-video",
    defaults: {
      quick: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local video-gen runner wired up yet.",
      },
      balanced: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local video-gen runner wired up yet.",
      },
      quality: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local video-gen runner wired up yet.",
      },
    },
  },

  "3d-gen": {
    modality: "3d-gen",
    name: "3D generation",
    description: "Text-to-3D, image-to-3D",
    defaults: {
      quick: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local 3d-gen runner wired up yet.",
      },
      balanced: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local 3d-gen runner wired up yet.",
      },
      quality: {
        runner: "unavailable",
        id: null,
        label: "—",
        sizeMb: null,
        expectedP50Ms: null,
        note: "No local 3d-gen runner wired up yet.",
      },
    },
  },
};

/** Modalities we actually have a local runner for today. */
export function modalitiesWithLocalRunner(): Modality[] {
  return (Object.keys(LOCAL_DEFAULTS) as Modality[]).filter((m) => {
    const entry = LOCAL_DEFAULTS[m];
    return entry.defaults.balanced.runner !== "unavailable";
  });
}

/** Pulls the default for a modality at a given preset. */
export function defaultFor(modality: Modality, preset: LocalPreset): LocalModelDefault {
  return LOCAL_DEFAULTS[modality].defaults[preset];
}
