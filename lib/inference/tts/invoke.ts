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
const HUME_BASE = "https://api.hume.ai/v0";
const INWORLD_BASE = "https://api.inworld.ai/tts/v1";
const DEEPGRAM_BASE = "https://api.deepgram.com/v1";
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";

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
    case "hume":
      return invokeHumeOctave(config, args);
    case "inworld":
      return invokeInworld(config, args);
    case "deepgram":
      return invokeDeepgramAura(config, args);
    case "google":
      return invokeGoogleGemini(config, args);
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
  // Flash v2.5 is the 2026 latency leader (~75ms TTFB); turbo* are deprecated aliases.
  const model = args.model ?? config.model ?? "eleven_flash_v2_5";
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

/**
 * Hume Octave 2 — POST /v0/tts/file.
 *
 * Two modes:
 *   - `args.voice` = a registered voice id → render as that voice
 *   - `config.extras.voiceDescription` = natural-language description → Octave
 *     designs a new voice matching it (the unique-in-2026 "voice by prompt")
 */
async function invokeHumeOctave(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const apiKey = config.apiKey ?? process.env.HUME_API_KEY;
  if (!apiKey) throw new Error("hume: HUME_API_KEY not set");
  const voiceId = args.voice ?? (config.extras?.defaultVoiceId as string | undefined);
  const description = config.extras?.voiceDescription as string | undefined;
  if (!voiceId && !description) {
    throw new Error("hume: need args.voice (voice id) or config.extras.voiceDescription");
  }
  const model = args.model ?? config.model ?? "octave-2";
  const utterance: Record<string, unknown> = { text: args.text };
  if (voiceId) utterance.voice = { id: voiceId };
  else if (description) utterance.description = description;

  const res = await fetch(`${HUME_BASE}/tts/file`, {
    method: "POST",
    headers: {
      "X-Hume-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      utterances: [utterance],
      model,
      format: { type: args.format === "wav" ? "wav" : "mp3" },
    }),
  });
  if (!res.ok) {
    throw new Error(`hume ${res.status}: ${await res.text()}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
    providerId: "hume",
  };
}

/** Inworld TTS-1.5 — POST /tts/v1/voice. */
async function invokeInworld(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const apiKey = config.apiKey ?? process.env.INWORLD_API_KEY;
  if (!apiKey) throw new Error("inworld: INWORLD_API_KEY not set");
  const voiceId = args.voice ?? (config.extras?.defaultVoiceId as string | undefined) ?? "Ashley";
  const model = args.model ?? config.model ?? "inworld-tts-1.5";

  const res = await fetch(`${INWORLD_BASE}/voice`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: args.text,
      voiceId,
      modelId: model,
      audio_config: {
        audio_encoding: args.format === "wav" ? "LINEAR16" : "MP3",
        sample_rate_hertz: 44100,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`inworld ${res.status}: ${await res.text()}`);
  }
  // Inworld returns a JSON envelope with base64 audioContent.
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error("inworld: response missing audioContent");
  }
  const bytes = Buffer.from(data.audioContent, "base64");
  return {
    audio: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    contentType: args.format === "wav" ? "audio/wav" : "audio/mpeg",
    providerId: "inworld",
  };
}

/** Deepgram Aura-2 — POST /v1/speak. */
async function invokeDeepgramAura(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const apiKey = config.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("deepgram: DEEPGRAM_API_KEY not set");
  const voice = args.voice ?? (config.extras?.defaultVoiceId as string | undefined) ?? "aura-2-thalia-en";
  const encoding = args.format === "wav" ? "linear16" : "mp3";

  const params = new URLSearchParams({ model: voice, encoding });
  const res = await fetch(`${DEEPGRAM_BASE}/speak?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: args.text }),
  });
  if (!res.ok) {
    throw new Error(`deepgram-aura ${res.status}: ${await res.text()}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? (encoding === "linear16" ? "audio/wav" : "audio/mpeg"),
    providerId: "deepgram",
  };
}

/**
 * Google Gemini native TTS — POST /v1beta/models/{model}:generateContent.
 *
 * Uses the generateContent endpoint with an audio response modality. Gemini
 * 3.1 Flash TTS is the Artificial Analysis ELO leader (1211 as of Mar 2026),
 * beating ElevenLabs v3 at a fraction of the cost.
 *
 * Voice styling: `args.voice` selects a prebuilt voice (e.g. "Kore", "Puck",
 * "Charon"). `config.extras.styleInstruction` prepends a natural-language
 * direction ("speak warmly, slowly") to shape delivery.
 */
async function invokeGoogleGemini(
  config: InferenceProviderConfig,
  args: TtsArgs,
): Promise<TtsResult> {
  const apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("google: GOOGLE_API_KEY (or GEMINI_API_KEY) not set");
  const model = args.model ?? config.model ?? "gemini-3.1-flash-preview-tts";
  const voice = args.voice ?? (config.extras?.defaultVoiceId as string | undefined) ?? "Kore";
  const styleInstruction = (config.extras?.styleInstruction as string | undefined)?.trim();
  const prompt = styleInstruction ? `${styleInstruction}: ${args.text}` : args.text;

  const res = await fetch(
    `${GOOGLE_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`google-tts ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
      };
    }>;
  };
  const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) {
    throw new Error("google-tts: response missing inlineData.data");
  }
  const bytes = Buffer.from(inline.data, "base64");
  return {
    audio: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    contentType: inline.mimeType ?? "audio/L16;rate=24000",
    providerId: "google",
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
    case "hume": {
      const apiKey = config.apiKey ?? process.env.HUME_API_KEY;
      if (!apiKey) return [];
      const res = await fetch(`${HUME_BASE}/tts/voices?provider=HUME_AI`, {
        headers: { "X-Hume-Api-Key": apiKey },
        cache: "no-store",
      }).catch(() => null);
      if (!res || !res.ok) return [];
      const data = (await res.json()) as {
        voices_page?: Array<{ id: string; name?: string; provider?: string }>;
      };
      return (data.voices_page ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        providerId,
      }));
    }
    case "inworld": {
      const apiKey = config.apiKey ?? process.env.INWORLD_API_KEY;
      if (!apiKey) return [];
      const res = await fetch(`${INWORLD_BASE}/voices`, {
        headers: { Authorization: `Basic ${apiKey}` },
        cache: "no-store",
      }).catch(() => null);
      if (!res || !res.ok) return [];
      const data = (await res.json()) as {
        voices?: Array<{ voiceId: string; displayName?: string; languages?: string[] }>;
      };
      return (data.voices ?? []).map((v) => ({
        id: v.voiceId,
        name: v.displayName,
        providerId,
        tags: v.languages,
      }));
    }
    case "deepgram":
      // Aura-2 exposes a fixed voice list; no /voices endpoint in the TTS API yet.
      return [
        "aura-2-thalia-en",
        "aura-2-andromeda-en",
        "aura-2-helena-en",
        "aura-2-apollo-en",
        "aura-2-orion-en",
        "aura-2-arcas-en",
      ].map((id) => ({ id, name: id, providerId }));
    case "google":
      // Gemini TTS ships a fixed palette of prebuilt voices — no /voices endpoint.
      return [
        "Kore",
        "Puck",
        "Charon",
        "Fenrir",
        "Aoede",
        "Orus",
        "Zephyr",
        "Leda",
      ].map((id) => ({ id, name: id, providerId }));
    default:
      return [];
  }
}
