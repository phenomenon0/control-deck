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
 * Returns null when no binding is set OR when the binding points at a
 * local provider whose daemon is unreachable (so callers fall through to
 * the env-based default instead of routing every chat at a dead URL).
 * See binding-health.ts for the probe contract.
 */
import { ensureBootstrap, getSlot } from "./bootstrap";
import { applyPersistedBindings } from "./persistence";
import { PROVIDERS, type ProviderType, type ProviderConfig } from "@/lib/llm/providers";
import { probeBindingHealth, warnOnceForUnreachableBinding } from "./binding-health";

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

/**
 * Async variant that drops the binding when its local target is unreachable.
 * Chat routes should prefer this — it preserves intent when the daemon is
 * up and gracefully falls back when it isn't, instead of failing every
 * request with "Cannot connect to API".
 *
 * Cloud providers are always considered reachable here (their auth errors
 * are surfaced at request time). The probe is TTL-cached so this is cheap.
 */
export async function resolveTextProviderFromBindingChecked(): Promise<ProviderConfig | null> {
  const cfg = resolveTextProviderFromBinding();
  if (!cfg) return null;
  const health = await probeBindingHealth(cfg);
  if (!health.reachable) {
    warnOnceForUnreachableBinding(cfg, health);
    return null;
  }
  return cfg;
}
