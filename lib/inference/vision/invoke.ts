/**
 * Per-provider vision invocation. Same dispatch pattern as tts/invoke.ts
 * and stt/invoke.ts — one switch, one case per provider, each case speaks
 * the provider's native image-in-chat format.
 *
 * Coverage targets the same providers already in the text slot so a user
 * with an OpenAI key for chat automatically gets a Vision fallback when
 * Ollama's llama3.2-vision is unreachable.
 */

import type { InferenceProviderConfig } from "../types";
import type { VisionArgs, VisionImage, VisionResult } from "./types";

const OLLAMA_DEFAULT = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OPENAI_BASE = "https://api.openai.com/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export async function invokeVision(
  providerId: string,
  config: InferenceProviderConfig,
  args: VisionArgs,
): Promise<VisionResult> {
  switch (providerId) {
    case "ollama":
      return invokeOllama(config, args);
    case "anthropic":
      return invokeAnthropic(config, args);
    case "openai":
      return invokeOpenAi(config, args);
    case "google":
      return invokeGoogle(config, args);
    case "openrouter":
      return invokeOpenRouter(config, args);
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
