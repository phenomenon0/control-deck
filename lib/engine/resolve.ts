/**
 * Model router — the deck's single answer to "which LLM?".
 *
 * Replaces four independent selectors that used to drift apart:
 *   - lib/llm/providers.ts env trio + runtimeOverride   (folded in below)
 *   - lib/hardware/settings.ts provider URLs            (called, not edited)
 *   - lib/inference/text-binding.ts slot binding        (consumed via readSlotBinding)
 *   - per-call-site hardcoded ollama URL reads        (folded into baseUrlFor)
 *
 * Precedence (strict order):
 *
 *   resolveModelRoute(opts):
 *     slot = opts.slot ?? "text::primary"
 *
 *     1. request   opts.requested.provider / .model — an explicit per-request
 *                  pick (chat composer providerId + DeckPrefs model). A
 *                  partial pick inherits the unresolved fields from the
 *                  highest lower level.
 *     2. binding   slot binding from the inference control plane
 *                  (lib/inference/runtime, written by the Modalities UI /
 *                  PUT /api/inference/bindings, persisted to
 *                  data/inference-bindings.json). The legacy in-memory
 *                  runtimeOverride (setRuntimeProvider via POST /api/backend)
 *                  sits in this tier, BELOW a real slot binding — same as the
 *                  old chat route, which overlaid the binding on top of the
 *                  override-bearing ProviderSlots.
 *     3. settings  settings DB provider URLs — consulted INSIDE every level
 *                  via resolveProviderUrl() whenever a local engine's base
 *                  URL is needed and no explicit URL was pinned at a higher
 *                  level. (settings.ts stores URLs, not provider identity,
 *                  so it shapes baseUrl rather than picking a provider.)
 *     4. env       the LLM_* vocabulary from the old providers.ts:
 *                  LLM_PROVIDER / LLM_BASE_URL / LLM_MODEL / LLM_API_KEY for
 *                  the primary slot; LLM_FAST_*, LLM_VISION_*,
 *                  LLM_EMBEDDING_* for their slots. Per-provider keys
 *                  (OPENAI_API_KEY, ANTHROPIC_API_KEY, …) fill apiKey.
 *     5. default   local Ollama: resolveProviderUrl("ollama") + "/v1",
 *                  model = PROVIDERS.ollama.defaultModels[0].
 *
 *   Non-primary slots with no binding and no slot env fall through to the
 *   primary chain (mirrors the old title-gen / chat vision fallbacks).
 *
 * Env vocabulary is unchanged — LLM_* only, no new names.
 */

import {
  PROVIDERS,
  createProviderClient,
  type ProviderConfig,
  type ProviderSlots,
  type ProviderType,
} from "./provider-catalog";
import { resolveProviderUrl } from "@/lib/hardware/settings";
import type { SettingsProviderId } from "@/lib/settings/schema";
import { MODALITIES, type Modality, type SlotBinding } from "@/lib/inference/types";

// ── Pinned contract ────────────────────────────────────────────────

export type RouteSource = "request" | "binding" | "settings" | "env" | "default";

export interface ModelRoute {
  provider: string;   // e.g. "ollama", "openai-compat", "anthropic"
  model: string;      // served model id
  baseUrl: string;    // OpenAI-compatible base URL
  apiKey?: string;
  source: RouteSource;
}

export interface ResolveOptions {
  requested?: { provider?: string; model?: string } | null;
  slot?: string;      // default "text::primary"
}

const DEFAULT_SLOT = "text::primary";

/** Slot → env prefix. Only these slots have an env vocabulary (kept from providers.ts). */
const SLOT_ENV_PREFIX: Record<string, string> = {
  "text::primary": "LLM_",
  "text::fast": "LLM_FAST_",
  "vision::primary": "LLM_VISION_",
  "embedding::primary": "LLM_EMBEDDING_",
};

/** Local engines (canonical llm vocab) → settings provider id for resolveProviderUrl. */
const LOCAL_ENGINE_SETTINGS_ID: Record<string, SettingsProviderId> = {
  ollama: "ollama",
  vllm: "vllm",
  llama_server: "llamacpp",
  lmstudio: "lm-studio",
};

/** Aliases seen in bindings / request bodies → canonical PROVIDERS id. */
const PROVIDER_ID_ALIASES: Record<string, string> = {
  llamacpp: "llama_server",
  "llama-swap": "llama_server",
  "llama-cpp": "llama_server",
  "lm-studio": "lmstudio",
};

/** Last-resort model when a level can't name one — matches the old getDefaultModel fallback. */
const ULTIMATE_FALLBACK_MODEL = PROVIDERS.ollama.defaultModels[0];

