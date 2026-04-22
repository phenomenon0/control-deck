/**
 * ComfyUI adapter. Image-gen workflow server, default localhost:8188.
 * ComfyUI's model list lives behind `/object_info` (catalogue of node
 * types + their option lists including checkpoint names). We treat the
 * `CheckpointLoaderSimple.ckpt_name[0]` list as "installed models".
 */

import type {
  InstalledModelEntry,
  LoadedModelEntry,
  ProviderAdapter,
  ProviderHealth,
} from "./types";
import { resolveProviderUrl } from "../settings";

function baseUrl(): string {
  return resolveProviderUrl("comfyui");
}

interface ObjectInfo {
  [nodeName: string]: {
    input?: {
      required?: Record<string, [unknown, unknown?]>;
    };
  };
}

export const comfyuiAdapter: ProviderAdapter = {
  id: "comfyui",
  label: "ComfyUI",
  origin: "comfyanonymous",
  resolveUrl: baseUrl,
  capabilities: {
    // ComfyUI loads checkpoints lazily when a workflow runs. No explicit
    // load/unload affordance from the web UI.
    load: false,
    unload: false,
    loadReason: "ComfyUI loads checkpoints lazily per workflow execution",
    unloadReason: "ComfyUI has no explicit unload — restart clears all",
  },

  async health(): Promise<ProviderHealth> {
    const url = baseUrl();
    const start = Date.now();
    try {
      const res = await fetch(`${url}/system_stats`, {
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      });
      if (res.ok) return { online: true, url, latencyMs: Date.now() - start };
      return { online: false, url };
    } catch {
      return { online: false, url };
    }
  },

  async listInstalled(): Promise<InstalledModelEntry[]> {
    try {
      const res = await fetch(`${baseUrl()}/object_info`, {
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data = (await res.json()) as ObjectInfo;
      const ck = data.CheckpointLoaderSimple?.input?.required?.ckpt_name;
      const names = Array.isArray(ck?.[0]) ? (ck[0] as string[]) : [];
      return names.map((n) => ({
        name: n,
        displayName: n,
        sizeBytes: 0,
      }));
    } catch {
      return [];
    }
  },

  async listLoaded(): Promise<LoadedModelEntry[]> {
    // ComfyUI has no stable "loaded" concept exposed; its current queue
    // is closer to "working set". Return empty for now.
    return [];
  },
};
