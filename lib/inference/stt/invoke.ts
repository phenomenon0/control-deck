/**
 * Per-provider STT invocation. Same switch pattern as tts/invoke.ts.
 *
 * All providers here accept a multipart upload with the audio blob; only
 * the field names, headers, and response shapes differ.
 */

import type { InferenceProviderConfig } from "../types";
import type { SttArgs, SttResult, SttWord } from "./types";
import { QWEN_OMNI_PROVIDER_ID, qwenOmniSidecarUrl } from "../omni/local";
import {
  shouldRouteToVoiceEngines,
  voiceEnginesSidecarUrl,
} from "../voice-engines/sidecar-url";

const OPENAI_BASE = "https://api.openai.com/v1";
const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEEPGRAM_BASE = "https://api.deepgram.com/v1";
const CARTESIA_BASE = "https://api.cartesia.ai";
const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

const VOICE_API_DEFAULT = process.env.VOICE_API_URL ?? "http://localhost:8000";

export async function invokeStt(
  providerId: string,
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  switch (providerId) {
    case "voice-api":
      return invokeVoiceApi(config, args);
    case "openai":
      return invokeOpenAiStt(config, args);
    case "groq":
      return invokeGroqStt(config, args);
    case "deepgram":
      return invokeDeepgram(config, args);
    case "cartesia":
      return invokeCartesiaInk(config, args);
    case "assemblyai":
      return invokeAssemblyAi(config, args);
    case QWEN_OMNI_PROVIDER_ID:
      return invokeQwenOmniLocal(config, args);
    default:
      throw new Error(`stt provider not supported: ${providerId}`);
  }
}

async function invokeQwenOmniLocal(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const sidecarUrl =
    (config.extras?.sidecarUrl as string | null | undefined) ?? qwenOmniSidecarUrl();
  if (sidecarUrl) {
    return invokeQwenOmniSidecarStt(sidecarUrl, args);
  }
  if (process.env.QWEN_OMNI_REQUIRE_RUNTIME === "1") {
    throw new Error(
      "qwen-omni-local: local generation runtime is required but no Omni sidecar is configured. Set OMNI_SIDECAR_URL or start a CUDA-capable runtime.",
    );
  }
  const result = await invokeVoiceApi(
    {
      providerId: "voice-api",
      baseURL: process.env.VOICE_API_URL ?? (config.extras?.fallbackBaseURL as string | undefined),
    },
    args,
  );
  return { ...result, providerId: QWEN_OMNI_PROVIDER_ID };
}

async function invokeQwenOmniSidecarStt(
  baseURL: string,
  args: SttArgs,
): Promise<SttResult> {
  const form = new FormData();
  form.append("audio", args.audio, fileNameFor(args));
  if (args.language) form.append("language", args.language);
  if (args.timestamps) form.append("timestamps", "true");
  const res = await fetch(`${baseURL.replace(/\/+$/, "")}/stt`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`qwen-omni-sidecar-stt ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    text?: string;
    transcription?: string;
    language?: string;
    duration?: number;
    words?: Array<{ text?: string; word?: string; start: number; end: number }>;
  };
  const words: SttWord[] | undefined = data.words?.map((w) => ({
    text: String(w.text ?? w.word ?? ""),
    start: w.start,
    end: w.end,
  }));
  return {
    text: String(data.text ?? data.transcription ?? ""),
    language: data.language,
    duration: data.duration,
    words,
    providerId: QWEN_OMNI_PROVIDER_ID,
  };
}

/**
 * VOICE_API_URL sidecar — routes by model id.
 *
 * Legacy ids (`whisper-tiny`, `large-v3-turbo`, `large-v3`) → port 8000
 * (the external faster-whisper sidecar). Tiered ids declared in
 * `hardware-tiers.ts` (`whisper-large-v3-turbo-cpp`, `parakeet-tdt-0.6b-v2`,
 * `moonshine-tiny`) → the in-repo voice-engines sidecar at port 9101.
 */
async function invokeVoiceApi(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const requestedModel = args.model ?? config.model ?? null;
  const useVoiceEngines = shouldRouteToVoiceEngines(requestedModel);
  const base = useVoiceEngines
    ? voiceEnginesSidecarUrl()
    : (config.baseURL ?? VOICE_API_DEFAULT);
  const form = new FormData();
  form.append("audio", args.audio);
  if (useVoiceEngines && requestedModel) {
    form.append("engine", requestedModel);
    if (args.language) form.append("language", args.language);
  }
  const res = await fetch(`${base}/stt`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(
      `${useVoiceEngines ? "voice-engines" : "voice-api"} ${res.status}: ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    text?: string;
    transcription?: string;
    language?: string;
    duration?: number;
    words?: Array<{ text?: string; word?: string; start: number; end: number }>;
  };
  const words: SttWord[] | undefined = data.words?.map((w) => ({
    text: String(w.text ?? w.word ?? ""),
    start: w.start,
    end: w.end,
  }));
  return {
    text: String(data.text ?? data.transcription ?? ""),
    language: data.language,
    duration: data.duration,
    words,
    providerId: "voice-api",
  };
}

