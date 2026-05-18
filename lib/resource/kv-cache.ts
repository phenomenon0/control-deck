import { resolveProviderUrl } from "@/lib/hardware/settings";

import type { KvCacheSlotTelemetry, KvCacheTelemetry } from "./types";

interface LlamaSwapRunningResponse {
  running?: Array<{
    model?: string;
    proxy?: string;
    state?: string;
  }>;
}

interface LlamaCppProps {
  default_generation_settings?: {
    n_ctx?: number;
  };
  total_slots?: number;
  endpoint_metrics?: boolean;
}

interface LlamaCppSlot {
  id?: number;
  n_ctx?: number;
  is_processing?: boolean;
  next_token?: Array<{
    n_decoded?: number;
    n_remain?: number;
  }>;
}

const FETCH_TIMEOUT_MS = 1200;

function llamaSwapBaseUrl(): string {
  return (process.env.LLAMA_SWAP_BASE_URL ?? resolveProviderUrl("llamacpp")).replace(/\/$/, "").replace(/\/v1$/, "");
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

async function metricsEnabled(proxyUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${proxyUrl}/metrics`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function collectKvCaches(): Promise<KvCacheTelemetry[]> {
  const base = llamaSwapBaseUrl();
  const running = await fetchJson<LlamaSwapRunningResponse>(`${base}/running`);
  const rows = running?.running ?? [];
  if (rows.length === 0) return [];

  const telemetry = await Promise.all(
    rows
      .filter((row) => row.model && row.proxy)
      .map(async (row) => collectLlamaCppKvCache(row.model!, row.proxy!, row.state)),
  );
  return telemetry.filter((row): row is KvCacheTelemetry => row !== null);
}

async function collectLlamaCppKvCache(
  modelId: string,
  proxyUrl: string,
  state?: string,
): Promise<KvCacheTelemetry | null> {
  const proxy = proxyUrl.replace(/\/$/, "");
  const [props, slots, hasMetrics] = await Promise.all([
    fetchJson<LlamaCppProps>(`${proxy}/props`),
    fetchJson<LlamaCppSlot[]>(`${proxy}/slots`),
    metricsEnabled(proxy),
  ]);
  if (!props && !slots) {
    return {
      provider: "llamacpp",
      modelId,
      state,
      proxyUrl: proxy,
      source: "llama.cpp",
      metricsEnabled: hasMetrics,
      slots: [],
      slotCount: 0,
      activeSlots: 0,
      slotContextTokens: 0,
      logicalContextTokens: 0,
      decodedTokens: 0,
      error: "slots/props unavailable",
    };
  }
  return summariseLlamaCppSlots(modelId, proxy, state, props, slots ?? [], hasMetrics);
}

export function summariseLlamaCppSlots(
  modelId: string,
  proxyUrl: string,
  state: string | undefined,
  props: LlamaCppProps | null,
  slotsRaw: LlamaCppSlot[],
  hasMetrics: boolean,
): KvCacheTelemetry {
  const defaultCtx = props?.default_generation_settings?.n_ctx ?? 0;
  const slots: KvCacheSlotTelemetry[] = slotsRaw.map((slot) => {
    const decodedTokens = slot.next_token?.reduce((sum, next) => sum + normaliseNumber(next.n_decoded), 0) ?? 0;
    const remainingTokens = slot.next_token?.reduce((sum, next) => sum + normaliseNumber(next.n_remain), 0) ?? 0;
    return {
      id: normaliseNumber(slot.id),
      nCtx: normaliseNumber(slot.n_ctx) || defaultCtx,
      isProcessing: Boolean(slot.is_processing),
      decodedTokens,
      remainingTokens,
    };
  });
  const slotCount = slots.length || props?.total_slots || 0;
  const slotContextTokens = slots[0]?.nCtx || defaultCtx;
  const logicalContextTokens =
    slots.length > 0
      ? slots.reduce((sum, slot) => sum + slot.nCtx, 0)
      : slotCount * slotContextTokens;
  return {
    provider: "llamacpp",
    modelId,
    state,
    proxyUrl,
    source: "llama.cpp",
    metricsEnabled: hasMetrics || Boolean(props?.endpoint_metrics),
    slots,
    slotCount,
    activeSlots: slots.filter((slot) => slot.isProcessing).length,
    slotContextTokens,
    logicalContextTokens,
    decodedTokens: slots.reduce((sum, slot) => sum + (slot.decodedTokens ?? 0), 0),
  };
}

export function attachProcessMemory(
  kvCaches: KvCacheTelemetry[],
  processUsedMemoryMb: number,
): KvCacheTelemetry[] {
  if (kvCaches.length !== 1 || processUsedMemoryMb <= 0) return kvCaches;
  return [{ ...kvCaches[0], processUsedMemoryMb }];
}

function normaliseNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
