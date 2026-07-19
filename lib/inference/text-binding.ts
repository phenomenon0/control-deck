/**
 * Slot-binding storage reads for the model router.
 *
 * The inference control plane (`lib/inference/runtime.ts` slot bindings —
 * driven by the Modalities UI and `/api/inference/bindings`, persisted to
 * data/inference-bindings.json) is the "binding" tier of the model router.
 *
 * Resolution itself lives in `lib/engine/resolve.ts` (`resolveModelRoute`).
 * This module keeps only the storage-read API (`readSlotBinding`) plus a
 * deprecated legacy-shape adapter for callers not yet migrated.
 */
import { ensureBootstrap, getSlot } from "./bootstrap";
import { applyPersistedBindings } from "./persistence";
import type { Modality, SlotBinding } from "./types";
import { PROVIDERS, type ProviderType, type ProviderConfig } from "@/lib/engine/provider-catalog";

/**
 * Read the current binding for a (modality, slot) pair, or null when the
 * slot is unbound.
 *
 * Re-reads persisted bindings from disk on every call so workers that
 * bootstrapped before the most recent PUT still see the new binding.
 * applyPersistedBindings() is idempotent (just `bindSlot` per entry)
 * and runs in microseconds, so the safety overhead is negligible.
 */
export function readSlotBinding(modality: Modality, slotName = "primary"): SlotBinding | null {
  ensureBootstrap();
  applyPersistedBindings();
  return getSlot(modality, slotName) ?? null;
}

/**
 * @deprecated Use `resolveModelRoute({ slot: "text::primary" })` from
 * `@/lib/engine/resolve` — it subsumes this overlay plus the env/default
 * fallbacks every caller used to wire up by hand.
 *
 * Bridge: inference bindings (`text::primary` slot) → legacy ProviderConfig.
 * Returns null when no binding is set (caller should keep its fallback).
 */
export function resolveTextProviderFromBinding(): ProviderConfig | null {
  const binding = readSlotBinding("text", "primary");
  if (!binding) return null;
  const providerId = binding.providerId as ProviderType;
  const info = PROVIDERS[providerId];
  if (!info) return null;
  return {
    provider: providerId,
    apiKey: binding.config.apiKey,
    baseURL: binding.config.baseURL ?? info.defaultBaseURL,
    model: binding.config.model,
  };
}
