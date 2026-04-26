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
 * Cache the model id we resolved from /v1/models for a given baseUrl. This
 * avoids hammering llama-server on every run; the inflight server only
 * binds one model per process so the answer is stable.
 */
const REMOTE_MODEL_CACHE = new Map<string, string>();

async function fetchFirstModel(baseUrl: string, apiKey?: string): Promise<string | null> {
  const cached = REMOTE_MODEL_CACHE.get(baseUrl);
  if (cached) return cached;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      signal: ctrl.signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const id = data?.data?.[0]?.id;
    if (id) {
      REMOTE_MODEL_CACHE.set(baseUrl, id);
      return id;
    }
    return null;
  } catch {
    return null;
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

  // llama-server binds one model at startup. When the operator hasn't
  // pinned LLM_MODEL, ask /v1/models for the live id so the request
  // doesn't 400 with model="".
  if (!modelId) {
    const remote = await fetchFirstModel(baseUrl, apiKey);
    if (remote) modelId = remote;
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
