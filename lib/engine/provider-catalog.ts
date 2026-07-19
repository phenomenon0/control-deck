/**
 * Provider catalog — static provider metadata, AI SDK client construction,
 * health checks, and live model listing.
 *
 * This is the data/transport half of the old `lib/llm/providers.ts`. The
 * routing half ("which provider/model should this request use?") lives in
 * `lib/engine/resolve.ts` — new code should start there.
 *
 * Moved verbatim from lib/llm/providers.ts; that file (and its shim) was
 * deleted once every importer landed here.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
// Note: @ai-sdk/huggingface uses a different pattern - we handle it in createProviderClient

import { resolveProviderUrl } from "@/lib/hardware/settings";

const llamaSwapBaseV1 = (): string => `${resolveProviderUrl("llamacpp")}/v1`;

export type ProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "openrouter"
  | "huggingface"
  | "ollama"
  | "llama_server"
  | "vllm"
  | "lmstudio"
  | "custom"; // For any OpenAI-compatible endpoint

export interface ProviderConfig {
  provider: ProviderType;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Optional organization ID (OpenAI) */
  organization?: string;
  /** Optional project ID (OpenAI) */
  project?: string;
}

export interface ProviderSlots {
  primary: ProviderConfig;
  fast?: ProviderConfig;
  vision?: ProviderConfig;
  embedding?: ProviderConfig;
}

export interface ProviderInfo {
  id: ProviderType;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseURL?: string;
  modelsEndpoint?: string;
  defaultModels: string[];
}

export const PROVIDERS: Record<ProviderType, ProviderInfo> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, GPT-4, o1, o3 models",
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    modelsEndpoint: "/models",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview", "o1-mini"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 3.5 Sonnet, Claude 3 Opus, Haiku",
    requiresApiKey: true,
    defaultBaseURL: "https://api.anthropic.com",
    defaultModels: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"],
  },
  google: {
    id: "google",
    name: "Google AI",
    description: "Gemini 2.0, Gemini 1.5 Pro/Flash",
    requiresApiKey: true,
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    defaultModels: ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek V3.2 & Reasoner (128K, tools, JSON, thinking mode)",
    requiresApiKey: true,
    defaultBaseURL: "https://api.deepseek.com/v1",
    modelsEndpoint: "/models",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"], // V3.2 is the current deepseek-chat
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    description: "Unified gateway to 100+ models from all providers",
    requiresApiKey: true,
    defaultBaseURL: "https://openrouter.ai/api/v1",
    modelsEndpoint: "/models",
    defaultModels: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "google/gemini-pro-1.5",
      "meta-llama/llama-3.1-405b-instruct",
      "mistralai/mistral-large",
    ],
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    description: "Inference API for open models",
    requiresApiKey: true,
    defaultBaseURL: "https://api-inference.huggingface.co",
    defaultModels: [
      "meta-llama/Llama-3.1-70B-Instruct",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      "Qwen/Qwen2.5-72B-Instruct",
    ],
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local models via Ollama",
    requiresApiKey: false,
    defaultBaseURL: "http://localhost:11434/v1",
    modelsEndpoint: "/models",
    // Order matters: defaultModels[0] is the system-wide fallback whenever
    // no explicit slot.model is configured. Put broadly-installed Ollama
    // models first. qwen3:0.6b is tiny (~520 MB) and ships with the T1_MAC
    // hardware-tier bundle, making it the most likely-to-already-be-cached
    // default. llama3.2:3b kept as a deeper fallback for tier-3 setups.
    defaultModels: ["qwen3:0.6b", "qwen3:8b", "llama3.2:3b", "qwen2.5:7b", "mistral:7b", "codellama:13b"],
  },
  llama_server: {
    id: "llama_server",
    name: "llama.cpp Server",
    description: "Local llama.cpp server",
    requiresApiKey: false,
    defaultBaseURL: llamaSwapBaseV1(),
    modelsEndpoint: "/models",
    defaultModels: [],
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    description: "High-performance local inference",
    requiresApiKey: false,
    defaultBaseURL: "http://localhost:8000/v1",
    modelsEndpoint: "/models",
    defaultModels: [],
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local models via LM Studio",
    requiresApiKey: false,
    defaultBaseURL: "http://localhost:1234/v1",
    modelsEndpoint: "/models",
    defaultModels: [],
  },
  custom: {
    id: "custom",
    name: "Custom Endpoint",
    description: "Any OpenAI-compatible API",
    requiresApiKey: false,
    modelsEndpoint: "/models",
    defaultModels: [],
  },
};

/**
 * Create an AI SDK client for a provider config
 * Returns a function that takes a model name and returns a model instance
 */
