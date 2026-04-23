/**
 * Register the 11 existing text-LLM providers from lib/llm/providers.ts into
 * the unified inference registry.
 *
 * Delegation, not duplication: health checks and model listings call through
 * to `checkProviderHealth` / `listProviderModels` in lib/llm/providers.ts so
 * any fix or new provider there flows here automatically.
 *
 * Note: providers like OpenAI, Anthropic, Google, and Ollama technically
 * serve multiple modalities (vision, embedding, tts, stt). We register them
 * with modality=["text"] only in this first pass — each additional modality
 * gets claimed when the corresponding adapter actually knows how to route
 * invocations for it. Keeps the provider picker honest.
 */

import {
  PROVIDERS,
  type ProviderType,
  checkProviderHealth,
  listProviderModels,
} from "@/lib/llm/providers";
import { registerProvider } from "../registry";
import type { InferenceProvider, InferenceProviderConfig, Modality } from "../types";

const TEXT: Modality[] = ["text"];

function asLegacyConfig(config: InferenceProviderConfig): {
  provider: ProviderType;
  apiKey?: string;
  baseURL?: string;
  model?: string;
} {
  return {
    provider: config.providerId as ProviderType,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
  };
}

let registered = false;

export function registerTextProviders(): void {
  if (registered) return;
  registered = true;

  for (const info of Object.values(PROVIDERS)) {
    const provider: InferenceProvider = {
      id: info.id,
      name: info.name,
      description: info.description,
      modalities: TEXT,
      requiresApiKey: info.requiresApiKey,
      defaultBaseURL: info.defaultBaseURL,
      defaultModels: { text: info.defaultModels },
      checkHealth: (config) => checkProviderHealth(asLegacyConfig(config)),
      listModels: async (_modality, config) => listProviderModels(asLegacyConfig(config)),
    };
    registerProvider(provider);
  }
}
