/**
 * mem0 adapter — implements the `MemoryProvider` contract against
 * https://docs.mem0.ai. Designed to talk to either the managed cloud API
 * (https://api.mem0.ai) or a self-hosted OSS server (typically
 * http://localhost:8000 after `docker compose up`).
 *
 * Auth: `Authorization: Token <MEM0_API_KEY>`. The OSS server tolerates a
 * dummy token (it ignores auth unless you turn it on); the cloud API
 * requires a real one. We refuse to construct the adapter without a key —
 * mirroring writes silently into a 401 black hole is the worst failure mode.
 *
 * Endpoints used (REST shape, JSON):
 *   POST /v1/memories          → add
 *   POST /v1/memories/search   → search
 *   PUT  /v1/memories/<id>     → update
 *   DELETE /v1/memories/<id>   → delete
 *
 * Namespacing: every call passes `user_id` (snake_case per mem0's contract)
 * plus `agent_id: "control-deck"` so a single mem0 account can host multiple
 * apps without bleeding context across them.
 *
 * Errors propagate to the caller. The mirror call site swallows them
 * fire-and-forget; explicit callers (a future `memory_search` tool) decide
 * how to surface them.
 */

import type {
  MemoryHit,
  MemoryProvider,
  MemoryProviderAddArgs,
  MemoryProviderSearchArgs,
  MemoryProviderUpdateArgs,
} from "../provider";

const DEFAULT_BASE_URL = "https://api.mem0.ai";
const AGENT_ID = "control-deck";

export interface Mem0FactoryOpts {
  baseUrl?: string;
  apiKey?: string;
  /** Override fetch for tests. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

interface RawMemoryItem {
  id?: string;
  memory?: string;
  text?: string;
  content?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function asStringMap(input: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!input) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickContent(raw: RawMemoryItem): string {
  return raw.memory ?? raw.text ?? raw.content ?? "";
}

function normalizeHit(raw: RawMemoryItem): MemoryHit {
  return {
    id: raw.id ?? "",
    content: pickContent(raw),
    score: typeof raw.score === "number" ? raw.score : undefined,
    metadata: asStringMap(raw.metadata),
  };
}

/**
 * Build a mem0 provider. Returns null when no API key is available so the
 * registry can fall back to local-only mode without surfacing an error.
 */
export function createMem0Provider(opts: Mem0FactoryOpts = {}): MemoryProvider | null {
  const apiKey = (opts.apiKey ?? process.env.MEM0_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const fetchFn = opts.fetchFn ?? fetch;

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText);
      throw new Error(`mem0 ${method} ${path} failed (${res.status}): ${errBody}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    id: "mem0",

    async add({ content, userId, metadata }: MemoryProviderAddArgs): Promise<{ id: string }> {
      // mem0's `messages` shape is a thin chat-style wrapper. A single
      // user-role message becomes one curated memory after extraction.
      const payload: Record<string, unknown> = {
        messages: [{ role: "user", content }],
        user_id: userId,
        agent_id: AGENT_ID,
      };
      if (metadata && Object.keys(metadata).length > 0) payload.metadata = metadata;
      const raw = (await request("POST", "/v1/memories", payload)) as
        | { id?: string; results?: Array<{ id?: string }> }
        | null;
      const id = raw?.id ?? raw?.results?.[0]?.id ?? "";
      return { id };
    },

    async search({ query, userId, k, metadata }: MemoryProviderSearchArgs): Promise<MemoryHit[]> {
      const payload: Record<string, unknown> = {
        query,
        user_id: userId,
        agent_id: AGENT_ID,
      };
      if (typeof k === "number") payload.limit = k;
      if (metadata && Object.keys(metadata).length > 0) payload.filters = metadata;
      const raw = (await request("POST", "/v1/memories/search", payload)) as
        | RawMemoryItem[]
        | { results?: RawMemoryItem[] }
        | null;
      const items: RawMemoryItem[] = Array.isArray(raw) ? raw : raw?.results ?? [];
      return items.map(normalizeHit);
    },

    async update({ id, content, metadata }: MemoryProviderUpdateArgs): Promise<void> {
      if (!id) throw new Error("mem0 update requires id");
      const payload: Record<string, unknown> = {};
      if (content !== undefined) payload.text = content;
      if (metadata && Object.keys(metadata).length > 0) payload.metadata = metadata;
      await request("PUT", `/v1/memories/${encodeURIComponent(id)}`, payload);
    },

    async delete({ id }: { id: string }): Promise<void> {
      if (!id) throw new Error("mem0 delete requires id");
      await request("DELETE", `/v1/memories/${encodeURIComponent(id)}`);
    },
  };
}
