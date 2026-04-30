/**
 * Bridge: inference bindings (`text::primary` slot) → legacy ProviderConfig.
 *
 * The codebase has two parallel "which LLM does this server talk to?" stores:
 *   - `lib/inference/runtime.ts` slot bindings — driven by the Modalities UI
 *     and `/api/inference/bindings`. STT/TTS already consume these.
 *   - `lib/llm/providers.ts#getProviderConfig` — env-var-driven, used by the
 *     chat route and threads title-gen.
 *
 * Until the chat route is refactored to read bindings natively, this helper
 * lets API routes overlay the binding on top of the legacy config so that
 * "bind text::primary to X" actually drives chat output to provider X.
 *
 * Returns null when no binding is set (caller should keep its fallback).
 */
import { ensureBootstrap, getSlot } from "./bootstrap";
import { applyPersistedBindings } from "./persistence";
import { PROVIDERS, type ProviderType, type ProviderConfig } from "@/lib/llm/providers";

export function resolveTextProviderFromBinding(): ProviderConfig | null {
  ensureBootstrap();
  // Re-read persisted bindings from disk on every call so workers that
  // bootstrapped before the most recent PUT still see the new binding.
  // applyPersistedBindings() is idempotent (just `bindSlot` per entry)
  // and runs in microseconds, so the safety overhead is negligible.
  applyPersistedBindings();
  const binding = getSlot("text", "primary");
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
