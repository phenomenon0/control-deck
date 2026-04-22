/**
 * Per-provider video-generation invocation. Greenfield modality — Control
 * Deck has no existing video pipeline, so this adapter is the full path
 * (no fallback required).
 *
 * All providers are async: submit → poll until done → fetch URL. Default
 * poll timeout is 5 minutes because video gen is slow (10-90s per clip).
 */

import type { InferenceProviderConfig } from "../types";
import type { VideoGenArgs, VideoGenResult } from "./types";

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const LUMA_BASE = "https://api.lumalabs.ai/dream-machine/v1";
const PIKA_BASE = "https://api.pika.art/v1";
const REPLICATE_BASE = "https://api.replicate.com/v1";
const FAL_BASE = "https://fal.run";

const PREDICTION_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 3_000;

export async function invokeVideoGen(
  providerId: string,
  config: InferenceProviderConfig,
  args: VideoGenArgs,
): Promise<VideoGenResult> {
  switch (providerId) {
    case "runway":
      return invokeRunway(config, args);
    case "luma":
      return invokeLumaDreamMachine(config, args);
    case "pika":
      return invokePika(config, args);
    case "replicate":
      return invokeReplicate(config, args);
    case "fal":
      return invokeFal(config, args);
    default:
      throw new Error(`video-gen provider not supported: ${providerId}`);
  }
}

