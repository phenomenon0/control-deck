/**
 * Ollama adapter — the canonical implementation.
 * Mirrors the existing /api/ollama/tags + /api/ollama/ps routes but
 * slots into the common adapter shape.
 */

import type {
  InstalledModelEntry,
  LoadedModelEntry,
  ProviderAdapter,
  ProviderHealth,
} from "./types";
import { resolveProviderUrl } from "../settings";

function baseUrl(): string {
  return resolveProviderUrl("ollama");
}

interface OllamaTag {
  name: string;
  model: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaPs {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  digest: string;
  expires_at: string;
}

export const ollamaAdapter: ProviderAdapter = {
  id: "ollama",
  label: "Ollama",
  origin: "ollama.com",
  resolveUrl: baseUrl,
  capabilities: {
    // Ollama loads a model on first generation request implicitly. We expose
    // explicit load via a zero-token /api/generate with keep_alive=5m.
    load: true,
    unload: true,
  },

  async health(): Promise<ProviderHealth> {
    const url = baseUrl();
    const start = Date.now();
    try {
      const res = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      });
      if (!res.ok) return { online: false, url };
      return { online: true, url, latencyMs: Date.now() - start };
    } catch {
      return { online: false, url };
    }
  },

  async listInstalled(): Promise<InstalledModelEntry[]> {
    try {
      const res = await fetch(`${baseUrl()}/api/tags`, {
        signal: AbortSignal.timeout(2500),
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models: OllamaTag[] };
      return (data.models ?? []).map((m) => ({
        name: m.name,
        displayName: m.name,
        quant: m.details?.quantization_level,
        params: m.details?.parameter_size,
        family: m.details?.family,
        sizeBytes: m.size,
      }));
    } catch {
      return [];
    }
  },

  async listLoaded(): Promise<LoadedModelEntry[]> {
    try {
      const res = await fetch(`${baseUrl()}/api/ps`, {
        signal: AbortSignal.timeout(2500),
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models: OllamaPs[] };
      return (data.models ?? []).map((m) => ({
        name: m.name,
        sizeVramBytes: m.size_vram,
        sizeBytes: m.size,
        expiresAt: m.expires_at,
      }));
    } catch {
      return [];
    }
  },

  async load(name: string): Promise<void> {
    // Zero-token generate with a positive keep_alive warms the model into
    // VRAM without producing output. Mirrors the unload trick with the
    // opposite sign.
    const res = await fetch(`${baseUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, prompt: "", keep_alive: "5m", stream: false }),
    });
    if (!res.ok) throw new Error(`load failed: ${res.status}`);
  },

  async unload(name: string): Promise<void> {
    const res = await fetch(`${baseUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, prompt: "", keep_alive: 0, stream: false }),
    });
    if (!res.ok) throw new Error(`unload failed: ${res.status}`);
  },
};
