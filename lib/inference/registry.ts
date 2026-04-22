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
  const prior = providers.get(provider.id);
  providers.set(provider.id, provider);

  // If this is a re-registration (e.g. text-register ran first with
  // modalities=[text], then tts-register runs with modalities=[tts, text]),
  // drop the provider from any modality index it no longer claims.
  if (prior) {
    const nextSet = new Set(provider.modalities);
    for (const oldModality of prior.modalities) {
      if (!nextSet.has(oldModality)) {
        byModality.get(oldModality)?.delete(provider.id);
      }
    }
  }

  // Add (or keep) the provider in every modality index it currently claims.
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