export function createProviderClient(config: ProviderConfig) {
  const { provider, apiKey, baseURL, organization, project } = config;

  switch (provider) {
    case "openai":
      return createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        baseURL,
        organization,
        project,
      });

    case "anthropic":
      return createAnthropic({
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        baseURL,
      });

    case "google":
      return createGoogleGenerativeAI({
        apiKey: apiKey || process.env.GOOGLE_API_KEY,
        baseURL,
      });

    case "deepseek": {
      // DeepSeek V3.2: https://api-docs.deepseek.com/news/news251201
      // Uses OpenAI-compatible format with /v1 base path
      const deepseekKey = apiKey || process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;
      const deepseekURL = baseURL || "https://api.deepseek.com/v1";
      console.log("[DeepSeek] Creating client with baseURL:", deepseekURL, "hasKey:", !!deepseekKey);
      return createOpenAICompatible({
        name: "deepseek",
        apiKey: deepseekKey,
        baseURL: deepseekURL,
      });
    }

    case "openrouter":
      // OpenRouter is OpenAI-compatible with special headers
      return createOpenAI({
        apiKey: apiKey || process.env.OPENROUTER_API_KEY,
        baseURL: baseURL || "https://openrouter.ai/api/v1",
        // OpenRouter recommends these headers but they're optional
      });

    case "huggingface":
      // HuggingFace uses OpenAI-compatible endpoint for chat
      return createOpenAICompatible({
        name: "huggingface",
        apiKey: apiKey || process.env.HUGGINGFACE_API_KEY,
        baseURL: baseURL || "https://api-inference.huggingface.co/models",
      });

    case "ollama":
    case "llama_server":
    case "vllm":
    case "lmstudio":
    case "custom":
    default:
      // All local/custom backends use OpenAI-compatible
      return createOpenAICompatible({
        name: provider,
        apiKey: apiKey || "local", // Some servers need non-empty key
        baseURL: baseURL || PROVIDERS[provider]?.defaultBaseURL || llamaSwapBaseV1(),
      });
  }
}

/**
 * Check if a provider is healthy/reachable
 */
export async function checkProviderHealth(config: ProviderConfig): Promise<boolean> {
  const { provider, apiKey, baseURL } = config;
  const info = PROVIDERS[provider];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // Increased timeout

    // Different providers have different health check methods
    switch (provider) {
      case "deepseek": {
        // DeepSeek uses OpenAI-compatible /models endpoint
        const deepseekBase = baseURL || "https://api.deepseek.com/v1";
        const deepseekApiKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
        console.log("[DeepSeek Health] Checking:", deepseekBase, "hasKey:", !!deepseekApiKey);

        if (!deepseekApiKey) {
          console.warn("[DeepSeek Health] No API key found - set DEEPSEEK_API_KEY in .env.local");
          return false;
        }

        try {
          const res = await fetch(`${deepseekBase}/models`, {
            headers: { "Authorization": `Bearer ${deepseekApiKey}` },
            signal: controller.signal,
            cache: "no-store",
          });
          clearTimeout(timeout);
          console.log("[DeepSeek Health] Response status:", res.status);
          return res.ok;
        } catch (fetchError) {
          clearTimeout(timeout);
          console.error("[DeepSeek Health] Fetch error:", fetchError instanceof Error ? fetchError.message : fetchError);
          return false;
        }
      }

      case "anthropic": {
        // Anthropic doesn't have a models endpoint, just check if we can reach it
        // We'll do a minimal request that should fail gracefully
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey || "",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [] }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        // 400 means API is reachable (just invalid request)
        return res.status === 400 || res.status === 401 || res.ok;
      }

      case "google": {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        return res.ok;
      }

      default: {
        // OpenAI-compatible: use /models endpoint
        const modelsURL = `${baseURL || info?.defaultBaseURL}/models`;
        const headers: Record<string, string> = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const res = await fetch(modelsURL, {
          headers,
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timeout);
        return res.ok;
      }
    }
  } catch {
    return false;
  }
}

/**
 * List available models from a provider
 */
export async function listProviderModels(config: ProviderConfig): Promise<string[]> {
  const { provider, apiKey, baseURL } = config;
  const info = PROVIDERS[provider];

  try {
    switch (provider) {
      case "anthropic": {
        // Anthropic's `/v1/models` endpoint was added in late 2024 and is
        // now the authoritative source. Fall back to defaultModels only if
        // the fetch fails (missing API key, rate limit, network hiccup).
        try {
          const res = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
              "x-api-key": apiKey || "",
              "anthropic-version": "2023-06-01",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return info.defaultModels;
          const data = (await res.json()) as { data?: Array<{ id: string }> };
          const ids = (data.data || []).map((m) => m.id);
          return ids.length > 0 ? ids : info.defaultModels;
        } catch {
          return info.defaultModels;
        }
      }

      case "google": {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return info.defaultModels;
        const data = (await res.json()) as { models?: Array<{ name?: string }> };
        return (data.models || [])
          .filter((m) => m.name?.includes("gemini"))
          .map((m) => m.name?.replace("models/", ""))
          .filter((name): name is string => typeof name === "string");
      }

      case "openrouter": {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          cache: "no-store",
        });
        if (!res.ok) return info.defaultModels;
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return (data.data || []).map((m) => m.id).slice(0, 50);
      }

      case "huggingface":
        return info.defaultModels;

      default: {
        const modelsURL = `${baseURL || info?.defaultBaseURL}/models`;
        const headers: Record<string, string> = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const res = await fetch(modelsURL, { headers, cache: "no-store" });
        if (!res.ok) return info?.defaultModels || [];

        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return (data.data || []).map((m) => m.id);
      }
    }
  } catch {
    return info?.defaultModels || [];
  }
}

/**
 * Get provider info by type
 */
export function getProviderInfo(provider: ProviderType): ProviderInfo {
  return PROVIDERS[provider];
}

/**
 * Check if provider requires an API key
 */
export function requiresApiKey(provider: ProviderType): boolean {
  return PROVIDERS[provider]?.requiresApiKey ?? false;
}
