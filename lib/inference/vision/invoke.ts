/**
 * Per-provider vision invocation. Same dispatch pattern as tts/invoke.ts
 * and stt/invoke.ts — one switch, one case per provider, each case speaks
 * the provider's native image-in-chat format.
 *
 * Coverage targets the same providers already in the text slot so a user
 * with an OpenAI key for chat automatically gets a Vision fallback when
 * Ollama's llama3.2-vision is unreachable.
 */

import { resolveProviderUrl } from "@/lib/hardware/settings";
import { acquire, release } from "@/lib/resource/arbiter";

import type { InferenceProviderConfig } from "../types";
import type { VisionArgs, VisionImage, VisionResult } from "./types";

const OLLAMA_DEFAULT = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

// Conservative default — most vision models (llama3.2-vision:11b, qwen-vl-7b)
// sit around 8 GB once loaded. Caller can override via args.estimateMb.
const VISION_DEFAULT_ESTIMATE_MB = 8000;

async function withVisionLane<T>(
  args: VisionArgs,
  model: string,
  run: () => Promise<T>,
): Promise<T> {
  const acq = await acquire({
    lane: "vision",
    estimateMb: args.estimateMb ?? VISION_DEFAULT_ESTIMATE_MB,
    reason: `vision: ${model}`,
    modelId: model,
    priority: "interactive",
    evicts: "hard",
    restoreOnIdle: false,
  });
  if (acq.status !== "granted") {
    throw new Error(`vision lane denied: ${acq.reason ?? acq.status}`);
  }
  try {
    return await run();
  } finally {
    release(acq.ticket!);
  }
}
const OPENAI_BASE = "https://api.openai.com/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const LLAMA_SWAP_DEFAULT = `${resolveProviderUrl("llamacpp")}/v1`;

export async function invokeVision(
  providerId: string,
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  switch (providerId) {
    case "ollama": {
      const model = args.model ?? config.model ?? "llama3.2-vision:11b";
      return withVisionLane(args, model, () => invokeOllama(config, args));
    }
    case "anthropic":
      return invokeAnthropic(config, args);
    case "openai":
      return invokeOpenAi(config, args);
    case "google":
      return invokeGoogle(config, args);
    case "openrouter":
      return invokeOpenRouter(config, args);
    case "openai-compat":
    case "llama-swap":
    case "llama-cpp": {
      const model = args.model ?? config.model ?? "qwen3.5-9b";
      return withVisionLane(args, model, () => invokeOpenAiCompat(config, args));
    }
    default:
      throw new Error(`vision provider not supported: ${providerId}`);
  }
}

function mimeOf(img: VisionImage): string {
  return img.mimeType ?? "image/png";
}

async function ensureBase64(img: VisionImage): Promise<string> {
  if (img.base64) return img.base64;
  if (img.url) {
    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`fetch image URL ${img.url}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }
  throw new Error("vision: neither base64 nor url supplied");
}

function toDataUrl(img: VisionImage, base64: string): string {
  return `data:${mimeOf(img)};base64,${base64}`;
}

/** Ollama /api/generate — preserves the existing call shape. */
async function invokeOllama(
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  const base = config.baseURL ?? OLLAMA_DEFAULT;
  const model = args.model ?? config.model ?? "llama3.2-vision:11b";
  const base64 = await ensureBase64(args.image);
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: args.prompt,
      images: [base64],
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`ollama-vision ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { response?: string; prompt_eval_count?: number; eval_count?: number };
  return {
    text: String(data.response ?? ""),
    providerId: "ollama",
    inputTokens: data.prompt_eval_count,
    outputTokens: data.eval_count,
  };
}

/** Anthropic /v1/messages with an image content block. */
async function invokeAnthropic(
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("anthropic: ANTHROPIC_API_KEY not set");
  const model = args.model ?? config.model ?? "claude-sonnet-4-20250514";
  const base64 = await ensureBase64(args.image);
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens ?? 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeOf(args.image), data: base64 },
            },
            { type: "text", text: args.prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`anthropic-vision ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return {
    text,
    providerId: "anthropic",
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  };
}

/** OpenAI /v1/chat/completions with image_url content (data URL supported inline). */
async function invokeOpenAi(
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai: OPENAI_API_KEY not set");
  const model = args.model ?? config.model ?? "gpt-4o";
  const imageUrl = args.image.url ?? toDataUrl(args.image, await ensureBase64(args.image));
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens ?? 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: args.prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`openai-vision ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: String(data.choices?.[0]?.message?.content ?? ""),
    providerId: "openai",
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

/**
 * Local OpenAI-compatible endpoint (llama-swap / llama.cpp / vLLM in OAI mode).
 * Uses the same image_url content shape as the cloud OpenAI case but skips the
 * API key requirement, since the local server typically doesn't enforce auth.
 */
async function invokeOpenAiCompat(
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  const base = config.baseURL ?? LLAMA_SWAP_DEFAULT;
  const model = args.model ?? config.model ?? "qwen3.5-9b";
  const imageUrl = args.image.url ?? toDataUrl(args.image, await ensureBase64(args.image));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = config.apiKey ?? process.env.LLAMA_SWAP_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens ?? 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: args.prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`openai-compat-vision ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: String(data.choices?.[0]?.message?.content ?? ""),
    providerId: "openai-compat",
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

/** Google Gemini generateContent with inlineData part. */
async function invokeGoogle(
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  const apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("google: GOOGLE_API_KEY not set");
  const model = args.model ?? config.model ?? "gemini-1.5-pro";
  const base64 = await ensureBase64(args.image);
  const url = `${GOOGLE_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mimeOf(args.image), data: base64 } },
            { text: args.prompt },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: args.maxTokens ?? 1024,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`google-vision ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return {
    text,
    providerId: "google",
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

/** OpenRouter — OpenAI-compatible, routes to any vision-capable model by id. */
async function invokeOpenRouter(
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("openrouter: OPENROUTER_API_KEY not set");
  const model = args.model ?? config.model ?? "anthropic/claude-3.5-sonnet";
  const imageUrl = args.image.url ?? toDataUrl(args.image, await ensureBase64(args.image));
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens ?? 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: args.prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`openrouter-vision ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: String(data.choices?.[0]?.message?.content ?? ""),
    providerId: "openrouter",
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}
