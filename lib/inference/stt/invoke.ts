/**
 * Per-provider STT invocation. Same switch pattern as tts/invoke.ts.
 *
 * All providers here accept a multipart upload with the audio blob; only
 * the field names, headers, and response shapes differ.
 */

import type { InferenceProviderConfig } from "../types";
import type { SttArgs, SttResult, SttWord } from "./types";

const OPENAI_BASE = "https://api.openai.com/v1";
const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEEPGRAM_BASE = "https://api.deepgram.com/v1";

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
    default:
      throw new Error(`stt provider not supported: ${providerId}`);
  }
}

/** Existing VOICE_API_URL sidecar — preserves current behaviour. */
async function invokeVoiceApi(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const base = config.baseURL ?? VOICE_API_DEFAULT;
  const form = new FormData();
  form.append("audio", args.audio);
  const res = await fetch(`${base}/stt`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`voice-api ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    text?: string;
    transcription?: string;
    language?: string;
    duration?: number;
  };
  return {
    text: String(data.text ?? data.transcription ?? ""),
    language: data.language,
    duration: data.duration,
    providerId: "voice-api",
  };
}

/** OpenAI Whisper — POST /v1/audio/transcriptions with `model=whisper-1`. */
async function invokeOpenAiStt(
  config: InferenceProviderConfig,
  args: SttArgs,
): Promise<SttResult> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai: OPENAI_API_KEY not set");
  const model = args.model ?? config.model ?? "whisper-1";

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

function fileNameFor(args: SttArgs): string {
  // OpenAI/Groq's multipart parser needs a filename with a recognisable
  // extension; without it they reject the upload. Prefer the blob's type,
  // fall back to webm which is what MediaRecorder spits out by default.
  const mime = args.mimeType ?? args.audio.type ?? "audio/webm";
  const ext = mime.split("/")[1]?.split(";")[0] ?? "webm";
  return `audio.${ext}`;
}
