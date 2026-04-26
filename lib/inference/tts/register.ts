/**
 * Text-to-speech providers.
 *
 * Preserves the existing VOICE_API_URL path (Piper / xtts / chatterbox
 * engines) as the default, and adds cloud providers for users who want
 * higher-quality voices than the local sidecar offers.
 *
 * Env vars:
 *   TTS_PROVIDER          voice-api | elevenlabs | openai | cartesia | hume | inworld | deepgram | google
 *                         (default: voice-api — preserves existing behaviour)
 *   TTS_VOICE             default voice id for the selected provider
 *   TTS_MODEL             default model id for the selected provider
 *   ELEVENLABS_API_KEY    required for elevenlabs
 *   OPENAI_API_KEY        reused from the text-LLM slot, required for openai
 *   CARTESIA_API_KEY      required for cartesia
 *   HUME_API_KEY          required for Hume Octave 2 (voice-by-prompt)
 *   INWORLD_API_KEY       required for Inworld TTS-1.5 (Artificial Analysis #1)
 *   DEEPGRAM_API_KEY      required for Deepgram Aura-2 (dual-use: STT + TTS)
 *   GOOGLE_API_KEY        required for Gemini 3.1 Flash TTS (ELO #1, Mar 2026)
 */

import { registerProvider, getProvider } from "../registry";
import { bindSlot } from "../runtime";
import { listTtsVoices } from "./invoke";
import type { InferenceProvider, Modality } from "../types";

const PROVIDERS: InferenceProvider[] = [
  {
    id: "voice-api",
    name: "Voice API (local sidecar)",
    description:
      "Local TTS sidecars. Legacy engines (piper/xtts/chatterbox) route to " +
      "VOICE_API_URL (port 8000). Tiered engines (kokoro-82m, orpheus-3b) " +
      "route to the in-repo voice-engines sidecar (port 9101).",
    modalities: ["tts", "stt"],
    requiresApiKey: false,
    defaultBaseURL: process.env.VOICE_API_URL ?? "http://localhost:8000",
    defaultModels: {
      tts: ["kokoro-82m", "orpheus-3b", "piper", "xtts", "chatterbox"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("voice-api", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Studio-quality voices, Flash v2.5 (~75ms) and v3 (expressive)",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.elevenlabs.io/v1",
    defaultModels: {
      // eleven_flash_v2_5 is the 2026 latency leader; eleven_v3 is the quality/expressive tier.
      // Turbo aliases are deprecated — use Flash.
      tts: ["eleven_flash_v2_5", "eleven_v3", "eleven_multilingual_v2"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("elevenlabs", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "gpt-4o-mini-tts (steerable) / tts-1 / tts-1-hd",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: {
      // gpt-4o-mini-tts is the 2026 sweet spot (steerable with `instructions`).
      tts: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("openai", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "cartesia",
    name: "Cartesia",
    description: "Sonic-3 — 40–90ms TTFB, instant voice clone, 40+ languages",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.cartesia.ai",
    defaultModels: {
      // sonic-3 is the 2026 default.
      tts: ["sonic-3", "sonic-2"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("cartesia", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "hume",
    name: "Hume",
    description: "Octave 2 — voice design from a text description (unique in 2026)",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.hume.ai/v0",
    defaultModels: {
      tts: ["octave-2", "octave-1"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("hume", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "inworld",
    name: "Inworld",
    description: "TTS-1.5 — #1 on Artificial Analysis ELO (Mar 2026), free instant clone",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.inworld.ai/tts/v1",
    defaultModels: {
      tts: ["inworld-tts-1.5", "inworld-tts-1.5-max"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("inworld", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "deepgram",
    name: "Deepgram",
    // Deepgram is dual-modality — STT (Nova-3) and TTS (Aura-2). STT registration
    // elsewhere (stt/register.ts) merges modalities.
    description: "Aura-2 TTS (~90ms) + Nova-3 STT; purpose-built for voice agents",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://api.deepgram.com/v1",
    defaultModels: {
      tts: [
        "aura-2-thalia-en",
        "aura-2-andromeda-en",
        "aura-2-helena-en",
        "aura-2-apollo-en",
        "aura-2-orion-en",
        "aura-2-arcas-en",
      ],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("deepgram", config);
      return voices.map((v) => v.id);
    },
  },
  {
    id: "google",
    name: "Google",
    // Gemini 3.1 Flash TTS — Artificial Analysis ELO 1211 (Mar 2026), beats
    // ElevenLabs v3 at ~1/15th the price. 24 languages, steerable via
    // style instruction prefix.
    description: "Gemini 3.1 Flash TTS — ELO #1 (Mar 2026), 24 languages, ~15× cheaper than ElevenLabs v3",
    modalities: ["tts"],
    requiresApiKey: true,
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    defaultModels: {
      tts: ["gemini-3.1-flash-preview-tts", "gemini-2.5-pro-preview-tts"],
    },
    listModels: async (_m, config) => {
      const voices = await listTtsVoices("google", config);
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
