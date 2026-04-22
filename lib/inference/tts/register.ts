/**
 * Text-to-speech providers.
 *
 * Preserves the existing VOICE_API_URL path (Piper / xtts / chatterbox
 * engines) as the default, and adds cloud providers for users who want
 * higher-quality voices than the local sidecar offers.
 *
 * Env vars:
 *   TTS_PROVIDER          voice-api | elevenlabs | openai | cartesia
 *                         (default: voice-api — preserves existing behaviour)
 *   TTS_VOICE             default voice id for the selected provider
 *   TTS_MODEL             default model id for the selected provider
 *   ELEVENLABS_API_KEY    required for elevenlabs
 *   OPENAI_API_KEY        reused from the text-LLM slot, required for openai
 *   CARTESIA_API_KEY      required for cartesia
 */

import { registerProvider, getProvider } from "../registry";
import { bindSlot } from "../runtime";
import { listTtsVoices } from "./invoke";
import type { InferenceProvider, Modality } from "../types";

const PROVIDERS: InferenceProvider[] = [
  {
    id: "voice-api",
    name: "Voice API (local sidecar)",
    description: "Piper / xtts / chatterbox via the VOICE_API_URL process",
    modalities: ["tts", "stt"],
    requiresApiKey: false,
    defaultBaseURL: process.env.VOICE_API_URL ?? "http://localhost:8000",
    defaultModels: {
      tts: ["piper", "xtts", "chatterbox"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("voice-api", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Studio-quality voices, fast turbo models",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.elevenlabs.io/v1",
    defaultModels: {
      // Keep lean — live voice listing from /v1/voices supersedes these at
      // runtime; listed here only as a fallback if the API is unreachable
      // at registration time. eleven_v3 = higher quality; turbo_v2_5 = fastest.
      tts: ["eleven_v3", "eleven_turbo_v2_5"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("elevenlabs", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "tts-1 / tts-1-hd / gpt-4o-mini-tts",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: {
      tts: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("openai", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "cartesia",
    name: "Cartesia",
    description: "Sonic — low-latency streaming, high expressiveness",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.cartesia.ai",
    defaultModels: {
      // sonic-3 is the 2026 default; sonic-turbo is the sub-50ms variant.
      tts: ["sonic-3", "sonic-turbo", "sonic-2"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("cartesia", config);
      return voices.map((v) => v.id);
    },
  },
];

let registered = false;

export function registerTtsProviders(): void {
  if (registered) return;
  registered = true;

  for (const p of PROVIDERS) {
    // Preserve any modality claim an earlier pass made (text-register runs
    // first and claims OpenAI for text; we want the merged list here).
    const prior = getProvider(p.id);
    const modalities = mergeModalities(prior?.modalities, p.modalities);
    registerProvider({
      ...p,
      modalities,
      defaultModels: { ...(prior?.defaultModels ?? {}), ...p.defaultModels },
    });
  }

  // Bind the default TTS slot from env so the route has something to fall
  // back to even before the Settings UI touches it.
  const providerEnv = (process.env.TTS_PROVIDER ?? "voice-api").toLowerCase();
  if (PROVIDERS.some((p) => p.id === providerEnv)) {
    bindSlot({
      modality: "tts",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.TTS_MODEL,
        extras: {
          defaultVoiceId: process.env.TTS_VOICE,
          // voice-api engine preserved for the current sidecar path
          engine: process.env.TTS_ENGINE ?? "piper",
        },
      },
    });
  }
}

function mergeModalities(
  prior: Modality[] | undefined,
  incoming: Modality[],
): Modality[] {
  const set = new Set<Modality>(prior ?? []);
  for (const m of incoming) set.add(m);
  return [...set];
}
