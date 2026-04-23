/**
 * Per-provider 3D-generation invocation. Scope: cloud providers. ComfyUI
 * Hunyuan 3D v2.1 workflow at lib/tools/executor.ts:executeImageTo3D stays
 * on its existing path; this adapter activates when THREE_D_GEN_PROVIDER
 * is set.
 */

import type { InferenceProviderConfig } from "../types";
import type { ThreeDGenArgs, ThreeDGenResult } from "./types";

const MESHY_BASE = "https://api.meshy.ai/v2";
const LUMA_BASE = "https://api.lumalabs.ai/dream-machine/v1";
const TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi";
const REPLICATE_BASE = "https://api.replicate.com/v1";

const PREDICTION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

export async function invoke3dGen(
  providerId: string,
  config: InferenceProviderConfig,
  args: ThreeDGenArgs,
): Promise<ThreeDGenResult> {
  switch (providerId) {
    case "meshy":
      return invokeMeshy(config, args);
    case "luma":
      return invokeLumaGenie(config, args);
    case "tripo":
      return invokeTripo(config, args);
    case "replicate":
      return invokeReplicate(config, args);
    default:
      throw new Error(`3d-gen provider not supported: ${providerId}`);
  }
}

/** Meshy — POST /text-to-3d or /image-to-3d, poll /v2/{task_id}. */
async function invokeMeshy(
  config: InferenceProviderConfig,
  args: ThreeDGenArgs,
): Promise<ThreeDGenResult> {
  const apiKey = config.apiKey ?? process.env.MESHY_API_KEY;
  if (!apiKey) throw new Error("meshy: MESHY_API_KEY not set");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const mode = args.image ? "image-to-3d" : "text-to-3d";
  const body: Record<string, unknown> = {
    mode: "preview",
    art_style: args.extras?.art_style ?? "realistic",
  };
  if (args.image) {
    body.image_url = args.image.url ?? `data:${args.image.mimeType ?? "image/png"};base64,${args.image.base64}`;
  } else {
    body.prompt = args.prompt ?? "";
  }
  const submit = await fetch(`${MESHY_BASE}/${mode}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`meshy-submit ${submit.status}: ${await submit.text()}`);
  const { result: taskId } = (await submit.json()) as { result?: string };
  if (!taskId) throw new Error("meshy: submit returned no task id");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("meshy: task timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${MESHY_BASE}/${mode}/${encodeURIComponent(taskId)}`, { headers });
    if (!r.ok) throw new Error(`meshy-poll ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      status?: string;
      model_urls?: { glb?: string };
      thumbnail_url?: string;
    };
    if (j.status === "SUCCEEDED" && j.model_urls?.glb) {
      return {
        meshUrl: j.model_urls.glb,
        mime: "model/gltf-binary",
        previewUrl: j.thumbnail_url,
        providerId: "meshy",
      };
    }
    if (j.status === "FAILED" || j.status === "CANCELED") {
      throw new Error(`meshy: task ${j.status}`);
    }
  }
}

/** Luma Genie — POST /generations with type=3d, poll /generations/:id. */
async function invokeLumaGenie(
  config: InferenceProviderConfig,
  args: ThreeDGenArgs,
): Promise<ThreeDGenResult> {
  const apiKey = config.apiKey ?? process.env.LUMA_API_KEY;
  if (!apiKey) throw new Error("luma: LUMA_API_KEY not set");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const body = {
    prompt: args.prompt ?? "",
    type: "3d",
    ...(args.extras ?? {}),
  };
  const submit = await fetch(`${LUMA_BASE}/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`luma-3d-submit ${submit.status}: ${await submit.text()}`);
  const { id } = (await submit.json()) as { id?: string };
  if (!id) throw new Error("luma-3d: no id");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("luma-3d: timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${LUMA_BASE}/generations/${encodeURIComponent(id)}`, { headers });
    if (!r.ok) throw new Error(`luma-3d-poll ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      state?: string;
      assets?: { mesh?: string; image?: string };
      failure_reason?: string;
    };
    if (j.state === "completed" && j.assets?.mesh) {
      return {
        meshUrl: j.assets.mesh,
        mime: "model/gltf-binary",
        previewUrl: j.assets.image,
        providerId: "luma",
      };
    }
    if (j.state === "failed") {
      throw new Error(`luma-3d: ${j.failure_reason ?? "failed"}`);
    }
  }
}

/** Tripo3D — POST /task, poll /task/:id. */
async function invokeTripo(
  config: InferenceProviderConfig,
  args: ThreeDGenArgs,
): Promise<ThreeDGenResult> {
  const apiKey = config.apiKey ?? process.env.TRIPO_API_KEY;
  if (!apiKey) throw new Error("tripo: TRIPO_API_KEY not set");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const body: Record<string, unknown> = args.image
    ? { type: "image_to_model", file: { url: args.image.url } }
    : { type: "text_to_model", prompt: args.prompt ?? "" };
  const submit = await fetch(`${TRIPO_BASE}/task`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`tripo-submit ${submit.status}: ${await submit.text()}`);
  const submitJson = (await submit.json()) as { data?: { task_id?: string } };
  const taskId = submitJson.data?.task_id;
  if (!taskId) throw new Error("tripo: no task_id");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("tripo: timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const r = await fetch(`${TRIPO_BASE}/task/${encodeURIComponent(taskId)}`, { headers });
    if (!r.ok) throw new Error(`tripo-poll ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      data?: {
        status?: string;
        output?: { model?: string; rendered_image?: string };
      };
    };
    const d = j.data;
    if (d?.status === "success" && d.output?.model) {
      return {
        meshUrl: d.output.model,
        mime: "model/gltf-binary",
        previewUrl: d.output.rendered_image,
        providerId: "tripo",
      };
    }
    if (d?.status === "failed" || d?.status === "cancelled") {
      throw new Error(`tripo: task ${d.status}`);
    }
  }
}

