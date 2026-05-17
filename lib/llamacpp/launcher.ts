/**
 * llama-swap probe + chat-lane registration.
 *
 * Historically this module spawned its own `llama-server` on :8080. In this
 * deployment llama-swap (mostlygeek/llama-swap) owns that port as a systemd
 * user service — the deck must *never* fight it for the socket. We keep the
 * same exported surface (`LLAMACPP_URL`, `probeLlamacpp`, `launchLlamacpp`)
 * so existing routes stay working, but `launchLlamacpp()` is now a thin
 * probe that surfaces "already-running" or "llama-swap not reachable".
 *
 * Resource arbitration for the chat lane is done by `registerChatLane()`,
 * which probes the active group, finds a swap target via
 * `lib/llamacpp/llama-swap-groups.ts`, and registers with the arbiter.
 *
 * Server-side only.
 */

import { resolveProviderUrl } from "@/lib/hardware/settings";
import { acquire } from "@/lib/resource/arbiter";

import { discoverGroups, pickSwapGroup } from "./llama-swap-groups";

export const LLAMACPP_URL = resolveProviderUrl("llamacpp");

export interface LlamacppHealth {
  online: boolean;
  url: string;
  latencyMs?: number;
  modelId?: string;
  models?: string[];
  error?: string;
}

export async function probeLlamacpp(timeoutMs = 1200): Promise<LlamacppHealth> {
  const url = LLAMACPP_URL;
  const start = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return { online: false, url, error: `${res.status}` };
    const data = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: string }> }
      | null;
    const models = (data?.data ?? [])
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === "string");
    return {
      online: true,
      url,
      latencyMs: Date.now() - start,
      modelId: models[0],
      models,
    };
  } catch (e) {
    return { online: false, url, error: e instanceof Error ? e.message : "unreachable" };
  }
}

export interface LlamacppLaunchResult {
  status: "already-running" | "launched" | "failed";
  pid?: number;
  url: string;
  modelPath?: string;
  modelId?: string;
  error?: string;
  logPath?: string;
}

export async function launchLlamacpp(): Promise<LlamacppLaunchResult> {
  const probe = await probeLlamacpp();
  if (probe.online) {
    return { status: "already-running", url: LLAMACPP_URL, modelId: probe.modelId };
  }
  return {
    status: "failed",
    url: LLAMACPP_URL,
    error:
      "llama-swap not reachable at " +
      LLAMACPP_URL +
      " — check `systemctl --user status llama-swap` (set LLAMA_SWAP_BASE_URL to override).",
  };
}

export interface RegisterChatLaneResult {
  status: "registered" | "skipped";
  ticket?: string;
  modelId?: string;
  swapTo?: { modelId: string; estimateMb: number };
  reason?: string;
}

/**
 * Register the chat lane with the arbiter using whatever group llama-swap
 * currently exposes. Best-effort — if llama-swap isn't reachable we return
 * `skipped` and the caller carries on (the launch route stays informative).
 */
export async function registerChatLane(): Promise<RegisterChatLaneResult> {
  const probe = await probeLlamacpp();
  if (!probe.online || !probe.modelId) {
    return { status: "skipped", reason: probe.error ?? "no active group" };
  }
  const groups = await discoverGroups();
  const active = groups.find((g) => g.id === probe.modelId) ?? {
    id: probe.modelId,
    estimateMb: 12_000,
  };
  const swapTo = (await pickSwapGroup(active.id)) ?? undefined;
  const acq = await acquire({
    lane: "chat",
    estimateMb: active.estimateMb,
    reason: `llama-swap: ${active.id}`,
    modelId: active.id,
    priority: "interactive",
    evicts: "none",
    restoreOnIdle: true,
    swapTo,
  });
  if (acq.status !== "granted") {
    return { status: "skipped", reason: acq.reason ?? acq.status };
  }
  return {
    status: "registered",
    ticket: acq.ticket,
    modelId: active.id,
    swapTo,
  };
}
