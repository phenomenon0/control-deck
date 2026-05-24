/**
 * Probe whether an inference binding's target provider is actually reachable.
 *
 * Why: `data/inference-bindings.json` can point a modality slot at any
 * provider (ollama, llama_server, vllm, lmstudio…). If the configured
 * target's daemon isn't running, every chat request silently fails with
 * "Cannot connect to API" and the deck looks broken. Discovered while
 * driving the running app — see lib/inference/text-binding.ts for the
 * callsite that consults this module before honouring a binding.
 *
 * Strategy:
 *   - For LOCAL providers (`requiresApiKey === false`) we probe the
 *     models endpoint with a short timeout. If the server is offline the
 *     request fails fast and we mark unreachable.
 *   - For CLOUD providers we don't probe (their auth errors are a
 *     different class, and probing costs API calls). Always reachable
 *     from this module's POV.
 *   - Results are TTL-cached per `provider|baseURL` key so chat doesn't
 *     pay the probe cost on every request.
 *
 * Pure module: the env (fetch, now) is injectable to make it
 * unit-testable in plain bun:test without network or timers.
 */

import { PROVIDERS, type ProviderConfig } from "@/lib/llm/providers";

export interface BindingHealth {
  /** True when the provider answered (or was a cloud provider we skipped). */
  reachable: boolean;
  /** Short message when unreachable; undefined when reachable. */
  error?: string;
  /** Wall-clock ms when this entry was sampled. */
  sampledAt: number;
}

export interface BindingHealthEnv {
  /** ms timestamp source — injectable for tests. */
  now: () => number;
  /** Fetch shape; defaults to global fetch. */
  fetch: (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;
  /** ms before a cached probe is considered stale. */
  ttlMs: number;
  /** Request timeout (per probe) in ms. */
  timeoutMs: number;
  /** Log channel for fallback warnings — `console.warn` in prod. */
  warn: (msg: string) => void;
}

const DEFAULT_ENV: BindingHealthEnv = {
  now: () => Date.now(),
  fetch: globalThis.fetch.bind(globalThis),
  ttlMs: 30_000,
  timeoutMs: 1_500,
  warn: (msg) => console.warn(msg),
};

const cache = new Map<string, BindingHealth>();
const warnedKeys = new Set<string>();

export function __resetForTests(): void {
  cache.clear();
  warnedKeys.clear();
}

function cacheKey(cfg: ProviderConfig): string {
  return `${cfg.provider}|${cfg.baseURL ?? ""}`;
}

function modelsProbeUrl(cfg: ProviderConfig): string | null {
  const info = PROVIDERS[cfg.provider];
  if (!info) return null;
  const base = (cfg.baseURL ?? info.defaultBaseURL ?? "").replace(/\/$/, "");
  if (!base) return null;
  // Ollama has both /v1/models (OpenAI-compat) and /api/tags (native).
  // /api/tags answers without any model loaded and is the canonical health
  // check; /v1/models also works once the daemon is up. Use /api/tags for
  // ollama specifically — it's the safer probe.
  if (cfg.provider === "ollama") {
    const root = base.replace(/\/v1$/, "");
    return `${root}/api/tags`;
  }
  const suffix = info.modelsEndpoint ?? "/models";
  return `${base}${suffix.startsWith("/") ? "" : "/"}${suffix}`;
}

/**
 * Probe `cfg`'s reachability, returning a cached result when fresh. For
 * cloud providers (requiresApiKey === true) always returns `{ reachable:
 * true }` without a network call — see module docstring.
 */
export async function probeBindingHealth(
  cfg: ProviderConfig,
  envOverride?: Partial<BindingHealthEnv>,
): Promise<BindingHealth> {
  const env = { ...DEFAULT_ENV, ...envOverride };
  const info = PROVIDERS[cfg.provider];
  if (!info) {
    return { reachable: false, error: `unknown provider '${cfg.provider}'`, sampledAt: env.now() };
  }
  if (info.requiresApiKey) {
    return { reachable: true, sampledAt: env.now() };
  }

  const key = cacheKey(cfg);
  const cached = cache.get(key);
  if (cached && env.now() - cached.sampledAt < env.ttlMs) {
    return cached;
  }

  const url = modelsProbeUrl(cfg);
  if (!url) {
    const result: BindingHealth = {
      reachable: false,
      error: "no probe URL resolvable",
      sampledAt: env.now(),
    };
    cache.set(key, result);
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.timeoutMs);
  try {
    const res = await env.fetch(url, { signal: controller.signal });
    const result: BindingHealth = res.ok
      ? { reachable: true, sampledAt: env.now() }
      : { reachable: false, error: `HTTP ${res.status}`, sampledAt: env.now() };
    cache.set(key, result);
    if (result.reachable) {
      // Clear any prior warn-dedup so the next outage re-warns.
      warnedKeys.delete(key);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: BindingHealth = {
      reachable: false,
      error: message,
      sampledAt: env.now(),
    };
    cache.set(key, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Log a single structured warning per provider|baseURL key, until that
 * binding becomes reachable again (a successful probe clears the dedup).
 * Callers invoke this when they decide to fall back to the env default.
 */
export function warnOnceForUnreachableBinding(
  cfg: ProviderConfig,
  health: BindingHealth,
  envOverride?: Partial<BindingHealthEnv>,
): void {
  const env = { ...DEFAULT_ENV, ...envOverride };
  const key = cacheKey(cfg);
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  const where = cfg.baseURL ?? PROVIDERS[cfg.provider]?.defaultBaseURL ?? "(no url)";
  env.warn(
    `[inference] binding target ${cfg.provider} @ ${where} unreachable (${health.error ?? "unknown"}). Falling back to env-based default. Fix: start the daemon, or repoint data/inference-bindings.json text::primary to a live provider.`,
  );
}
