/**
 * LM Studio adapter. The desktop server runs on localhost:1234 by default
 * and exposes both /v1/models (OpenAI-compat) and /api/v0/models (richer
 * with `loaded: bool`). We use /api/v0 for installed+loaded tracking and
 * fall back to /v1 on health when v0 isn't reachable.
 */

import type {
  InstalledModelEntry,
  LoadedModelEntry,
  ProviderAdapter,
  ProviderHealth,
} from "./types";
import { resolveProviderUrl } from "../settings";

function baseUrl(): string {
  return resolveProviderUrl("lm-studio");
}

interface LmsModel {
  id: string;
  object: string;
  type?: string;
  publisher?: string;
  arch?: string;
  compatibility_type?: string;
  quantization?: string;
  state?: "loaded" | "not-loaded" | string;
  max_context_length?: number;
  loaded_context_length?: number;
}

async function fetchV0(): Promise<LmsModel[] | null> {
  try {
    const res = await fetch(`${baseUrl()}/api/v0/models`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data: LmsModel[] };
    return data.data ?? [];
  } catch {
    return null;
  }
}

export const lmstudioAdapter: ProviderAdapter = {
  id: "lm-studio",
  label: "LM Studio",
  origin: "lmstudio.ai",
  resolveUrl: baseUrl,
  capabilities: {
    load: true,
    unload: true,
  },

  async health(): Promise<ProviderHealth> {
    const url = baseUrl();
    const start = Date.now();
    const v0 = await fetchV0();
    if (v0 !== null) return { online: true, url, latencyMs: Date.now() - start };
    // Fallback: /v1/models probe
    try {
      const res = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      });
      if (res.ok) return { online: true, url, latencyMs: Date.now() - start };
    } catch {
      /* fall through */
    }
    return { online: false, url };
  },

  async listInstalled(): Promise<InstalledModelEntry[]> {
    const v0 = await fetchV0();
    if (v0 === null) return [];
    return v0.map((m) => ({
      name: m.id,
      displayName: m.id,
      quant: m.quantization,
      family: m.arch,
      sizeBytes: 0,
    }));
  },

  async listLoaded(): Promise<LoadedModelEntry[]> {
    const v0 = await fetchV0();
    if (v0 === null) return [];
    return v0
      .filter((m) => m.state === "loaded")
      .map((m) => ({
        name: m.id,
        sizeVramBytes: 0,
        sizeBytes: 0,
      }));
  },

  async load(name: string): Promise<void> {
    // LM Studio's v0 API takes a POST to /api/v0/models/load with either
    // `model` or `model_id` depending on version. We send both for safety —
    // the server ignores unknown fields.
    const res = await fetch(`${baseUrl()}/api/v0/models/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, model_id: name }),
    });
    if (!res.ok) throw new Error(`LM Studio load failed: ${res.status}`);
  },

  async unload(name: string): Promise<void> {
    const res = await fetch(`${baseUrl()}/api/v0/models/unload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, model_id: name }),
    });
    if (!res.ok) throw new Error(`LM Studio unload failed: ${res.status}`);
  },
};
