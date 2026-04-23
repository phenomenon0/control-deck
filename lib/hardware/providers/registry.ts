/**
 * Provider registry. Aggregates every adapter into a single snapshot.
 *
 * Server-only. Individual adapters may shell out or hit localhost.
 */

import type { ProviderAdapter, ProviderId, ProviderSnapshot } from "./types";
import { ollamaAdapter } from "./ollama";
import { vllmAdapter } from "./vllm";
import { llamacppAdapter } from "./llamacpp";
import { lmstudioAdapter } from "./lmstudio";
import { comfyuiAdapter } from "./comfyui";
import { isProviderEnabled } from "../settings";
import type { SettingsProviderId } from "@/lib/settings/schema";

export const BUILTIN_ADAPTERS: Record<ProviderId, ProviderAdapter | null> = {
  ollama: ollamaAdapter,
  vllm: vllmAdapter,
  llamacpp: llamacppAdapter,
  "lm-studio": lmstudioAdapter,
  comfyui: comfyuiAdapter,
  // Reserved slots for follow-up adapters (all speak OpenAI-compat).
  llamafile: null,
  localai: null,
  jan: null,
  oobabooga: null,
  tabbyapi: null,
  mlx: null,
  koboldcpp: null,
  custom: null,
};

const SETTINGS_GATED: ReadonlySet<string> = new Set([
  "ollama",
  "vllm",
  "llamacpp",
  "lm-studio",
  "comfyui",
]);

function activeAdapters(): ProviderAdapter[] {
  return Object.values(BUILTIN_ADAPTERS)
    .filter((a): a is ProviderAdapter => a !== null)
    .filter((a) => {
      if (SETTINGS_GATED.has(a.id)) {
        return isProviderEnabled(a.id as SettingsProviderId);
      }
      return true;
    });
}

async function snapshotOne(adapter: ProviderAdapter): Promise<ProviderSnapshot> {
  // Always probe health first — cheap and serves as a liveness gate.
  const health = await adapter.health();
  if (!health.online) {
    return {
      id: adapter.id,
      label: adapter.label,
      origin: adapter.origin,
      url: adapter.resolveUrl(),
      capabilities: adapter.capabilities,
      health,
      installed: [],
      loaded: [],
    };
  }
  // Parallel fan-out for list calls.
  const [installed, loaded] = await Promise.all([
    adapter.listInstalled().catch(() => []),
    adapter.listLoaded().catch(() => []),
  ]);
  return {
    id: adapter.id,
    label: adapter.label,
    origin: adapter.origin,
    url: adapter.resolveUrl(),
    capabilities: adapter.capabilities,
    health,
    installed,
    loaded,
  };
}

/**
 * Snapshot every registered adapter in parallel. Adapters that error or
 * time out contribute an empty snapshot (health.online=false).
 */
export async function snapshotAll(): Promise<ProviderSnapshot[]> {
  const adapters = activeAdapters();
  return Promise.all(adapters.map(snapshotOne));
}

export function getAdapter(id: ProviderId): ProviderAdapter | null {
  return BUILTIN_ADAPTERS[id];
}
