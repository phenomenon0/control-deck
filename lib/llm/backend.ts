/**
 * LLM Backend Abstraction Layer
 * Supports: Ollama, llama-server, vLLM, OpenAI (all OpenAI-compatible)
 * 
 * Environment variables:
 *   LLM_PROVIDER      - Backend type: ollama | llama_server | vllm | openai (default: ollama); alias for LLM_BACKEND
 *   LLM_BACKEND       - Legacy alias for LLM_PROVIDER (LLM_PROVIDER takes precedence)
 *   LLM_BASE_URL      - Base URL with /v1 suffix (default: http://localhost:11434/v1)
 *   LLM_API_KEY       - API key (optional for local backends)
 *   LLM_DEFAULT_MODEL - Default model name
 * 
 *   LLM_VISION_BACKEND, LLM_VISION_BASE_URL, LLM_VISION_API_KEY, LLM_VISION_MODEL
 *   LLM_FAST_BACKEND, LLM_FAST_BASE_URL, LLM_FAST_API_KEY, LLM_FAST_MODEL
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type BackendType = "ollama" | "llama_server" | "vllm" | "openai";

export interface BackendConfig {
  type: BackendType;
  baseURL: string;
  apiKey?: string;
  defaultModel?: string;
}

export interface BackendSlot {
  primary: BackendConfig;
  fast?: BackendConfig;
  vision?: BackendConfig;
}

function normBaseURL(u: string): string {
  return u.replace(/\/+$/, "");
}

let cachedConfig: BackendSlot | null = null;

/**
 * Get backend configuration from environment variables
 * Caches result for performance
 */
export function getBackendConfig(): BackendSlot {
  if (cachedConfig) return cachedConfig;

  const primary: BackendConfig = {
    type: ((process.env.LLM_PROVIDER ?? process.env.LLM_BACKEND ?? "ollama").toLowerCase() as BackendType),
    baseURL: normBaseURL(process.env.LLM_BASE_URL ?? "http://localhost:11434/v1"),
    apiKey: process.env.LLM_API_KEY,
    defaultModel: process.env.LLM_DEFAULT_MODEL,
  };

  const visionEnv = process.env.LLM_VISION_BACKEND;
  const vision: BackendConfig | undefined = visionEnv
    ? {
        type: visionEnv as BackendType,
        baseURL: normBaseURL(process.env.LLM_VISION_BASE_URL ?? primary.baseURL),
        apiKey: process.env.LLM_VISION_API_KEY ?? primary.apiKey,
        defaultModel: process.env.LLM_VISION_MODEL ?? "llama3.2-vision:11b",
      }
    : undefined;

  const fastEnv = process.env.LLM_FAST_BACKEND;
  const fast: BackendConfig | undefined = fastEnv
    ? {
        type: fastEnv as BackendType,
        baseURL: normBaseURL(process.env.LLM_FAST_BASE_URL ?? primary.baseURL),
        apiKey: process.env.LLM_FAST_API_KEY ?? primary.apiKey,
        defaultModel: process.env.LLM_FAST_MODEL,
      }
    : undefined;

  cachedConfig = { primary, fast, vision };
  return cachedConfig;
}

/**
 * Clear cached config (useful for testing or runtime config changes)
 */
export function clearBackendConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get an AI SDK OpenAI-compatible client for a backend slot
 * Usage: const client = getClient("primary"); const result = await generateText({ model: client("qwen2.5:7b"), ... })
 */
export function getClient(slot: keyof BackendSlot = "primary") {
  const cfg = getBackendConfig()[slot];
  if (!cfg) throw new Error(`Backend slot "${slot}" not configured`);

  return createOpenAICompatible({
    name: `${cfg.type}-${slot}`,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey ?? "local", // Some servers require non-empty; "local" is conventional
  });
}

/**
 * Get the default model for a backend slot
 */
export function getDefaultModel(slot: keyof BackendSlot = "primary"): string | undefined {
  return getBackendConfig()[slot]?.defaultModel;
}

/**
 * Health check for a backend (OpenAI-compatible: GET /models)
 */
export async function checkBackendHealth(cfg: BackendConfig): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${cfg.baseURL}/models`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * List models from a backend (OpenAI-compatible: GET /models)
 * Returns model IDs/names
 */
export async function listBackendModels(cfg: BackendConfig): Promise<string[]> {
  try {
    const res = await fetch(`${cfg.baseURL}/models`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    // OpenAI format: { data: [{ id: "model-name" }] }
    // Ollama format via /v1/models: { data: [{ id: "model:tag" }] }
    return data.data?.map((m: { id: string }) => m.id) ?? [];
  } catch {
    return [];
  }
}

/**
 * Get the raw base URL for a backend (without /v1 suffix)
 * Useful for backends that have non-OpenAI endpoints (e.g., Ollama's /api/tags)
 */
export function getRawBaseURL(slot: keyof BackendSlot = "primary"): string {
  const cfg = getBackendConfig()[slot];
  if (!cfg) throw new Error(`Backend slot "${slot}" not configured`);
  // Strip /v1 suffix if present
  return cfg.baseURL.replace(/\/v1$/, "");
}
