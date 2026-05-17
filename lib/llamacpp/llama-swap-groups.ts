/**
 * llama-swap group discovery + VRAM hints.
 *
 * llama-swap routes between named "groups" (one llama-server invocation each)
 * defined in ~/.config/llama-swap/config.yaml. The deck only knows the *runtime*
 * group ids by probing `GET /v1/models` — that's what `discoverGroups()` does.
 *
 * VRAM estimates are name-pattern heuristics so the arbiter can make sensible
 * downgrade decisions without baking model sizes into source. Operators with
 * unusual group names can override per-group via `LLAMA_SWAP_VRAM_<GROUP>` (the
 * group id is uppercased and non-alphanumerics are stripped).
 *
 * Server-side only.
 */

import { resolveProviderUrl } from "@/lib/hardware/settings";

export interface LlamaSwapGroup {
  id: string;
  estimateMb: number;
}

let cached: LlamaSwapGroup[] | null = null;

function envKeyForGroup(id: string): string {
  return `LLAMA_SWAP_VRAM_${id.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

function estimateForGroup(id: string): number {
  const fromEnv = process.env[envKeyForGroup(id)];
  if (fromEnv) {
    const n = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (/9b/i.test(id)) return 6_000;
  if (/12b/i.test(id)) return 9_000;
  if (/35b|3\.6|3-6/i.test(id)) return 18_000;
  if (/70b/i.test(id)) return 40_000;
  return 12_000;
}

export async function discoverGroups(timeoutMs = 1500): Promise<LlamaSwapGroup[]> {
  if (cached) return cached;
  const base = resolveProviderUrl("llamacpp").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: string }> }
      | null;
    const ids = (data?.data ?? [])
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const groups = ids.map((id) => ({ id, estimateMb: estimateForGroup(id) }));
    cached = groups;
    return groups;
  } catch {
    return [];
  }
}

/**
 * Pick the largest group that's still strictly smaller than `currentGroupId`,
 * so the chat lane keeps as much capability as VRAM allows when preempted.
 * Returns null when no smaller group exists (already at the floor).
 *
 * Env override: `LLAMA_SWAP_SWAP_GROUP=qwen3.5-9b` short-circuits the lookup.
 */
export async function pickSwapGroup(
  currentGroupId: string,
): Promise<{ modelId: string; estimateMb: number } | null> {
  const forced = process.env.LLAMA_SWAP_SWAP_GROUP?.trim();
  if (forced && forced !== currentGroupId) {
    return { modelId: forced, estimateMb: estimateForGroup(forced) };
  }

  const groups = await discoverGroups();
  const current = groups.find((g) => g.id === currentGroupId);
  const currentEstimate = current?.estimateMb ?? estimateForGroup(currentGroupId);

  let best: LlamaSwapGroup | null = null;
  for (const g of groups) {
    if (g.id === currentGroupId) continue;
    if (g.estimateMb >= currentEstimate) continue;
    if (!best || g.estimateMb > best.estimateMb) best = g;
  }
  return best ? { modelId: best.id, estimateMb: best.estimateMb } : null;
}

export const __test = {
  reset(): void {
    cached = null;
  },
  setCache(groups: LlamaSwapGroup[] | null): void {
    cached = groups;
  },
  estimateForGroup,
};
