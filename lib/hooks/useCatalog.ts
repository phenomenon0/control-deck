"use client";

/**
 * Typed wrapper around /api/catalog. Memoises by JSON param key so
 * multiple consumers with the same query share one fetch. A lightweight
 * 2-minute cache avoids re-hitting the route on tab flips.
 */

import { useEffect, useState } from "react";

export type CatalogProvider = "nvidia" | "openrouter" | "hf";

export interface CatalogModel {
  provider: CatalogProvider;
  id: string;
  publisher: string;
  display_name: string;
  modality: string[];
  context_window: number | null;
  max_output: number | null;
  pricing: { prompt_per_mtok: number; completion_per_mtok: number } | null;
  rate_limits: { rpm: number | null; rpd: number | null } | null;
  tags: string[];
  family?: string | null;
  base_model?: string | null;
  notes: { cutoff: string | null; curated: string | null };
  stats: {
    p50_ms: number | null;
    p95_ms: number | null;
    calls_last_30d: number;
    last_measured: string | null;
    last_error: string | null;
  };
}

export interface CatalogParams {
  provider?: CatalogProvider;
  modality?: string;
  publisher?: string;
  family?: string;
  tag?: string;
  q?: string;
  free?: boolean;
  limit?: number;
  enabled?: boolean;
}

interface CatalogResult {
  models: CatalogModel[];
  total: number;
  providers: CatalogProvider[];
  loading: boolean;
  error: string | null;
}

interface CachedEntry {
  at: number;
  data: Omit<CatalogResult, "loading" | "error">;
  inflight?: Promise<void>;
}

const CACHE_TTL_MS = 120_000;
const cache = new Map<string, CachedEntry>();
const DISABLED_RESULT: CatalogResult = {
  models: [],
  total: 0,
  providers: [],
  loading: false,
  error: null,
};

function buildQuery(params: CatalogParams): string {
  const p = new URLSearchParams();
  if (params.provider) p.set("provider", params.provider);
  if (params.modality) p.set("modality", params.modality);
  if (params.publisher) p.set("publisher", params.publisher);
  if (params.family) p.set("family", params.family);
  if (params.tag) p.set("tag", params.tag);
  if (params.q) p.set("q", params.q);
  if (params.free) p.set("free", "1");
  if (params.limit) p.set("limit", String(params.limit));
  return p.toString();
}

async function fetchCatalog(key: string) {
  const res = await fetch(`/api/catalog?${key}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const json = (await res.json()) as {
    providers: CatalogProvider[];
    total: number;
    models: CatalogModel[];
  };
  return json;
}

export function useCatalog(params: CatalogParams): CatalogResult {
  const enabled = params.enabled !== false;
  const key = buildQuery(params);

  const [state, setState] = useState<CatalogResult>(() => {
    if (!enabled) return DISABLED_RESULT;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { ...cached.data, loading: false, error: null };
    }
    return { models: [], total: 0, providers: [], loading: true, error: null };
  });

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }

    const cached = cache.get(key);
    const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
    if (fresh) {
      setState({ ...cached.data, loading: false, error: null });
      return () => {
        cancelled = true;
      };
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const data = await fetchCatalog(key);
        const entry: CachedEntry = {
          at: Date.now(),
          data: {
            models: data.models,
            total: data.total,
            providers: data.providers,
          },
        };
        cache.set(key, entry);
        if (!cancelled) {
          setState({ ...entry.data, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            models: [],
            total: 0,
            providers: [],
            loading: false,
            error: err instanceof Error ? err.message : "catalog fetch failed",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return enabled ? state : DISABLED_RESULT;
}
