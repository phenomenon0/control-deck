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

const SERVER_DEFAULTS: ProviderDefaults = {
  baseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
  defaultModel: process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen3:8b",
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

export function resolveLLM(override: LLMOverrideWire | undefined): ResolvedLLM {
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
