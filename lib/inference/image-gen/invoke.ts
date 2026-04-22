/**
 * Per-provider image-generation invocation.
 *
 * Scope: cloud providers only. ComfyUI + Lite ONNX stay on their existing
 * pipelines in lib/tools/executor.ts — users on GPU rigs keep the
 * workflow-driven flow; users without ComfyUI get Replicate / fal / OpenAI
 * / Stability when they set IMAGE_GEN_PROVIDER.
 */

import type { InferenceProviderConfig } from "../types";
import type { ImageGenArgs, ImageGenResult } from "./types";

const OPENAI_BASE = "https://api.openai.com/v1";
const REPLICATE_BASE = "https://api.replicate.com/v1";
const FAL_BASE = "https://fal.run";
const STABILITY_BASE = "https://api.stability.ai";
const BFL_BASE = "https://api.bfl.ml/v1";

const PREDICTION_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_500;

export async function invokeImageGen(
  providerId: string,
  config: InferenceProviderConfig,
  args: ImageGenArgs,
): Promise<ImageGenResult> {
  switch (providerId) {
    case "openai":
      return invokeOpenAi(config, args);
    case "replicate":
      return invokeReplicate(config, args);
    case "fal":
      return invokeFal(config, args);
    case "stability":
      return invokeStability(config, args);
    case "bfl":
      return invokeBfl(config, args);
    default:
      throw new Error(`image-gen provider not supported: ${providerId}`);
  }
}

