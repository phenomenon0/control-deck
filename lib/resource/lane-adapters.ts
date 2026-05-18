/**
 * Lane adapters — how the arbiter tells a specific backend to unload.
 *
 * Each lane has one or more eviction strategies. The arbiter picks the
 * first that returns OK and verifies the freed VRAM in the ledger.
 *
 * Lookup is by `LaneId` not provider — multiple providers may serve the
 * same lane (e.g. `chat` is llama-swap today, llama.cpp direct tomorrow).
 *
 * Server-side only.
 */

import { resolveProviderUrl } from "@/lib/hardware/settings";
import type { LaneId } from "./types";

const LLAMA_SWAP_URL = (): string =>
  process.env.LLAMA_SWAP_BASE_URL ?? resolveProviderUrl("llamacpp");

const COMFYUI_URL = (): string =>
  process.env.COMFYUI_BASE_URL ?? resolveProviderUrl("comfyui");

const OLLAMA_URL = (): string =>
  process.env.OLLAMA_BASE_URL ?? resolveProviderUrl("ollama");

const VOICE_CORE_URL = (): string =>
  process.env.VOICE_CORE_URL ?? "http://127.0.0.1:4245";

const QWEN_OMNI_URL = (): string =>
  process.env.QWEN_OMNI_URL ?? "http://127.0.0.1:4247";

export interface UnloadResult {
  ok: boolean;
  via: string;
  error?: string;
}

async function safeFetch(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 5000);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * llama-swap: POST /api/models/unload/<id> drops the currently loaded model
 * for that group. If `modelId` is omitted, hits /api/models/unload which
 * unloads all running models. Older builds exposed `/unload` or
 * `/admin/unload` instead — keep those as fallbacks.
 *
 * Contract: `modelId` must be a llama-swap *group id* (e.g. `qwen3.5-9b`,
 * `qwen3.5-35b`), not a GGUF filename. Group ids come from the live
 * `/v1/models` probe in `lib/llamacpp/llama-swap-groups.ts` and are stored
 * verbatim on the arbiter reservation by `registerChatLane()`.
 */
async function unloadLlamaSwap(modelId?: string): Promise<UnloadResult> {
  const base = LLAMA_SWAP_URL().replace(/\/$/, "").replace(/\/v1$/, "");
  const encoded = modelId ? encodeURIComponent(modelId) : "";
  const paths = modelId
    ? [
        `/api/models/unload/${encoded}`,
        "/api/models/unload",
        `/unload?model=${encoded}`,
        `/admin/unload?model=${encoded}`,
      ]
    : ["/api/models/unload", "/unload", "/admin/unload"];
  const failures: string[] = [];
  for (const path of paths) {
    try {
      const res = await safeFetch(`${base}${path}`, { method: "POST", timeoutMs: 8000 });
      if (res.ok) return { ok: true, via: `llama-swap${path}` };
      failures.push(`${path}: ${res.status}`);
    } catch (e) {
      failures.push(`${path}: ${e instanceof Error ? e.message : "fetch failed"}`);
    }
  }
  return { ok: false, via: "llama-swap", error: failures.join("; ") || "no unload endpoint answered 2xx" };
}

/**
 * ComfyUI: POST /free with unload_models=true clears model cache, and
 * with free_memory=true also runs gc + cuda.empty_cache.
 */
