/**
 * LLM Module - Multi-Provider Support
 * 
 * Provides backend-agnostic LLM access for Control Deck
 * Supports: OpenAI, Anthropic, Google, OpenRouter, HuggingFace, and local backends
 */

// New unified provider system
export {
  type ProviderType,
  type ProviderConfig,
  type ProviderSlots,
  type ProviderInfo,
  PROVIDERS,
  getProviderConfig,
  clearProviderConfigCache,
  setRuntimeProvider,
  getRuntimeProvider,
  createProviderClient,
  getClient,
  getModel,
  getDefaultModel,
  checkProviderHealth,
  listProviderModels,
  getProviderInfo,
  requiresApiKey,
  getProviderType,
} from "./providers";

