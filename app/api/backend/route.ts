/**
 * Unified Backend/Provider Info API
 * Returns provider configuration, available models, and health status
 * 
 * GET /api/backend - Get provider info and available models
 * POST /api/backend - Update provider configuration (runtime)
 */

import { NextResponse } from "next/server";
import {
  getProviderConfig,
  checkProviderHealth,
  listProviderModels,
  setRuntimeProvider,
  PROVIDERS,
  type ProviderType,
  type ProviderSlots,
  type ProviderConfig,
} from "@/lib/llm";

export interface ProviderInfoResponse {
  provider: ProviderType;
  name: string;
  baseURL?: string;
  defaultModel?: string;
  healthy: boolean;
  models: string[];
  slots: {
    primary: SlotInfo;
    fast?: SlotInfo;
    vision?: SlotInfo;
    embedding?: SlotInfo;
  };
  availableProviders: Array<{
    id: ProviderType;
    name: string;
    description: string;
    requiresApiKey: boolean;
  }>;
}

interface SlotInfo {
  provider: ProviderType;
  name: string;
  model?: string;
  healthy: boolean;
  hasApiKey: boolean;
}

/**
 * GET /api/backend - Get provider info and available models
 */
export async function GET() {
  const config = getProviderConfig();
  const primary = config.primary;
  const providerInfo = PROVIDERS[primary.provider];

  try {
    // Check health and get models in parallel
    const [healthy, models] = await Promise.all([
      checkProviderHealth(primary),
      listProviderModels(primary),
    ]);

    // Build model list - ensure default model is included
    let modelList = models;
    if (primary.model && !models.includes(primary.model)) {
      modelList = [primary.model, ...models];
    }

    // Build slot info for all configured slots
    const slots: ProviderInfoResponse["slots"] = {
      primary: {
        provider: primary.provider,
        name: PROVIDERS[primary.provider].name,
        model: primary.model,
        healthy,
        hasApiKey: !!primary.apiKey,
      },
    };

    // Check other slots if configured
    if (config.fast) {
      const fastHealthy = await checkProviderHealth(config.fast);
      slots.fast = {
        provider: config.fast.provider,
        name: PROVIDERS[config.fast.provider].name,
        model: config.fast.model,
        healthy: fastHealthy,
        hasApiKey: !!config.fast.apiKey,
      };
    }

    if (config.vision) {
      const visionHealthy = await checkProviderHealth(config.vision);
      slots.vision = {
        provider: config.vision.provider,
        name: PROVIDERS[config.vision.provider].name,
        model: config.vision.model,
        healthy: visionHealthy,
        hasApiKey: !!config.vision.apiKey,
      };
    }

    if (config.embedding) {
      const embeddingHealthy = await checkProviderHealth(config.embedding);
      slots.embedding = {
        provider: config.embedding.provider,
        name: PROVIDERS[config.embedding.provider].name,
        model: config.embedding.model,
        healthy: embeddingHealthy,
        hasApiKey: !!config.embedding.apiKey,
      };
    }

    // List of all available providers
    const availableProviders = Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      requiresApiKey: p.requiresApiKey,
    }));

    const response: ProviderInfoResponse = {
      provider: primary.provider,
      name: providerInfo.name,
      baseURL: primary.baseURL,
      defaultModel: primary.model,
      healthy,
      models: modelList,
      slots,
      availableProviders,
    };

    return NextResponse.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    
    return NextResponse.json(
      {
        provider: primary.provider,
        name: providerInfo.name,
        baseURL: primary.baseURL,
        defaultModel: primary.model,
        healthy: false,
        models: primary.model ? [primary.model] : providerInfo.defaultModels,
        slots: {
          primary: {
            provider: primary.provider,
            name: providerInfo.name,
            model: primary.model,
            healthy: false,
            hasApiKey: !!primary.apiKey,
          },
        },
        availableProviders: Object.values(PROVIDERS).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          requiresApiKey: p.requiresApiKey,
        })),
        error: msg,
      } as ProviderInfoResponse & { error: string },
      { status: 502 }
    );
  }
}

/**
 * POST /api/backend - Set provider or fetch models for a specific provider
 * Body: { provider: ProviderType, model?: string, apiKey?: string, baseURL?: string, setActive?: boolean }
 * 
 * If setActive=true, sets this provider as the active runtime provider
 * Otherwise just fetches models for the provider (for UI preview)
 */
export async function POST(req: Request) {
  let body: { 
    provider?: ProviderType; 
    model?: string;
    apiKey?: string; 
    baseURL?: string;
    setActive?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider, model, apiKey, baseURL, setActive } = body;

  if (!provider || !PROVIDERS[provider]) {
    return NextResponse.json(
      { error: `Invalid provider. Available: ${Object.keys(PROVIDERS).join(", ")}` },
      { status: 400 }
    );
  }

  const providerInfo = PROVIDERS[provider];
  
  // Build the config, using env vars as fallback for API keys
  const config: ProviderConfig = {
    provider,
    model: model || providerInfo.defaultModels[0],
    apiKey: apiKey || getProviderApiKey(provider),
    baseURL: baseURL || providerInfo.defaultBaseURL,
  };

  try {
    const [healthy, models] = await Promise.all([
      checkProviderHealth(config),
      listProviderModels(config),
    ]);

    // If setActive, update the runtime provider
    if (setActive) {
      setRuntimeProvider(config);
    }

    return NextResponse.json({
      provider,
      name: providerInfo.name,
      healthy,
      models: models.length > 0 ? models : providerInfo.defaultModels,
      defaultModels: providerInfo.defaultModels,
      active: setActive || false,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        provider,
        name: providerInfo.name,
        healthy: false,
        models: providerInfo.defaultModels,
        defaultModels: providerInfo.defaultModels,
        error: msg,
      },
      { status: 502 }
    );
  }
}

/** Get API key from environment for a provider */
function getProviderApiKey(provider: ProviderType): string | undefined {
  switch (provider) {
    case "openai": return process.env.OPENAI_API_KEY;
    case "anthropic": return process.env.ANTHROPIC_API_KEY;
    case "google": return process.env.GOOGLE_API_KEY;
    case "deepseek": return process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;
    case "openrouter": return process.env.OPENROUTER_API_KEY;
    case "huggingface": return process.env.HUGGINGFACE_API_KEY;
    default: return process.env.LLM_API_KEY;
  }
}
