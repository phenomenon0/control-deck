/**
 * Per-provider TTS invocation. One switch over providerId, each case hits
 * that provider's native API. Keeps the registry pure metadata — the
 * registry knows "provider X supports TTS," this file knows "how to call X."
 *
 * Adding a new TTS provider is additive: add the case here, add an entry to
 * register.ts, done. No changes to the modality-agnostic registry.
 */

import type { InferenceProviderConfig } from "../types";
import type { TtsArgs, TtsResult, TtsVoice } from "./types";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const CARTESIA_BASE = "https://api.cartesia.ai";

const VOICE_API_DEFAULT = process.env.VOICE_API_URL ?? "http://localhost:8000";

export async function invokeTts(
  providerId: string,
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  switch (providerId) {
    case "voice-api":
      return invokeVoiceApi(config, args);
    case "elevenlabs":
      return invokeElevenLabs(config, args);
    case "openai":
      return invokeOpenAiTts(config, args);
    case "cartesia":
      return invokeCartesia(config, args);
    default:
      throw new Error(`tts provider not supported: ${providerId}`);
  }
}

/** Wrap the existing VOICE_API_URL sidecar — preserves piper/xtts/chatterbox behaviour. */
async function invokeVoiceApi(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const base = config.baseURL ?? VOICE_API_DEFAULT;
  const engine = (config.extras?.engine as string | undefined) ?? "piper";
  const res = await fetch(`${base}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: args.text,
      engine,
      voice: args.voice ?? "jenny",
    }),
  });
  if (!res.ok) {
    throw new Error(`voice-api ${res.status}: ${await res.text()}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "audio/wav",
    providerId: "voice-api",
  };
}

/** ElevenLabs — POST /v1/text-to-speech/{voice_id}. */
async function invokeElevenLabs(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("elevenlabs: ELEVENLABS_API_KEY not set");
  const voiceId = args.voice ?? (config.extras?.defaultVoiceId as string | undefined) ?? "21m00Tcm4TlvDq8ikWAM"; // "Rachel"
  const model = args.model ?? config.model ?? "eleven_turbo_v2_5";
  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: args.text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`elevenlabs ${res.status}: ${await res.text()}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
    providerId: "elevenlabs",
  };
}

/** OpenAI tts-1 / tts-1-hd / gpt-4o-mini-tts — POST /v1/audio/speech. */
async function invokeOpenAiTts(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai: OPENAI_API_KEY not set");
  const model = args.model ?? config.model ?? "tts-1";
  const voice = args.voice ?? "alloy";
  const format = args.format ?? "mp3";
  const res = await fetch(`${OPENAI_BASE}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: args.text,
      response_format: format,
      speed: args.speed ?? 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`openai-tts ${res.status}: ${await res.text()}`);
  }
  const ct = res.headers.get("content-type") ?? `audio/${format === "mp3" ? "mpeg" : format}`;
  return {
    audio: await res.arrayBuffer(),
    contentType: ct,
    providerId: "openai",
  };
}

/** Cartesia Sonic — POST /tts/bytes (streaming endpoint also exists; this is the one-shot). */
async function invokeCartesia(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const apiKey = config.apiKey ?? process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error("cartesia: CARTESIA_API_KEY not set");
  const voiceId = args.voice ?? (config.extras?.defaultVoiceId as string | undefined);
  if (!voiceId) throw new Error("cartesia: voice id required (args.voice or config.extras.defaultVoiceId)");
  const model = args.model ?? config.model ?? "sonic-3";
  const res = await fetch(`${CARTESIA_BASE}/tts/bytes`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: model,
      transcript: args.text,
      voice: { mode: "id", id: voiceId },
      output_format: {
        container: "mp3",
        bit_rate: 128000,
        sample_rate: 44100,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`cartesia ${res.status}: ${await res.text()}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
    providerId: "cartesia",
  };
}

/** Voice listing — used by the settings UI to populate voice dropdowns. */
export async function listTtsVoices(
  providerId: string,
  config: InferenceProviderConfig,
): Promise<TtsVoice[]> {
  switch (providerId) {
    case "voice-api": {
      const base = config.baseURL ?? VOICE_API_DEFAULT;
      const res = await fetch(`${base}/voices`, { cache: "no-store" }).catch(() => null);
      if (!res || !res.ok) return [];
      const data = (await res.json()) as { voices?: Array<{ id?: string; name?: string }> };
      return (data.voices ?? []).map((v) => ({
        id: String(v.id ?? v.name ?? ""),
        name: v.name,
        providerId,
      }));
    }
    case "elevenlabs": {
      const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return [];
      const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
        headers: { "xi-api-key": apiKey },
        cache: "no-store",
      }).catch(() => null);
      if (!res || !res.ok) return [];
      const data = (await res.json()) as {
        voices?: Array<{ voice_id: string; name?: string; labels?: Record<string, string>; preview_url?: string }>;
      };
      return (data.voices ?? []).map((v) => ({
        id: v.voice_id,
        name: v.name,
        providerId,
        previewUrl: v.preview_url,
        tags: v.labels ? Object.values(v.labels) : undefined,
      }));
    }
    case "openai":
      // OpenAI has a fixed set of 6 voices; no models endpoint for them.
      return ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((id) => ({
        id,
        name: id,
        providerId,
      }));
    case "cartesia": {
      const apiKey = config.apiKey ?? process.env.CARTESIA_API_KEY;
      if (!apiKey) return [];
      const res = await fetch(`${CARTESIA_BASE}/voices`, {
        headers: {
          "X-API-Key": apiKey,
          "Cartesia-Version": "2024-06-10",
        },
        cache: "no-store",
      }).catch(() => null);
      if (!res || !res.ok) return [];
      const data = (await res.json()) as Array<{ id: string; name?: string; language?: string }>;
      return (Array.isArray(data) ? data : []).map((v) => ({
        id: v.id,
        name: v.name,
        providerId,
        tags: v.language ? [v.language] : undefined,
      }));
    }
    default:
      return [];
  }
}