/** Runway Gen-3 — POST /image_to_video or /text_to_video, poll /tasks/:id. */
async function invokeRunway(
  config: InferenceProviderConfig,
  args: VideoGenArgs,
): Promise<VideoGenResult> {
  const apiKey = config.apiKey ?? process.env.RUNWAY_API_KEY;
  if (!apiKey) throw new Error("runway: RUNWAY_API_KEY not set");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Runway-Version": "2024-11-06",
  };
  const isImageMode = Boolean(args.image);
  const endpoint = isImageMode ? "image_to_video" : "text_to_video";
  const body: Record<string, unknown> = {
    model: args.model ?? config.model ?? "gen3a_turbo",
    duration: args.duration ?? 5,
    seed: args.seed,
    ratio: ratioFor(args),
    ...(args.extras ?? {}),
  };
  if (isImageMode) {
    body.promptImage = args.image?.url ?? `data:${args.image?.mimeType ?? "image/png"};base64,${args.image?.base64}`;
    body.promptText = args.prompt;
  } else {
    body.promptText = args.prompt ?? "";
  }
  const submit = await fetch(`${RUNWAY_BASE}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`runway-submit ${submit.status}: ${await submit.text()}`);
  const { id } = (await submit.json()) as { id?: string };
  if (!id) throw new Error("runway: no task id");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("runway: task timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${RUNWAY_BASE}/tasks/${encodeURIComponent(id)}`, { headers });
    if (!r.ok) throw new Error(`runway-poll ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      status?: string;
      output?: string[];
      failure?: string;
    };
    if (j.status === "SUCCEEDED" && j.output?.[0]) {
      return { videoUrl: j.output[0], mime: "video/mp4", providerId: "runway" };
    }
    if (j.status === "FAILED" || j.status === "CANCELLED") {
      throw new Error(`runway: ${j.failure ?? j.status}`);
    }
  }
}

/** Luma Dream Machine — POST /generations, poll /generations/:id. */
async function invokeLumaDreamMachine(
  config: InferenceProviderConfig,
  args: VideoGenArgs,
): Promise<VideoGenResult> {
  const apiKey = config.apiKey ?? process.env.LUMA_API_KEY;
  if (!apiKey) throw new Error("luma: LUMA_API_KEY not set");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const body: Record<string, unknown> = {
    prompt: args.prompt ?? "",
    model: args.model ?? config.model ?? "ray-2",
    aspect_ratio: aspectRatioString(args),
    ...(args.extras ?? {}),
  };
  if (args.image?.url) {
    body.keyframes = { frame0: { type: "image", url: args.image.url } };
  }
  const submit = await fetch(`${LUMA_BASE}/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`luma-submit ${submit.status}: ${await submit.text()}`);
  const { id } = (await submit.json()) as { id?: string };
  if (!id) throw new Error("luma: no id");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("luma: task timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${LUMA_BASE}/generations/${encodeURIComponent(id)}`, { headers });
    if (!r.ok) throw new Error(`luma-poll ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      state?: string;
      assets?: { video?: string; image?: string };
      failure_reason?: string;
    };
    if (j.state === "completed" && j.assets?.video) {
      return {
        videoUrl: j.assets.video,
        mime: "video/mp4",
        previewUrl: j.assets.image,
        providerId: "luma",
      };
    }
    if (j.state === "failed") {
      throw new Error(`luma: ${j.failure_reason ?? "failed"}`);
    }
  }
}

/** Pika — POST /generate, poll /jobs/:id. */
async function invokePika(
  config: InferenceProviderConfig,
  args: VideoGenArgs,
): Promise<VideoGenResult> {
  const apiKey = config.apiKey ?? process.env.PIKA_API_KEY;
  if (!apiKey) throw new Error("pika: PIKA_API_KEY not set");
  const headers = {
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
  };
  const body: Record<string, unknown> = {
    promptText: args.prompt ?? "",
    model: args.model ?? config.model ?? "pika-2.0",
    seed: args.seed,
    ...(args.extras ?? {}),
  };
  if (args.image?.url) body.image = args.image.url;
  const submit = await fetch(`${PIKA_BASE}/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`pika-submit ${submit.status}: ${await submit.text()}`);
  const { video_id: id } = (await submit.json()) as { video_id?: string };
  if (!id) throw new Error("pika: no video_id");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("pika: timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${PIKA_BASE}/jobs/${encodeURIComponent(id)}`, { headers });
    if (!r.ok) throw new Error(`pika-poll ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      status?: string;
      video_url?: string;
      failure_reason?: string;
    };
    if (j.status === "finished" && j.video_url) {
      return { videoUrl: j.video_url, mime: "video/mp4", providerId: "pika" };
    }
    if (j.status === "failed") {
      throw new Error(`pika: ${j.failure_reason ?? "failed"}`);
    }
  }
}

/** Replicate — aggregator for HunyuanVideo, CogVideoX, LTXV, Wan2.x, etc. */
async function invokeReplicate(
  config: InferenceProviderConfig,
  args: VideoGenArgs,
): Promise<VideoGenResult> {
  const apiKey = config.apiKey ?? process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error("replicate: REPLICATE_API_TOKEN not set");
  const version = args.model ?? config.model;
  if (!version) throw new Error("replicate: model version required for video-gen");
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    seed: args.seed,
    duration: args.duration,
    width: args.width,
    height: args.height,
    ...(args.extras ?? {}),
  };
  if (args.image?.url) input.image = args.image.url;
  const res = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`replicate-video ${res.status}: ${await res.text()}`);
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
      throw new Error("replicate-video: timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const pollUrl = pred.urls?.get ?? `${REPLICATE_BASE}/predictions/${pred.id}`;
    const r = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) throw new Error(`replicate-video-poll ${r.status}: ${await r.text()}`);
    pred = (await r.json()) as typeof pred;
  }
  if (pred.status !== "succeeded") {
    throw new Error(`replicate-video: ${pred.status} — ${pred.error ?? ""}`);
  }
  const out = pred.output;
  const videoUrl = Array.isArray(out) ? out[0] : out;
  if (!videoUrl) throw new Error("replicate-video: no video URL in output");
  return { videoUrl, mime: "video/mp4", providerId: "replicate" };
}

/** fal.ai — POST to a video model endpoint (HunyuanVideo, LTXV, etc.). */
async function invokeFal(
  config: InferenceProviderConfig,
  args: VideoGenArgs,
): Promise<VideoGenResult> {
  const apiKey = config.apiKey ?? process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("fal: FAL_API_KEY not set");
  const model = args.model ?? config.model ?? "fal-ai/ltx-video";
  const body: Record<string, unknown> = {
    prompt: args.prompt ?? "",
    seed: args.seed,
    ...(args.extras ?? {}),
  };
  if (args.image?.url) body.image_url = args.image.url;
  if (args.width && args.height) body.resolution = `${args.width}x${args.height}`;
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fal-video ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    video?: { url?: string; content_type?: string };
  };
  if (!data.video?.url) throw new Error("fal-video: no video.url in response");
  return {
    videoUrl: data.video.url,
    mime: data.video.content_type ?? "video/mp4",
    providerId: "fal",
  };
}

// -- helpers ---------------------------------------------------------

function ratioFor(args: VideoGenArgs): string {
  if (!args.width || !args.height) return "1280:768";
  return `${args.width}:${args.height}`;
}

function aspectRatioString(args: VideoGenArgs): string {
  if (!args.width || !args.height) return "16:9";
  const r = args.width / args.height;
  if (r > 1.5) return "16:9";
  if (r > 1.1) return "4:3";
  if (r < 0.67) return "9:16";
  if (r < 0.9) return "3:4";
  return "1:1";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
