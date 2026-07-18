/**
 * Shared Ollama reachability probe.
 *
 * Used by /api/local-models/status (rich probe, returns the installed list)
 * and by resolvers that need a yes/no answer on whether to fall through to
 * a local-first default (embedding auto-bind, future modalities).
 *
 * The base URL comes from the unified settings chain
 * (`resolveProviderUrl("ollama")`: settings DB → env override →
 * localhost default) instead of a module-load env read, so Settings >
 * Hardware changes apply without a restart.
 */

import { resolveProviderUrl } from "@/lib/hardware/settings";

/** Ollama native API root (no /v1 suffix). */
export function ollamaBaseUrl(): string {
  return resolveProviderUrl("ollama");
}

export interface OllamaProbe {
  reachable: boolean;
  installed: string[];
}

export async function probeOllama(timeoutMs = 2000): Promise<OllamaProbe> {
  try {
    const res = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { reachable: false, installed: [] };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const installed = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => !!n);
    return { reachable: true, installed };
  } catch {
    return { reachable: false, installed: [] };
  }
}

export async function probeOllamaReachable(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isOllamaInstalled(tag: string, installed: string[]): boolean {
  if (installed.includes(tag)) return true;
  if (!tag.includes(":") && installed.includes(`${tag}:latest`)) return true;
  return false;
}