function normalizeProviderId(id: string): string {
  return PROVIDER_ID_ALIASES[id] ?? id;
}

function defaultModelFor(provider: string): string | undefined {
  return PROVIDERS[provider as ProviderType]?.defaultModels[0];
}

/**
 * Base URL for a provider, OpenAI-compatible shape (local engines get /v1
 * appended; resolveProviderUrl strips any existing /v1 first). Explicit
 * URLs (binding-pinned, env-pinned) win verbatim. Returns null for an
 * unknown provider with no explicit URL — the caller treats that level as
 * absent (same as the old text-binding `if (!info) return null`).
 */
function baseUrlFor(provider: string, explicit?: string): string | null {
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, "");
  const settingsId = LOCAL_ENGINE_SETTINGS_ID[provider];
  if (settingsId) return `${resolveProviderUrl(settingsId)}/v1`;
  return PROVIDERS[provider as ProviderType]?.defaultBaseURL ?? null;
}

/** API key from the env vocabulary for a provider: per-provider key, then unified LLM_API_KEY. */
function apiKeyFromEnv(provider: string): string | undefined {
  return getProviderEnvApiKey(provider as ProviderType) ?? process.env.LLM_API_KEY;
}

function parseSlot(slot: string): { modality: Modality | null; slotName: string } {
  const [modality, slotName] = slot.split("::");
  const valid = (Object.keys(MODALITIES) as string[]).includes(modality);
  return { modality: valid ? (modality as Modality) : null, slotName: slotName || "primary" };
}

/**
 * Read a slot binding from the inference control plane. Lazy require breaks
 * the module cycle (bootstrap → text/register → this module) and mirrors
 * the lazy-settings idiom in lib/hardware/settings.ts. Failure (e.g.
 * registry unavailable) degrades to "no binding" rather than breaking chat.
 */
function readSlotBindingLazy(modality: Modality, slotName: string): SlotBinding | null {
  try {
    const tb = require("@/lib/inference/text-binding") as typeof import("@/lib/inference/text-binding");
    return tb.readSlotBinding(modality, slotName);
  } catch {
    return null;
  }
}

// ── Resolution levels ──────────────────────────────────────────────

/** Level 2: slot binding (text::primary, vision::primary, text::fast, …). */
function bindingRoute(slot: string): ModelRoute | null {
  const { modality, slotName } = parseSlot(slot);
  if (!modality) return null;
  const binding = readSlotBindingLazy(modality, slotName);
  if (!binding) return null;
  const provider = normalizeProviderId(binding.providerId);
  const baseUrl = baseUrlFor(provider, binding.config.baseURL);
  if (!baseUrl) return null; // unknown provider without a URL — ignore the binding
  return {
    provider,
    model: binding.config.model ?? defaultModelFor(provider) ?? ULTIMATE_FALLBACK_MODEL,
    baseUrl,
    apiKey: binding.config.apiKey ?? apiKeyFromEnv(provider),
    source: "binding",
  };
}

/**
 * Level 2b: legacy in-memory runtimeOverride (POST /api/backend). Kept in
 * the binding tier, below a real slot binding — the old chat route applied
 * them in exactly that order. Primary slot only, as before.
 */
function legacyOverrideRoute(slot: string): ModelRoute | null {
  if (slot !== DEFAULT_SLOT || !runtimeOverride) return null;
  const provider = normalizeProviderId(runtimeOverride.provider);
  return {
    provider,
    model: runtimeOverride.model ?? defaultModelFor(provider) ?? ULTIMATE_FALLBACK_MODEL,
    baseUrl: runtimeOverride.baseURL
      ?? baseUrlFor(provider)
      ?? `${resolveProviderUrl("ollama")}/v1`,
    apiKey: runtimeOverride.apiKey ?? apiKeyFromEnv(provider),
    source: "binding",
  };
}

