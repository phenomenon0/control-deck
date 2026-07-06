/**
 * Served-endpoints store.
 *
 * A named endpoint gives one (provider, model) pair a stable, token-gated URL
 * off the deck — `/api/serve/<name>/v1/…` — that proxies to the provider's
 * OpenAI-compatible runtime with the model pinned. Callers hit the name; they
 * never pass a `model`.
 *
 * Persistence mirrors lib/inference/persistence.ts: a single JSON blob at
 * $CONTROL_DECK_USER_DATA/served-endpoints.json (packaged Electron) or
 * ./data/served-endpoints.json (dev). No DB, no migrations. Read/write
 * failures are non-fatal for reads (fall back to empty) and loud for writes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const FILENAME = "served-endpoints.json";

/** url-safe endpoint name: letters, digits, dash, underscore; 1–64 chars. */
export const SERVE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export interface ServedEndpoint {
  name: string;
  providerId: string;
  model: string;
  createdAt: string;
}

interface PersistedServed {
  version: 1;
  endpoints: ServedEndpoint[];
}

function resolvePath(): string {
  const base = process.env.CONTROL_DECK_USER_DATA ?? path.join(process.cwd(), "data");
  return path.join(base, FILENAME);
}

function emptyStore(): PersistedServed {
  return { version: 1, endpoints: [] };
}

function read(): PersistedServed {
  const p = resolvePath();
  try {
    if (!fs.existsSync(p)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<PersistedServed>;
    if (parsed?.version === 1 && Array.isArray(parsed.endpoints)) {
      return { version: 1, endpoints: parsed.endpoints.filter((e) => e && e.name && e.providerId && e.model) };
    }
    return emptyStore();
  } catch (err) {
    console.warn("[serve] failed to read served endpoints:", err);
    return emptyStore();
  }
}

function write(store: PersistedServed): void {
  const p = resolvePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[serve] failed to write served endpoints:", err);
    throw err;
  }
}

export function listServed(): ServedEndpoint[] {
  return read().endpoints;
}

export function getServed(name: string): ServedEndpoint | undefined {
  return read().endpoints.find((e) => e.name === name);
}

/** Append a served endpoint. Callers must validate name/providerId/model and
 *  uniqueness first (the management route does). */
export function createServed(name: string, providerId: string, model: string): ServedEndpoint {
  const store = read();
  const ep: ServedEndpoint = { name, providerId, model, createdAt: new Date().toISOString() };
  store.endpoints.push(ep);
  write(store);
  return ep;
}

/** Remove by name. Returns true if something was removed. */
export function removeServed(name: string): boolean {
  const store = read();
  const next = store.endpoints.filter((e) => e.name !== name);
  if (next.length === store.endpoints.length) return false;
  store.endpoints = next;
  write(store);
  return true;
}
