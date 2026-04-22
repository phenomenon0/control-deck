/**
 * Central registry for inference providers.
 *
 * Providers call `registerProvider` at startup (via the per-modality
 * register.ts files, orchestrated through bootstrap.ts). Consumers ask the
 * registry for "all providers that serve modality X" without knowing the
 * concrete adapters.
 *
 * Shape mirrors lib/llm/providers.ts:PROVIDERS but modality-aware, so one
 * provider (e.g. OpenAI) can appear under multiple modality views without
 * being duplicated in storage.
 */

import type { InferenceProvider, Modality } from "./types";

const providers = new Map<string, InferenceProvider>();
const byModality = new Map<Modality, Set<string>>();

export function registerProvider(provider: InferenceProvider): void {
  if (providers.has(provider.id)) {
    // Last-write-wins so hot-reloading a provider during dev replaces the
    // earlier registration instead of hitting a duplicate-id error.
    providers.set(provider.id, provider);
    return;
  }
  providers.set(provider.id, provider);
  for (const modality of provider.modalities) {
    let set = byModality.get(modality);
    if (!set) {
      set = new Set();
      byModality.set(modality, set);
    }
    set.add(provider.id);
  }
}

export function getProvider(id: string): InferenceProvider | undefined {
  return providers.get(id);
}

export function listProvidersForModality(modality: Modality): InferenceProvider[] {
  const ids = byModality.get(modality);
  if (!ids) return [];
  const out: InferenceProvider[] = [];
  for (const id of ids) {
    const p = providers.get(id);
    if (p) out.push(p);
  }
  return out;
}

export function allProviders(): InferenceProvider[] {
  return [...providers.values()];
}

/** Test-only: clear the registry. Not exported to production consumers. */
export function __resetRegistry(): void {
  providers.clear();
  byModality.clear();
}