/** Replicate — aggregator for TripoSR, InstantMesh, Hunyuan3D, etc. */
async function invokeReplicate(
  config: InferenceProviderConfig,
  args: ThreeDGenArgs,
): Promise<ThreeDGenResult> {
  const apiKey = config.apiKey ?? process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error("replicate: REPLICATE_API_TOKEN not set");
  const version = args.model ?? config.model;
  if (!version) throw new Error("replicate: model version required for 3d-gen");
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    image: args.image?.url,
    seed: args.seed,
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
  if (!res.ok) throw new Error(`replicate-3d ${res.status}: ${await res.text()}`);
  let pred = (await res.json()) as {
    id?: string;
    status?: string;
    output?: string | string[] | Record<string, string>;
    error?: string;
    urls?: { get?: string };
  };
  const started = Date.now();
  while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
    if (Date.now() - started > PREDICTION_TIMEOUT_MS) {
      throw new Error("replicate-3d: timed out");
    }
    await sleep(POLL_INTERVAL_MS);
    const pollUrl = pred.urls?.get ?? `${REPLICATE_BASE}/predictions/${pred.id}`;
    const r = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) throw new Error(`replicate-3d-poll ${r.status}: ${await r.text()}`);
    pred = (await r.json()) as typeof pred;
  }
  if (pred.status !== "succeeded") {
    throw new Error(`replicate-3d: ${pred.status} — ${pred.error ?? ""}`);
  }
  // Replicate 3D models return either a direct URL or an object with
  // { mesh: "...", thumbnail: "..." } depending on the model — handle both.
  let meshUrl: string | undefined;
  let previewUrl: string | undefined;
  const out = pred.output;
  if (typeof out === "string") meshUrl = out;
  else if (Array.isArray(out)) meshUrl = out[0];
  else if (out && typeof out === "object") {
    const obj = out as Record<string, string>;
    meshUrl = obj.mesh ?? obj.model ?? obj.glb;
    previewUrl = obj.thumbnail ?? obj.preview ?? obj.rendered_image;
  }
  if (!meshUrl) throw new Error("replicate-3d: no mesh URL in output");
  return { meshUrl, mime: "model/gltf-binary", previewUrl, providerId: "replicate" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