/**
 * OpenAI — POST /v1/audio/transcriptions.
 *
 * Defaults to `gpt-4o-transcribe` (the 2026 accuracy leader at ~2.46% WER).
 * Callers can override to `gpt-4o-mini-transcribe` or `whisper-1`.
 */
async function invokeOpenAiStt(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai: OPENAI_API_KEY not set");
  const model = args.model ?? config.model ?? "gpt-4o-transcribe";

  const form = new FormData();
  form.append("file", args.audio, fileNameFor(args));
  form.append("model", model);
  if (args.language) form.append("language", args.language);
  if (args.timestamps) {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
  } else {
    form.append("response_format", "json");
  }

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`openai-stt ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    words?: Array<{ word: string; start: number; end: number }>;
  };
  return {
    text: String(data.text ?? ""),
    language: data.language,
    duration: data.duration,
    words: data.words?.map((w) => ({ text: w.word, start: w.start, end: w.end })),
    providerId: "openai",
  };
}

/** Groq Whisper — OpenAI-compatible endpoint, same shape, much faster + free tier. */
async function invokeGroqStt(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const apiKey = config.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("groq: GROQ_API_KEY not set");
  const model = args.model ?? config.model ?? "whisper-large-v3-turbo";

  const form = new FormData();
  form.append("file", args.audio, fileNameFor(args));
  form.append("model", model);
  if (args.language) form.append("language", args.language);
  if (args.timestamps) {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
  } else {
    form.append("response_format", "json");
  }

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`groq-stt ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    words?: Array<{ word: string; start: number; end: number }>;
  };
  return {
    text: String(data.text ?? ""),
    language: data.language,
    duration: data.duration,
    words: data.words?.map((w) => ({ text: w.word, start: w.start, end: w.end })),
    providerId: "groq",
  };
}

/** Deepgram Nova — POST /v1/listen, raw audio body, rich metadata. */
async function invokeDeepgram(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const apiKey = config.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("deepgram: DEEPGRAM_API_KEY not set");
  const model = args.model ?? config.model ?? "nova-3";

  const params = new URLSearchParams();
  params.set("model", model);
  params.set("smart_format", "true");
  if (args.language) params.set("language", args.language);
  if (args.timestamps) params.set("utterances", "true");

  const res = await fetch(`${DEEPGRAM_BASE}/listen?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": args.mimeType ?? args.audio.type ?? "audio/webm",
    },
    body: args.audio,
  });
  if (!res.ok) {
    throw new Error(`deepgram ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    metadata?: { duration?: number };
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string;
          words?: Array<{ word: string; start: number; end: number }>;
        }>;
        detected_language?: string;
      }>;
    };
  };
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  const words: SttWord[] | undefined = alt?.words?.map((w) => ({
    text: w.word,
    start: w.start,
    end: w.end,
  }));
  return {
    text: String(alt?.transcript ?? ""),
    language: data.results?.channels?.[0]?.detected_language,
    duration: data.metadata?.duration,
    words,
    providerId: "deepgram",
  };
}