/** Level 4: LLM_* env vocabulary (legacy parseProviderConfig, unchanged). */
function envRoute(slot: string): ModelRoute | null {
  const prefix = SLOT_ENV_PREFIX[slot];
  if (!prefix) return null;
  const hasAny = ["PROVIDER", "BACKEND", "API_KEY", "BASE_URL", "MODEL", "DEFAULT_MODEL"]
    .some((k) => process.env[`${prefix}${k}`]);
  if (!hasAny) return null;
  const cfg = parseProviderConfig(prefix);
  if (!cfg) return null;
  const provider = normalizeProviderId(cfg.provider);
  // Local engine without an explicit env URL → settings chain (settings DB →
  // provider env override → localhost). Anything else keeps the legacy
  // parse result (incl. the cloud LLM_BASE_URL heuristic).
  const baseUrl =
    !process.env[`${prefix}BASE_URL`] && LOCAL_ENGINE_SETTINGS_ID[provider]
      ? baseUrlFor(provider)!
      : cfg.baseURL ?? baseUrlFor(provider) ?? `${resolveProviderUrl("ollama")}/v1`;
  return {
    provider,
    model: cfg.model ?? defaultModelFor(provider) ?? ULTIMATE_FALLBACK_MODEL,
    baseUrl,
    apiKey: cfg.apiKey,
    source: "env",
  };
}

/** Level 5: local Ollama through the settings chain. */
function defaultRoute(): ModelRoute {
  return {
    provider: "ollama",
    model: ULTIMATE_FALLBACK_MODEL,
    baseUrl: `${resolveProviderUrl("ollama")}/v1`,
    source: "default",
  };
}

/** Levels 2–5 for a slot; non-primary slots fall through to the primary chain. */
function baseRoute(slot: string): ModelRoute {
  return (
    bindingRoute(slot) ??
    legacyOverrideRoute(slot) ??
    envRoute(slot) ??
    (slot !== DEFAULT_SLOT ? baseRoute(DEFAULT_SLOT) : defaultRoute())
  );
}

/** Level 1: explicit request pick overlays the lower levels. */
function requestRoute(
  requested: { provider?: string; model?: string },
  slot: string,
): ModelRoute {
  const base = baseRoute(slot);
  if (requested.provider) {
    const provider = normalizeProviderId(requested.provider);
    // Model: explicit pick > same-provider inherited > provider catalog
    // default > inherited. (The old chat route inherited the configured
    // model when only an engine was picked; the catalog default keeps a
    // cross-provider jump from dragging an unservable model id with it.)
    const model =
      requested.model ??
      (provider === base.provider ? base.model : undefined) ??
      defaultModelFor(provider) ??
      base.model;
    return {
      provider,
      model,
      baseUrl: baseUrlFor(provider) ?? base.baseUrl,
      apiKey: apiKeyFromEnv(provider) ?? (provider === base.provider ? base.apiKey : undefined),
      source: "request",
    };
  }
  return { ...base, model: requested.model ?? base.model, source: "request" };
}

/**
 * Resolve the model route for a request. See the module doc for precedence.
 */
export async function resolveModelRoute(opts: ResolveOptions = {}): Promise<ModelRoute> {
  const slot = opts.slot ?? DEFAULT_SLOT;
  const requested = opts.requested ?? undefined;
  if (requested && (requested.provider || requested.model)) {
    return requestRoute(requested, slot);
  }
  return baseRoute(slot);
}

/**
 * AI SDK client for a resolved route — bridge for generateText/streamText
 * call sites migrating off createProviderClient(getProviderConfig()…).
 */
export function createClientForRoute(route: ModelRoute) {
  return createProviderClient({
    provider: route.provider as ProviderType,
    apiKey: route.apiKey,
    baseURL: route.baseUrl,
    model: route.model,
  });
}

// ── Legacy sync API (originally from lib/llm/providers.ts) ─────────
//
// These functions keep their EXACT old semantics — env-only parsing,
// in-memory runtimeOverride for primary, cached slots — because existing
// consumers (app/api/backend) and lib/engine/legacy-api.test.ts pin that
// behavior. New code should use resolveModelRoute() above instead.

let cachedSlots: ProviderSlots | null = null;

/** Runtime override for primary provider (set via UI) */
let runtimeOverride: ProviderConfig | null = null;

/** Get provider-specific API key from environment */
function getProviderEnvApiKey(provider: ProviderType): string | undefined {
  switch (provider) {
    case "openai": return process.env.OPENAI_API_KEY;
    case "anthropic": return process.env.ANTHROPIC_API_KEY;
    case "google": return process.env.GOOGLE_API_KEY;
    case "deepseek": return process.env.DEEPSEEK_API_KEY;
    case "openrouter": return process.env.OPENROUTER_API_KEY;
    case "huggingface": return process.env.HUGGINGFACE_API_KEY;
    default: return undefined;
  }
}

/** Check if provider is a cloud provider with fixed API endpoint */
function isCloudProvider(provider: ProviderType): boolean {
  return ["openai", "anthropic", "google", "deepseek", "openrouter", "huggingface"].includes(provider);
}