/** OpenAI DALL-E 3 — POST /v1/images/generations. */
async function invokeOpenAi(
  config: InferenceProviderConfig,
  args: ImageGenArgs,
): Promise<ImageGenResult> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai: OPENAI_API_KEY not set");
  const model = args.model ?? config.model ?? "dall-e-3";
  const size = sizeFor(args, ["1024x1024", "1792x1024", "1024x1792"]);
  const res = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: args.prompt,
      size,
      n: 1,
      response_format: "b64_json",
    }),
  });
  if (!res.ok) throw new Error(`openai-image ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  const first = data.data?.[0];
  if (!first?.b64_json) throw new Error("openai-image: no image in response");
  return {
    imageBytes: base64ToArrayBuffer(first.b64_json),
    mime: "image/png",
    revisedPrompt: first.revised_prompt,
    providerId: "openai",
  };
}

/** Replicate — aggregator. POST /predictions, then poll until "succeeded". */
async function invokeReplicate(
  config: InferenceProviderConfig,
  args: ImageGenArgs,
): Promise<ImageGenResult> {
  const apiKey = config.apiKey ?? process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error("replicate: REPLICATE_API_TOKEN not set");
  const version = args.model ?? config.model;
  if (!version) {
    throw new Error("replicate: model version required (args.model or slot.config.model)");
  }
  const input = {
    prompt: args.prompt,
    width: args.width ?? 1024,
    height: args.height ?? 1024,
    num_inference_steps: args.steps ?? 25,
    seed: args.seed,
    negative_prompt: args.negativePrompt,
    ...(args.extras ?? {}),
  };
  const res = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60", // Replicate holds the connection open up to 60s before requiring polling
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
      throw new Error("replicate: prediction timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const pollUrl = pred.urls?.get ?? `${REPLICATE_BASE}/predictions/${pred.id}`;
    const r = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) throw new Error(`replicate-poll ${r.status}: ${await r.text()}`);
    pred = (await r.json()) as typeof pred;
  }
  if (pred.status !== "succeeded") {
    throw new Error(`replicate: ${pred.status} — ${pred.error ?? "no error detail"}`);
  }
  const out = pred.output;
  const imageUrl = Array.isArray(out) ? out[0] : out;
  if (!imageUrl) throw new Error("replicate: no output image in prediction");
  return { imageUrl, mime: "image/png", providerId: "replicate" };
}

/** fal.ai — POST to a model-specific URL under https://fal.run. */
async function invokeFal(
  config: InferenceProviderConfig,
  args: ImageGenArgs,
): Promise<ImageGenResult> {
  const apiKey = config.apiKey ?? process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("fal: FAL_API_KEY not set");
  const model = args.model ?? config.model ?? "fal-ai/flux/schnell";
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: args.prompt,
      image_size:
        args.width && args.height ? { width: args.width, height: args.height } : "square_hd",
      num_inference_steps: args.steps,
      seed: args.seed,
      negative_prompt: args.negativePrompt,
      ...(args.extras ?? {}),
    }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    images?: Array<{ url?: string; content_type?: string }>;
  };
  const first = data.images?.[0];
  if (!first?.url) throw new Error("fal: no images in response");
  return {
    imageUrl: first.url,
    mime: first.content_type ?? "image/png",
    providerId: "fal",
  };
}

/** Stability AI — POST /v2beta/stable-image/generate/sd3 (binary body). */
async function invokeStability(
  config: InferenceProviderConfig,
  args: ImageGenArgs,
): Promise<ImageGenResult> {
  const apiKey = config.apiKey ?? process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error("stability: STABILITY_API_KEY not set");
  const model = args.model ?? config.model ?? "sd3-medium";
  const form = new FormData();
  form.append("prompt", args.prompt);
  form.append("model", model);
  form.append("output_format", "png");
  if (args.seed !== undefined) form.append("seed", String(args.seed));
  if (args.negativePrompt) form.append("negative_prompt", args.negativePrompt);
  form.append("aspect_ratio", aspectRatioFor(args));
  const res = await fetch(`${STABILITY_BASE}/v2beta/stable-image/generate/sd3`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "image/*",
    },
    body: form,
  });
  if (!res.ok) throw new Error(`stability ${res.status}: ${await res.text()}`);
  return {
    imageBytes: await res.arrayBuffer(),
    mime: res.headers.get("content-type") ?? "image/png",
    providerId: "stability",
  };
}

/** Black Forest Labs FLUX — POST /v1/flux-pro-1.1, poll until ready. */
async function invokeBfl(
  config: InferenceProviderConfig,
  args: ImageGenArgs,
): Promise<ImageGenResult> {
  const apiKey = config.apiKey ?? process.env.BFL_API_KEY;
  if (!apiKey) throw new Error("bfl: BFL_API_KEY not set");
  const model = args.model ?? config.model ?? "flux-pro-1.1";
  const submit = await fetch(`${BFL_BASE}/${model}`, {
    method: "POST",
    headers: {
      "x-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: args.prompt,
      width: args.width ?? 1024,
      height: args.height ?? 1024,
      seed: args.seed,
      ...(args.extras ?? {}),
    }),
  });
  if (!submit.ok) throw new Error(`bfl-submit ${submit.status}: ${await submit.text()}`);
  const { id } = (await submit.json()) as { id?: string };
  if (!id) throw new Error("bfl: submit returned no id");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("bfl: generation timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${BFL_BASE}/get_result?id=${encodeURIComponent(id)}`, {
      headers: { "x-key": apiKey },
    });
    if (!r.ok) throw new Error(`bfl-poll ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      status?: string;
      result?: { sample?: string };
    };
    if (j.status === "Ready" && j.result?.sample) {
      return { imageUrl: j.result.sample, mime: "image/jpeg", providerId: "bfl" };
    }
    if (j.status === "Error" || j.status === "Failed") {
      throw new Error(`bfl: generation ${j.status}`);
    }
  }
}

// -- helpers ---------------------------------------------------------

function sizeFor(args: ImageGenArgs, allowed: string[]): string {
  if (args.width && args.height) {
    const key = `${args.width}x${args.height}`;
    if (allowed.includes(key)) return key;
  }
  return allowed[0];
}

function aspectRatioFor(args: ImageGenArgs): string {
  if (!args.width || !args.height) return "1:1";
  const r = args.width / args.height;
  if (r > 1.5) return "16:9";
  if (r > 1.1) return "3:2";
  if (r < 0.67) return "9:16";
  if (r < 0.9) return "2:3";
  return "1:1";
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