/**
 * Cartesia Ink-Whisper — POST /stt/transcriptions (batch) or WebSocket (streaming).
 *
 * This dispatcher uses the batch endpoint since invokeStt is synchronous; the
 * streaming path is a separate integration on the client side (Assistant surface
 * can open a WS directly when it wants live partials).
 */
async function invokeCartesiaInk(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const apiKey = config.apiKey ?? process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error("cartesia: CARTESIA_API_KEY not set");
  const model = args.model ?? config.model ?? "ink-whisper";

  const form = new FormData();
  form.append("file", args.audio, fileNameFor(args));
  form.append("model", model);
  if (args.language) form.append("language", args.language);

  const res = await fetch(`${CARTESIA_BASE}/stt/transcriptions`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2024-06-10",
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`cartesia-stt ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
  };
  return {
    text: String(data.text ?? ""),
    language: data.language,
    duration: data.duration,
    providerId: "cartesia",
  };
}

/**
 * AssemblyAI Universal-3 — two-step: upload → transcribe → poll.
 *
 * Batch only from a server route handler. Streaming partials use the dedicated
 * WebSocket endpoint (`wss://streaming.assemblyai.com/v3/ws`) on the client.
 */
async function invokeAssemblyAi(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const apiKey = config.apiKey ?? process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("assemblyai: ASSEMBLYAI_API_KEY not set");
  // Universal-3 Pro hit 1.52% WER on LibriSpeech (Mar 2026) — accuracy leader
  // among streaming-capable providers. Falls back to `universal-3` or `best`
  // when caller overrides.
  const model = args.model ?? config.model ?? "universal-3-pro";

  // 1) Upload raw bytes.
  const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": args.mimeType ?? args.audio.type ?? "application/octet-stream",
    },
    body: args.audio,
  });
  if (!uploadRes.ok) {
    throw new Error(`assemblyai-upload ${uploadRes.status}: ${await uploadRes.text()}`);
  }
  const uploadJson = (await uploadRes.json()) as { upload_url?: string };
  if (!uploadJson.upload_url) {
    throw new Error("assemblyai: upload response missing upload_url");
  }

  // 2) Queue transcript.
  const body: Record<string, unknown> = {
    audio_url: uploadJson.upload_url,
    speech_model: model,
  };
  if (args.language) body.language_code = args.language;
  if (args.timestamps) body.word_boost = [];

  const startRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!startRes.ok) {
    throw new Error(`assemblyai-start ${startRes.status}: ${await startRes.text()}`);
  }
  const startJson = (await startRes.json()) as { id?: string };
  if (!startJson.id) throw new Error("assemblyai: start response missing id");

  // 3) Poll. Capped at ~2 minutes so a route handler can't hang forever.
  const POLL_INTERVAL_MS = 500;
  const MAX_POLLS = 240;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${ASSEMBLYAI_BASE}/transcript/${startJson.id}`, {
      headers: { authorization: apiKey },
    });
    if (!pollRes.ok) continue;
    const poll = (await pollRes.json()) as {
      status?: string;
      text?: string;
      language_code?: string;
      audio_duration?: number;
      error?: string;
      words?: Array<{ text: string; start: number; end: number }>;
    };
    if (poll.status === "error") {
      throw new Error(`assemblyai: ${poll.error ?? "unknown error"}`);
    }
    if (poll.status === "completed") {
      return {
        text: String(poll.text ?? ""),
        language: poll.language_code,
        duration: poll.audio_duration,
        words: poll.words?.map((w) => ({ text: w.text, start: w.start / 1000, end: w.end / 1000 })),
        providerId: "assemblyai",
      };
    }
  }
  throw new Error("assemblyai: transcript polling timed out");
}

function fileNameFor(args: SttArgs): string {
  // OpenAI/Groq's multipart parser needs a filename with a recognisable
  // extension; without it they reject the upload. Prefer the blob's type,
  // fall back to webm which is what MediaRecorder spits out by default.
  const mime = args.mimeType ?? args.audio.type ?? "audio/webm";
  const ext = mime.split("/")[1]?.split(";")[0] ?? "webm";
  return `audio.${ext}`;
}
