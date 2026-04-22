/**
 * Generic OpenAI-compatible adapter. Reused by llamafile / LocalAI / Jan /
 * MLX and anything else speaking the `/v1/models` dialect. Provides health
 * check + installed-model listing. Load/unload are not universally
 * supported in OpenAI-compat land, so they're omitted at this layer.
 */

import type { InstalledModelEntry, LoadedModelEntry, ProviderHealth } from "./types";

export interface OpenAICompatConfig {
  url: string;
  /** Optional API key for cloud-compat endpoints. */
  apiKey?: string;
  /** Timeout for each request in ms. */
  timeoutMs?: number;
}

interface OpenAIModelRow {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

async function request<T>(path: string, cfg: OpenAICompatConfig): Promise<T | null> {
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}${path}`, {
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 2000),
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function openAiCompatHealth(cfg: OpenAICompatConfig): Promise<ProviderHealth> {
  const start = Date.now();
  const data = await request<{ data?: OpenAIModelRow[] }>("/v1/models", cfg);
  if (data === null) {
    return { online: false, url: cfg.url };
  }
  return { online: true, url: cfg.url, latencyMs: Date.now() - start };
}

export async function openAiCompatInstalled(cfg: OpenAICompatConfig): Promise<InstalledModelEntry[]> {
  const data = await request<{ data?: OpenAIModelRow[] }>("/v1/models", cfg);
  if (!data?.data) return [];
  return data.data.map((row) => ({
    name: row.id,
    displayName: row.id,
    sizeBytes: 0,
  }));
}

/**
 * OpenAI-compat has no standard loaded-model endpoint. Most implementations
 * treat "listed by /v1/models" as "available" rather than "in VRAM".
 * Callers should not depend on this returning non-empty.
 */
export async function openAiCompatLoaded(_cfg: OpenAICompatConfig): Promise<LoadedModelEntry[]> {
  return [];
}