async function unloadComfyUI(): Promise<UnloadResult> {
  const base = COMFYUI_URL().replace(/\/$/, "");
  try {
    const res = await safeFetch(`${base}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      timeoutMs: 8000,
    });
    if (res.ok) return { ok: true, via: "comfyui /free" };
    return { ok: false, via: "comfyui /free", error: `${res.status}` };
  } catch (e) {
    return { ok: false, via: "comfyui /free", error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/**
 * Ollama: there is no first-class unload-all. The official trick is to
 * POST /api/generate with keep_alive: 0 on whatever model is loaded.
 * We probe /api/ps for the current model and then issue the keep_alive:0
 * generate. Empty body is fine.
 */
async function unloadOllama(): Promise<UnloadResult> {
  const base = OLLAMA_URL().replace(/\/$/, "").replace(/\/v1$/, "");
  try {
    const ps = await safeFetch(`${base}/api/ps`, { timeoutMs: 2000 });
    if (!ps.ok) return { ok: false, via: "ollama /api/ps", error: `${ps.status}` };
    const data = (await ps.json()) as { models?: Array<{ name?: string }> };
    const loaded = (data.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
    if (loaded.length === 0) return { ok: true, via: "ollama (nothing loaded)" };
    let allOk = true;
    for (const name of loaded) {
      try {
        const res = await safeFetch(`${base}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: name, keep_alive: 0, prompt: "" }),
          timeoutMs: 8000,
        });
        if (!res.ok) allOk = false;
      } catch {
        allOk = false;
      }
    }
    return { ok: allOk, via: "ollama keep_alive:0" };
  } catch (e) {
    return { ok: false, via: "ollama", error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/**
 * voice-core: POST /engines/<id>/unload. The endpoint is added in this
 * same change. We probe /models for currently-loaded engines and unload
 * each one in the lane kind.
 */
async function unloadVoiceCore(kind: "stt" | "tts"): Promise<UnloadResult> {
  const base = VOICE_CORE_URL().replace(/\/$/, "");
  try {
    const res = await safeFetch(`${base}/models`, { timeoutMs: 2000 });
    if (!res.ok) return { ok: false, via: "voice-core /models", error: `${res.status}` };
    const data = (await res.json()) as Record<string, { kind: string; loaded: boolean }>;
    const toUnload = Object.entries(data)
      .filter(([, v]) => v.kind === kind && v.loaded)
      .map(([id]) => id);
    if (toUnload.length === 0) return { ok: true, via: `voice-core (nothing in ${kind})` };
    let allOk = true;
    for (const id of toUnload) {
      try {
        const u = await safeFetch(`${base}/engines/${encodeURIComponent(id)}/unload`, {
          method: "POST",
          timeoutMs: 6000,
        });
        if (!u.ok) allOk = false;
      } catch {
        allOk = false;
      }
    }
    return { ok: allOk, via: `voice-core ${kind} unload` };
  } catch (e) {
    return { ok: false, via: `voice-core ${kind}`, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** qwen-omni-sidecar: DELETE /session is best-effort, optional. */
async function unloadOmni(): Promise<UnloadResult> {
  const base = QWEN_OMNI_URL().replace(/\/$/, "");
  try {
    const res = await safeFetch(`${base}/session`, { method: "DELETE", timeoutMs: 6000 });
    if (res.ok) return { ok: true, via: "qwen-omni" };
    return { ok: false, via: "qwen-omni", error: `${res.status}` };
  } catch (e) {
    return { ok: false, via: "qwen-omni", error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Per-lane unload dispatch. Returns the first strategy that succeeds. */
export async function unloadLane(lane: LaneId, modelId?: string): Promise<UnloadResult> {
  switch (lane) {
    case "chat":
    case "vision":
      // Vision often shares the llama-swap lane (qwen3.5-9b + mmproj).
      // Try llama-swap first; fall back to Ollama (vision often runs there too).
      {
        const r = await unloadLlamaSwap(modelId);
        if (r.ok) return r;
        return await unloadOllama();
      }
    case "image":
    case "audio":
    case "3d":
    case "video":
      return await unloadComfyUI();
    case "stt":
      return await unloadVoiceCore("stt");
    case "tts":
      return await unloadVoiceCore("tts");
    case "omni":
      return await unloadOmni();
    default:
      return { ok: false, via: "none", error: `no unloader for lane ${lane}` };
  }
}

export const __test = {
  unloadLlamaSwap,
  unloadComfyUI,
  unloadOllama,
  unloadVoiceCore,
  unloadOmni,
};
