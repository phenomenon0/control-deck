/**
 * Per-provider audio-generation invocation. Scope: cloud providers.
 * ComfyUI Stable Audio / ACE Step workflows stay on their existing path
 * in lib/tools/executor.ts:executeGenerateAudio — this adapter activates
 * when AUDIO_GEN_PROVIDER is set.
 */

import type { InferenceProviderConfig } from "../types";
import type { AudioGenArgs, AudioGenResult } from "./types";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const REPLICATE_BASE = "https://api.replicate.com/v1";
const FAL_BASE = "https://fal.run";

const PREDICTION_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_500;

export async function invokeAudioGen(
  providerId: string,
  config: InferenceProviderConfig,
  args: AudioGenArgs,
): Promise<AudioGenResult> {
  switch (providerId) {
    case "elevenlabs":
      return invokeElevenLabsSfx(config, args);
    case "replicate":
      return invokeReplicate(config, args);
    case "fal":
      return invokeFal(config, args);
    default:
      throw new Error(`audio-gen provider not supported: ${providerId}`);
  }
}

/** ElevenLabs Sound Effects — POST /v1/sound-generation, returns mp3 bytes. */
async function invokeElevenLabsSfx(
  config: InferenceProviderConfig,
  args: AudioGenArgs,
): Promise<AudioGenResult> {
  const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("elevenlabs: ELEVENLABS_API_KEY not set");
  const res = await fetch(`${ELEVENLABS_BASE}/sound-generation`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: args.prompt,
      duration_seconds: args.duration,
      prompt_influence: args.extras?.prompt_influence ?? 0.3,
    }),
  });
  if (!res.ok) throw new Error(`elevenlabs-sfx ${res.status}: ${await res.text()}`);
  return {
    audioBytes: await res.arrayBuffer(),
    mime: res.headers.get("content-type") ?? "audio/mpeg",
    providerId: "elevenlabs",
  };
}

/** Replicate — aggregator for MusicGen, Stable Audio Open, audiogen, etc. */
async function invokeReplicate(
  config: InferenceProviderConfig,
  args: AudioGenArgs,
): Promise<AudioGenResult> {
  const apiKey = config.apiKey ?? process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error("replicate: REPLICATE_API_TOKEN not set");
  const version = args.model ?? config.model;
  if (!version) throw new Error("replicate: model version required");
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    duration: args.duration ?? 10,
    seed: args.seed,
    output_format: args.format ?? "mp3",
    ...(args.extras ?? {}),
  };
  const res = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`replicate ${res.status}: ${await res.text()}`);
  let pred = (await res.json()) as {
    id?: string;
    status?: string;
    output?: string | string[];
    error?: string;
    urls?: { get?: string };
  };
  const started = Date.now();
  while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("replicate: audio prediction timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const pollUrl = pred.urls?.get ?? `${REPLICATE_BASE}/predictions/${pred.id}`;
    const r = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) throw new Error(`replicate-poll ${r.status}: ${await r.text()}`);
    pred = (await r.json()) as typeof pred;
  }
  if (pred.status !== "succeeded") {
    throw new Error(`replicate: ${pred.status} — ${pred.error ?? "no detail"}`);
  }
  const out = pred.output;
  const audioUrl = Array.isArray(out) ? out[0] : out;
  if (!audioUrl) throw new Error("replicate: no audio output");
  return {
    audioUrl,
    mime: `audio/${args.format ?? "mpeg"}`,
    providerId: "replicate",
  };
}

/** fal.ai — POST to a model endpoint (MusicGen, Stable Audio Open, etc.). */
async function invokeFal(
  config: InferenceProviderConfig,
  args: AudioGenArgs,
): Promise<AudioGenResult> {
  const apiKey = config.apiKey ?? process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("fal: FAL_API_KEY not set");
  const model = args.model ?? config.model ?? "fal-ai/stable-audio";
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: args.prompt,
      seconds_total: args.duration ?? 10,
      seed: args.seed,
      ...(args.extras ?? {}),
    }),
  });
  if (!res.ok) throw new Error(`fal-audio ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    audio_file?: { url?: string; content_type?: string };
  };
  if (!data.audio_file?.url) throw new Error("fal-audio: no audio_file in response");
  return {
    audioUrl: data.audio_file.url,
    mime: data.audio_file.content_type ?? "audio/wav",
    providerId: "fal",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
