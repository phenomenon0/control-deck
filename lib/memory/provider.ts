/**
 * External memory provider plugin interface.
 *
 * The local file-based store (MEMORY.md / USER.md) is the source of truth
 * and what the system prompt sees. A provider is **additive**: a writable
 * side store the deck mirrors curated entries into and (later) searches
 * semantically across longer history than the per-target char budgets allow.
 *
 * Why a separate side store?
 *   - The local files have to stay byte-stable for KV cache hits, which
 *     caps how much memory can live in the prompt prefix.
 *   - Providers expose semantic search across thousands of past entries
 *     without bloating that prefix.
 *
 * Contract for an adapter:
 *   - Construct from settings + env. If required config is missing (e.g.
 *     no API key), return null from the factory — never throw.
 *   - Every method may throw on network / 4xx / 5xx. Callers wrap and
 *     swallow (mirror writes are fire-and-forget).
 *   - Use the deck's `userId` to namespace. Other keys (`target`,
 *     `messageId`, etc.) go in `metadata`.
 */

import { resolveSection } from "@/lib/settings/resolve";
import type { MemorySettings } from "@/lib/settings/schema";
import { createMem0Provider } from "./providers/mem0";

export interface MemoryHit {
  id: string;
  content: string;
  score?: number;
  metadata?: Record<string, string>;
}

export interface MemoryProviderAddArgs {
  content: string;
  userId: string;
  metadata?: Record<string, string>;
}

export interface MemoryProviderSearchArgs {
  query: string;
  userId: string;
  k?: number;
  metadata?: Record<string, string>;
}

export interface MemoryProviderUpdateArgs {
  id: string;
  content?: string;
  metadata?: Record<string, string>;
}

export interface MemoryProvider {
  /** Stable identifier — matches the providerId setting. */
  id: string;
  add(args: MemoryProviderAddArgs): Promise<{ id: string }>;
  search(args: MemoryProviderSearchArgs): Promise<MemoryHit[]>;
  update(args: MemoryProviderUpdateArgs): Promise<void>;
  delete(args: { id: string }): Promise<void>;
}

/** Fallback userId when the deck has no `memory.userId` configured. */
export const DEFAULT_USER_ID = "control-deck-local";

export function resolveUserId(settings?: MemorySettings | null): string {
  const explicit = settings?.userId?.trim();
  return explicit && explicit.length > 0 ? explicit : DEFAULT_USER_ID;
}

interface ResolveProviderOpts {
  settings?: MemorySettings;
}

/**
 * Build the active provider from settings. Returns null when:
 *   - providerId is empty (local-only mode)
 *   - providerId is unknown
 *   - the adapter factory returns null (missing required env, e.g. API key)
 *
 * The returned value is recomputed on every call — adapters are cheap to
 * construct and this avoids stale state when settings or env change.
 */
export function getActiveProvider(opts: ResolveProviderOpts = {}): MemoryProvider | null {
  let settings: MemorySettings;
  try {
    settings = opts.settings ?? resolveSection("memory");
  } catch {
    return null;
  }
  const id = settings.providerId.trim().toLowerCase();
  if (!id) return null;

  switch (id) {
    case "mem0":
      return createMem0Provider({ baseUrl: settings.mem0.baseUrl });
    default:
      return null;
  }
}
