/**
 * Speech-to-text providers. Mirrors the tts register pattern: preserves
 * the existing VOICE_API_URL sidecar as the default, offers cloud
 * alternates for users who want Groq's free-tier Whisper-large-v3-turbo or
 * Deepgram's Nova for low-latency streaming-style transcription.
 *
 * Env vars:
 *   STT_PROVIDER      voice-api | openai | groq | deepgram
 *                     (default: voice-api — zero regression)
 *   STT_MODEL         default model id
 *   STT_LANGUAGE      optional BCP-47 hint for all requests
 *   GROQ_API_KEY      required for groq
 *   DEEPGRAM_API_KEY  required for deepgram
 *   OPENAI_API_KEY    reused from text slot, required for openai
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
    id: "voice-api",
    name: "Voice API (local sidecar)",
    description: "Whisper (or equivalent) via the VOICE_API_URL process",
    requiresApiKey: false,
    defaultBaseURL: process.env.VOICE_API_URL ?? "http://localhost:8000",
    defaultModels: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "whisper-1, gpt-4o-transcribe",
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: ["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"],
  },
  {
    id: "groq",
    name: "Groq",
    description: "Whisper-large-v3-turbo at sub-second latency, generous free tier",
    requiresApiKey: true,
    defaultBaseURL: "https://api.groq.com/openai/v1",
    defaultModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
  },
  {
    id: "deepgram",
    name: "Deepgram",
    description: "Nova-3; strong diarization and streaming",
    requiresApiKey: true,
    defaultBaseURL: "https://api.deepgram.com/v1",
    defaultModels: ["nova-3", "nova-2"],
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
  const providerEnv = (process.env.STT_PROVIDER ?? "voice-api").toLowerCase();
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
