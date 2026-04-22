/**
 * Vision (image-understanding) providers.
 *
 * Default: Ollama llama3.2-vision:11b — preserves the behaviour that
 * lib/tools/executor.ts:executeAnalyzeImage used to have hardcoded. Cloud
 * providers plug in as alternate slot bindings when the user has API keys
 * for them, giving a cross-provider fallback when the local Ollama vision
 * model is unreachable.
 *
 * Env vars:
 *   VISION_PROVIDER  ollama | anthropic | openai | google | openrouter
 *                    (default: ollama — preserves the existing behaviour)
 *   VISION_MODEL     default model id for the bound provider
 *   OLLAMA_BASE_URL  existing — used when provider is ollama
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY
 *                    — reused from the text slot
 */

import { registerProvider, getProvider } from "../registry";
import { bindSlot } from "../runtime";
import type { InferenceProvider, Modality } from "../types";

interface ProviderSeed {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseURL?: string;
  defaultModels: string[];
}

const SEEDS: ProviderSeed[] = [
  {
    id: "ollama",
    name: "Ollama",
    description: "Local vision models (llama3.2-vision, llava, bakllava)",
    requiresApiKey: false,
    defaultBaseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    defaultModels: ["llama3.2-vision:11b", "llava:13b", "bakllava"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Sonnet 4 / 3.5 vision",
    requiresApiKey: true,
    defaultBaseURL: "https://api.anthropic.com/v1",
    defaultModels: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o / GPT-4o mini vision",
    requiresApiKey: true,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "google",
    name: "Google Gemini",
    description: "Gemini 2.0 / 1.5 Pro vision",
    requiresApiKey: true,
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    defaultModels: ["gemini-2.0-flash-exp", "gemini-1.5-pro"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Route to any vision-capable model via OpenRouter",
    requiresApiKey: true,
    defaultBaseURL: "https://openrouter.ai/api/v1",
    defaultModels: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-pro-1.5"],
  },
];

let registered = false;

export function registerVisionProviders(): void {
  if (registered) return;
  registered = true;

  for (const seed of SEEDS) {
    const prior = getProvider(seed.id);
    const modalities = mergeModalities(prior?.modalities, "vision");
    const next: InferenceProvider = {
      id: seed.id,
      name: seed.name,
      description: prior?.description ?? seed.description,
      modalities,
      requiresApiKey: prior?.requiresApiKey ?? seed.requiresApiKey,
      defaultBaseURL: prior?.defaultBaseURL ?? seed.defaultBaseURL,
      defaultModels: { ...(prior?.defaultModels ?? {}), vision: seed.defaultModels },
      checkHealth: prior?.checkHealth,
      listModels: prior?.listModels,
    };
    registerProvider(next);
  }

  // Default-bind the primary vision slot from env so callers have something
  // to fall back to even before the Settings UI touches it. Preserves the
  // current VISION_MODEL env var that executor.ts used to read directly.
  const providerEnv = (process.env.VISION_PROVIDER ?? "ollama").toLowerCase();
  if (SEEDS.some((s) => s.id === providerEnv)) {
    bindSlot({
      modality: "vision",
      slotName: "primary",
      providerId: providerEnv,
      config: {
        providerId: providerEnv,
        model: process.env.VISION_MODEL,
        baseURL: providerEnv === "ollama" ? process.env.OLLAMA_BASE_URL : undefined,
      },
    });
  }
}

function mergeModalities(
  prior: Modality[] | undefined,
  adding: Modality,
): Modality[] {
  const set = new Set<Modality>(prior ?? []);
  set.add(adding);
  return [...set];
}
