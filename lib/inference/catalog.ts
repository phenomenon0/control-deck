/**
 * Live model catalog — two authoritative sources, no third-party aggregators.
 *
 * 1. **Provider-native `/models`** — the OpenAI / Anthropic / Google /
 *    DeepSeek / OpenRouter / Groq / Ollama / vLLM / llama.cpp endpoint. The
 *    provider you already send requests to is the authority for "what
 *    model ids does my key accept right now?". No additional trust surface.
 *
 * 2. **HuggingFace Hub `/api/models`** — authoritative for open-weight
 *    models across every modality. HF is the actual hosting channel, so
 *    asking them what exists is the most primary answer possible. Filtered
 *    by `pipeline_tag` per modality, gated on download count to shake out
 *    typosquats, and library-tag-filterable so callers can restrict to
 *    formats their backend can actually run (gguf for Ollama/llama.cpp,
 *    safetensors for vLLM, etc.).
 *
 * Cached 1h in-memory. No external catalogs, no bundled JSONs, nothing to
 * rot or get compromised.
 */

import type { InferenceProviderConfig, Modality } from "./types";
import {
  listProviderModels,
  type ProviderType,
} from "@/lib/llm/providers";

/** Map each modality to the HF Hub pipeline_tag(s) that describe it. */
const HF_PIPELINE_TAGS: Partial<Record<Modality, string[]>> = {
  text: ["text-generation"],
  vision: ["image-text-to-text"],
  "image-gen": ["text-to-image", "image-to-image"],
  "audio-gen": ["text-to-audio"],
  tts: ["text-to-speech"],
  stt: ["automatic-speech-recognition"],
  embedding: ["sentence-similarity", "feature-extraction"],
  rerank: ["text-classification"], // name-filtered client-side
  "3d-gen": ["image-to-3d", "text-to-3d"],
  "video-gen": ["text-to-video", "image-to-video"],
};

export type CatalogSource = "provider-native" | "hf-hub";

export interface CatalogEntry {
  /** Model id as the source returns it (e.g. "gpt-4o", "meta-llama/Llama-3.3-70B-Instruct"). */
  id: string;
  /** Which source returned this entry — useful for UI badging. */
  source: CatalogSource;
  /** Provider-native only: provider id (e.g. "openai"). HF entries leave this undefined. */
  provider?: string;
  /** HF only: total downloads — used for trust gating in the UI. */
  downloads?: number;
  /** HF only: tag list including pipeline_tag, library, task, etc. */
  tags?: string[];
  /** HF only: library name, e.g. "transformers", "gguf", "mlx", "diffusers". */
  library?: string;
}

interface CacheEntry {
  ts: number;
  data: CatalogEntry[];
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function now(): number {
  return Date.now();
}

function cacheKey(parts: Array<string | undefined>): string {
  return parts.map((p) => p ?? "").join("::");
}

function readCache(key: string): CatalogEntry[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function writeCache(key: string, data: CatalogEntry[]): void {
  cache.set(key, { ts: now(), data });
}

/**
 * Query the provider's own /models endpoint via the legacy helper in
 * lib/llm/providers.ts. Cached per (provider, baseURL). Authoritative for
 * what the user's key can actually call right now.
 */
export async function getProviderNativeCatalog(
  config: InferenceProviderConfig,
): Promise<CatalogEntry[]> {
  const key = cacheKey(["provider", config.providerId, config.baseURL]);
  const hit = readCache(key);
  if (hit) return hit;

  const modelIds = await listProviderModels({
    provider: config.providerId as ProviderType,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
  }).catch(() => [] as string[]);

  const entries: CatalogEntry[] = modelIds.map((id) => ({
    id,
    source: "provider-native",
    provider: config.providerId,
  }));
  writeCache(key, entries);
  return entries;
}

export interface HfCatalogOptions {
  /**
   * Minimum downloads to include a model — defence against typosquat repos
   * showing up in the UI. Default 1000.
   */
  minDownloads?: number;
  /** Per-tag result cap. Default 50. */
  limit?: number;
  /**
   * Filter by library tag. Pass "gguf" for Ollama/llama.cpp compatibility,
   * "safetensors" or "transformers" for vLLM, "diffusers" for image models,
   * etc. Omit to include all.
   */
  library?: string;
}

interface HfModelRecord {
  id: string;
  downloads?: number;
  tags?: string[];
  library_name?: string;
}

/**
 * Query HF Hub for trending models in a given modality. No API key needed;
 * the endpoint is public and anonymous-rate-limited (plenty for a catalog
 * refresh every hour).
 */
export async function getHuggingFaceCatalog(
  modality: Modality,
  opts: HfCatalogOptions = {},
): Promise<CatalogEntry[]> {
  const tags = HF_PIPELINE_TAGS[modality];
  if (!tags || tags.length === 0) return [];

  const limit = opts.limit ?? 50;
  const minDownloads = opts.minDownloads ?? 1000;

  const out: CatalogEntry[] = [];
  for (const tag of tags) {
    const key = cacheKey(["hf", tag, opts.library, String(limit), String(minDownloads)]);
    const hit = readCache(key);
    if (hit) {
      out.push(...hit);
      continue;
    }

    const url = new URL("https://huggingface.co/api/models");
    url.searchParams.set("pipeline_tag", tag);
    // HF Hub uses `trendingScore` for popularity ranking; `direction=-1`
    // sorts descending. "sort=trending" would be rejected as invalid.
    url.searchParams.set("sort", "trendingScore");
    url.searchParams.set("direction", "-1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("full", "true");
    if (opts.library) url.searchParams.set("library", opts.library);

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as HfModelRecord[] | undefined;
      if (!Array.isArray(raw)) continue;

      const filtered: CatalogEntry[] = raw
        .filter((m) => (m.downloads ?? 0) >= minDownloads)
        .map((m) => ({
          id: m.id,
          source: "hf-hub" as const,
          downloads: m.downloads,
          tags: m.tags,
          library: m.library_name,
        }));

      writeCache(key, filtered);
      out.push(...filtered);
    } catch {
      // Swallow per-tag failures — partial catalog is fine, the UI can
      // still render what did load.
    }
  }

  return out;
}

/**
 * Unified entry point — returns both closed-provider catalogs and HF-Hub
 * open-weight catalogs concatenated. Callers that only want one kind
 * should use the specific helper instead.
 */
export async function getCatalog(
  modality: Modality,
  options: {
    providerConfigs?: InferenceProviderConfig[];
    hf?: HfCatalogOptions;
  } = {},
): Promise<CatalogEntry[]> {
  const providerCalls = (options.providerConfigs ?? []).map((c) =>
    getProviderNativeCatalog(c),
  );
  const [native, hf] = await Promise.all([
    Promise.all(providerCalls).then((arrs) => arrs.flat()),
    getHuggingFaceCatalog(modality, options.hf),
  ]);
  return [...native, ...hf];
}

/** Test utility — flush the cache. Never called from production code. */
export function __clearCatalogCache(): void {
  cache.clear();
}
