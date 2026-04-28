/**
 * Speech-to-text providers. Mirrors the tts register pattern: voice-core is
 * the local sidecar default; cloud providers are opt-in via env.
 *
 * Env vars:
 *   STT_PROVIDER         voice-core | openai | groq | deepgram | cartesia | assemblyai
 *                        (default: voice-core)
 *   STT_MODEL            default engine id (e.g. moonshine-tiny)
 *   STT_LANGUAGE         optional BCP-47 hint
 *   GROQ_API_KEY         required for groq
 *   DEEPGRAM_API_KEY     required for deepgram
 *   OPENAI_API_KEY       reused from text slot, required for openai
 *   CARTESIA_API_KEY     required for cartesia ink-whisper
 *   ASSEMBLYAI_API_KEY   required for assemblyai universal-3
 */

import { registerProvider, getProvider } from "../registry";
import { bindSlot } from "../runtime";
import type { InferenceProvider, Modality } from "../types";

interface ProviderSeed {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseURL?: string;
  defaultModels: string[];
}

const SEEDS: ProviderSeed[] = [
  {
    id: "voice-core",
    name: "voice-core (local sidecar)",
    description:
      "Local STT engines hosted by voice-core (port 4245). Includes Moonshine " +
      "(CPU streaming), whisper.cpp (Mac/Metal), Parakeet (CUDA), sherpa-onnx " +
      "streaming, and faster-whisper for final correction.",
    requiresApiKey: false,
    defaultBaseURL: process.env.VOICE_CORE_URL ?? "http://127.0.0.1:4245",
    defaultModels: [
      "sherpa-onnx-streaming",
      "moonshine-tiny",
      "whisper-large-v3-turbo-cpp",
      "parakeet-tdt-0.6b-v2",
      "faster-whisper",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "gpt-4o-transcribe (~2.46% WER — accuracy leader)",
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
  },
  {
    id: "groq",
    name: "Groq",
    description: "Whisper-large-v3-turbo at $0.04/hr — cheapest batch",
    requiresApiKey: true,
    defaultBaseURL: "https://api.groq.com/openai/v1",
    defaultModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
  },
  {
    id: "deepgram",
    name: "Deepgram",
    description: "Nova-3 — strong diarization + streaming",
    requiresApiKey: true,
    defaultBaseURL: "https://api.deepgram.com/v1",
    defaultModels: ["nova-3", "nova-2"],
  },
  {
    id: "cartesia",
    name: "Cartesia",
    description: "Ink-Whisper — voice-agent-tuned streaming, dynamic chunking",
    requiresApiKey: true,
    defaultBaseURL: "https://api.cartesia.ai",
    defaultModels: ["ink-whisper"],
  },
  {
    id: "assemblyai",
    name: "AssemblyAI",
    description: "Universal-3 Pro — 1.52% WER on LibriSpeech (Mar 2026), ~150ms first-partial",
    requiresApiKey: true,
    defaultBaseURL: "https://api.assemblyai.com/v2",
    defaultModels: ["universal-3-pro", "universal-3", "universal-2"],
  },
];

let registered = false;

export function registerSttProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "stt");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), stt: seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  // Bind default slot from env so the STT route has a provider even before
  // the Settings UI writes one.
  const providerEnv = (process.env.STT_PROVIDER ?? "voice-core").toLowerCase();
  if (SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "stt",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.STT_MODEL,
        extras: {
          language: process.env.STT_LANGUAGE,
        },
      },
    });
  }
}

function mergeModalities(
  prior: Modality[] | undefined,
  adding: Modality,
): Modality[] {
  const set = new Set<Modality>(prior ?? []);
  set.add(adding);
  return [...set];
}