function parseProviderConfig(prefix: string): ProviderConfig | undefined {
  const providerEnv = process.env[`${prefix}PROVIDER`] || process.env[`${prefix}BACKEND`];
  if (!providerEnv && prefix !== "LLM_") return undefined;

  const provider = (providerEnv as ProviderType) || "ollama";
  const providerInfo = PROVIDERS[provider];

  // API key precedence: slot-specific > provider-specific > unified LLM_API_KEY
  const apiKey = process.env[`${prefix}API_KEY`]
    || getProviderEnvApiKey(provider)
    || process.env.LLM_API_KEY;

  // For cloud providers, ignore generic LLM_BASE_URL (use provider's default)
  // Only use LLM_BASE_URL for local providers like ollama, llama_server, etc.
  const envBaseURL = process.env[`${prefix}BASE_URL`];
  const baseURL = isCloudProvider(provider)
    ? (envBaseURL?.includes(provider) ? envBaseURL : providerInfo?.defaultBaseURL)
    : (envBaseURL || providerInfo?.defaultBaseURL);

  return {
    provider,
    apiKey,
    baseURL,
    model: process.env[`${prefix}MODEL`] || process.env[`${prefix}DEFAULT_MODEL`],
    organization: process.env[`${prefix}ORG`],
    project: process.env[`${prefix}PROJECT`],
  };
}

/**
 * Get provider configuration from environment (with runtime override).
 *
 * NOTE on the two model-storage layers: this function's return value is
 * the SERVER-SIDE default, sourced from env LLM_* variables + any
 * `setRuntimeProvider` override from /api/backend. It is NOT synced with
 * `DeckPrefs.model` (localStorage), which is the user's client-side pick.
 *
 * @deprecated Legacy sync API kept for not-yet-migrated consumers. New code
 * should call resolveModelRoute(), which additionally honours slot
 * bindings and settings-DB provider URLs.
 */
export function getProviderConfig(): ProviderSlots {
  // Runtime override takes precedence for primary slot
  if (runtimeOverride) {
    return {
      primary: runtimeOverride,
      fast: parseProviderConfig("LLM_FAST_"),
      vision: parseProviderConfig("LLM_VISION_"),
      embedding: parseProviderConfig("LLM_EMBEDDING_"),
    };
  }

  if (cachedSlots) return cachedSlots;

  const primary = parseProviderConfig("LLM_") || {
    provider: "ollama" as ProviderType,
    baseURL: "http://localhost:11434/v1",
  };

  cachedSlots = {
    primary,
    fast: parseProviderConfig("LLM_FAST_"),
    vision: parseProviderConfig("LLM_VISION_"),
    embedding: parseProviderConfig("LLM_EMBEDDING_"),
  };

  return cachedSlots;
}

/**
 * Set runtime provider override (for UI switching)
 */
export function setRuntimeProvider(config: ProviderConfig | null): void {
  runtimeOverride = config;
}

/**
 * Get the current runtime override (if any)
 */
export function getRuntimeProvider(): ProviderConfig | null {
  return runtimeOverride;
}

/**
 * Clear cached config (for runtime changes)
 */
export function clearProviderConfigCache(): void {
  cachedSlots = null;
}

/**
 * Get a client for a specific slot
 * @deprecated use resolveModelRoute() + createClientForRoute()
 */
export function getClient(slot: keyof ProviderSlots = "primary") {
  const config = getProviderConfig()[slot];
  if (!config) throw new Error(`Provider slot "${slot}" not configured`);
  return createProviderClient(config);
}

/**
 * Get the model instance for a slot with its default model
 * @deprecated use resolveModelRoute() + createClientForRoute()
 */
export function getModel(slot: keyof ProviderSlots = "primary") {
  const config = getProviderConfig()[slot];
  if (!config) throw new Error(`Provider slot "${slot}" not configured`);

  const client = createProviderClient(config);
  const modelName = config.model || PROVIDERS[config.provider]?.defaultModels[0];

  if (!modelName) {
    throw new Error(`No model specified for slot "${slot}" and provider "${config.provider}" has no default`);
  }

  return client(modelName);
}

/**
 * Get the default model name for a slot
 * @deprecated use resolveModelRoute()
 */
export function getDefaultModel(slot: keyof ProviderSlots = "primary"): string | undefined {
  const config = getProviderConfig()[slot];
  return config?.model || PROVIDERS[config?.provider || "ollama"]?.defaultModels[0];
}

/**
 * Get current slot's provider type
 * @deprecated use resolveModelRoute()
 */
export function getProviderType(slot: keyof ProviderSlots = "primary"): ProviderType {
  return getProviderConfig()[slot]?.provider || "ollama";
}
