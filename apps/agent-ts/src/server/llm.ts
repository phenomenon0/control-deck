/**
 * LLM resolution — maps the wire-level `LLMOverrideWire` (provider preset +
 * baseUrl + model + apiKey) to a pi-ai `Model<"openai-completions">` plus an
 * optional API key.
 *
 * Mirrors the provider preset table in Agent-GO's `handleStartRun`. We use
 * `openai-completions` for everything because the upstream stack already
 * picked OpenAI-compatible endpoints (Ollama `/v1`, DeepSeek, Cerebras, etc.).
 */

import type { Model, Provider } from "@mariozechner/pi-ai";
import type { LLMOverrideWire } from "../wire.js";

export interface ResolvedLLM {
  model: Model<"openai-completions">;
  apiKey?: string;
  baseUrl: string;
  modelId: string;
}

interface ProviderDefaults {
  baseUrl: string;
  defaultModel: string;
  provider: Provider;
}

const PROVIDER_PRESETS: Record<string, ProviderDefaults> = {
  llamacpp: {
    baseUrl: "http://localhost:8080/v1",
    defaultModel: "",
    provider: "openai",
  },
  "llama.cpp": {
    baseUrl: "http://localhost:8080/v1",
    defaultModel: "",
    provider: "openai",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen3:8b",
    provider: "openai",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    provider: "deepseek",
  },
  "deepseek-r1": {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-reasoner",
    provider: "deepseek",
  },
  "deepseek-reasoner": {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-reasoner",
    provider: "deepseek",
  },
  "deepseek-coder": {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-coder",
    provider: "deepseek",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    provider: "cerebras",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    provider: "openrouter",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
  },
};

function defaultBase(): string {
  const raw = process.env.LLM_BASE_URL ?? process.env.LLAMACPP_BASE_URL;
  if (!raw) return "http://localhost:8080/v1";
  const trimmed = raw.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return `${trimmed}/v1`;
}

const SERVER_DEFAULTS: ProviderDefaults = {
  baseUrl: defaultBase(),
  defaultModel:
    process.env.LLM_MODEL ?? process.env.LLAMACPP_MODEL ?? process.env.OLLAMA_MODEL ?? "",
  provider: "openai",
};

function envApiKey(provider: Provider): string | undefined {
  const map: Record<string, string | undefined> = {
    deepseek: process.env.DEEPSEEK_API_KEY,
    cerebras: process.env.CEREBRAS_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  return map[provider as string];
}

/**
 * Cache the served model list per baseUrl. llama-swap can route between a
 * handful of models, so we keep the whole list and let callers pick. TTL
 * is short so model swaps don't get masked.
 */
interface ModelCacheEntry {
  models: string[];
  expiresAt: number;
}
const REMOTE_MODEL_CACHE = new Map<string, ModelCacheEntry>();
const REMOTE_MODEL_TTL_MS = 30_000;

async function fetchServedModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const cached = REMOTE_MODEL_CACHE.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      signal: ctrl.signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (data?.data ?? [])
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === "string");
    REMOTE_MODEL_CACHE.set(baseUrl, {
      models: ids,
      expiresAt: Date.now() + REMOTE_MODEL_TTL_MS,
    });
    return ids;
  } catch {
    return [];
  }
}

export async function resolveLLM(override: LLMOverrideWire | undefined): Promise<ResolvedLLM> {
  let baseUrl = SERVER_DEFAULTS.baseUrl;
  let modelId = SERVER_DEFAULTS.defaultModel;
  let provider: Provider = SERVER_DEFAULTS.provider;
  let apiKey: string | undefined;

  if (override?.provider) {
    const preset = PROVIDER_PRESETS[override.provider.toLowerCase()];
    if (preset) {
      baseUrl = preset.baseUrl;
      modelId = preset.defaultModel;
      provider = preset.provider;
    }
  }

  if (override?.base_url) baseUrl = override.base_url;
  if (override?.model) modelId = override.model;
  if (override?.api_key) apiKey = override.api_key;
  if (!apiKey) apiKey = envApiKey(provider);

  // Local LLM endpoints (llama-server, ollama, lm-studio) don't need an
  // API key, but pi-ai's openai-completions client throws if it's empty.
  // Detect localhost and inject a dummy key so the request actually goes
  // out. The real OpenAI endpoint still requires OPENAI_API_KEY.
  const isLocalHost =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?\b/i.test(baseUrl);
  if (!apiKey && isLocalHost) apiKey = "local-no-auth";

  // llama-server binds one model at startup; llama-swap can route between
  // a few. Either way, if the resolved id isn't in /v1/models we'd 400 on
  // the first request. Snap to a served id so chat works even when the
  // upstream caller forwards a stale default.
  if (provider === "openai" || isLocalHost) {
    const served = await fetchServedModels(baseUrl, apiKey);
    if (served.length > 0 && (!modelId || !served.includes(modelId))) {
      modelId = served[0];
    }
  }

  const model: Model<"openai-completions"> = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 4096,
  };

  return { model, apiKey, baseUrl, modelId };
}
