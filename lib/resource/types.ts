/**
 * Resource arbiter — shared types.
 *
 * Isomorphic. Safe to import from client components (no Node-only deps).
 * Server-only logic lives in arbiter.ts / ledger.ts / lane-adapters.ts.
 */

import type { GpuProcess } from "@/lib/hardware/gpu-types";

/**
 * Named GPU consumer. Every load path through the deck declares which
 * lane it is acquiring. Lane id is the unit of eviction.
 */
export type LaneId =
  | "chat"     // LLM (llama-swap, llama.cpp direct)
  | "vision"   // image understanding (Ollama vision, local VLM)
  | "tts"      // voice-core synth
  | "stt"      // voice-core transcribe
  | "image"    // ComfyUI / SDXL Turbo / cloud
  | "audio"    // Stable Audio
  | "3d"       // Hunyuan 3D
  | "video"    // future Wan/SVD
  | "omni";    // qwen-omni-sidecar speech-to-speech

export const LANE_IDS: readonly LaneId[] = [
  "chat",
  "vision",
  "tts",
  "stt",
  "image",
  "audio",
  "3d",
  "video",
  "omni",
] as const;

/** Sticky lanes get restore-on-idle by default. */
export const STICKY_LANES: ReadonlySet<LaneId> = new Set<LaneId>([
  "chat",
  "tts",
  "stt",
]);

/**
 * Eviction permission carried by an acquire request.
 *   none — fail-fast if VRAM is short.
 *   soft — wait up to ttlMs for someone to release voluntarily.
 *   hard — force-unload evictable lanes immediately.
 */
export type EvictMode = "none" | "soft" | "hard";

export type AcquirePriority = "background" | "normal" | "interactive";

export interface AcquireRequest {
  lane: LaneId;
  /** Estimated VRAM the load will need, MB. Use lib/hardware/vram.ts:estimateVramMb. */
  estimateMb: number;
  /** Why the deck wants this. Shown verbatim in the ResourcePane. */
  reason: string;
  priority?: AcquirePriority;
  evicts?: EvictMode;
  /** Auto-release after this many ms with no `touch()`. 0 = sticky until released. */
  ttlMs?: number;
  /** If evicted by a heavier lane, queue a re-acquire when room opens. */
  restoreOnIdle?: boolean;
  /**
   * Optional model identifier (e.g. `qwen3.5-35b`). Lane adapters pass it
   * to the underlying swap protocol. Only meaningful for swap-capable
   * providers like llama-swap.
   */
  modelId?: string;
  /**
   * Smaller-while-busy hint. When this reservation would be evicted, the
   * arbiter downgrades to the swap target instead of fully unloading: it
   * unloads the current model, inserts a smaller reservation for the
   * fallback, and queues the original for restore-on-idle. Only meaningful
   * on swap-capable lanes (today: chat via llama-swap).
   */
  swapTo?: {
    modelId: string;
    estimateMb: number;
  };
}

export type AcquireStatus = "granted" | "queued" | "denied" | "evicted-after-grant";

export interface AcquireResult {
  status: AcquireStatus;
  ticket?: string;
  /** When `queued`, the lane id we are waiting on (best-effort). */
  waitForLane?: LaneId;
  /** Estimated free VRAM after this load. Negative if the request was denied. */
  freeAfterMb: number;
  /** Reserve applied by this admission. */
  reserveMb: number;
  /** Human reason for the verdict. */
  reason: string;
}

export interface Reservation {
  ticket: string;
  lane: LaneId;
  estimateMb: number;
  reason: string;
  priority: AcquirePriority;
  evicts: EvictMode;
  restoreOnIdle: boolean;
  modelId?: string;
  swapTo?: {
    modelId: string;
    estimateMb: number;
  };
  acquiredAt: number;
  lastTouchAt: number;
  ttlMs: number;
}

export interface KvCacheSlotTelemetry {
  id: number;
  nCtx: number;
  isProcessing: boolean;
  decodedTokens?: number;
  remainingTokens?: number;
}

export interface KvCacheTelemetry {
  provider: "llamacpp";
  modelId: string;
  state?: string;
  proxyUrl: string;
  source: "llama.cpp";
  metricsEnabled: boolean;
  slots: KvCacheSlotTelemetry[];
  slotCount: number;
  activeSlots: number;
  slotContextTokens: number;
  logicalContextTokens: number;
  decodedTokens: number;
  processUsedMemoryMb?: number;
  error?: string;
}

export interface LedgerSnapshot {
  /** When the snapshot was taken (epoch ms). */
  at: number;
  /** Whether this snapshot reflects real VRAM (NVIDIA) or RSS proxy (Mac). */
  source: "nvidia-smi" | "ps-rss" | "unknown";
  totalMb: number;
  /** Used = totalMb - freeMb (from nvidia-smi --query-gpu=memory.used). */
  usedMb: number;
  freeMb: number;
  reserveMb: number;
  /** Live GPU processes from nvidia-smi / ps. */
  processes: GpuProcess[];
  /** Provider-level KV/context telemetry when exposed by the backend. */
  kvCaches?: KvCacheTelemetry[];
  /** Current reservations held by the arbiter. */
  reservations: Reservation[];
}

/** Events emitted on the arbiter event bus. Consumed by SSE + ResourcePane. */
export type ResourceEvent =
  | { kind: "acquire-granted"; at: number; ticket: string; lane: LaneId; estimateMb: number; reason: string }
  | { kind: "acquire-denied"; at: number; lane: LaneId; estimateMb: number; reason: string; freeMb: number }
  | { kind: "acquire-queued"; at: number; lane: LaneId; estimateMb: number; waitForLane?: LaneId }
  | { kind: "evict-start"; at: number; ticket: string; lane: LaneId; reason: string }
  | { kind: "evict-done"; at: number; ticket: string; lane: LaneId; freedMb: number }
  | { kind: "evict-failed"; at: number; ticket: string; lane: LaneId; error: string }
  | { kind: "release"; at: number; ticket: string; lane: LaneId; heldMs: number }
  | { kind: "restore-scheduled"; at: number; lane: LaneId; modelId?: string }
  | { kind: "downgrade-swap"; at: number; lane: LaneId; fromModelId?: string; toModelId: string; freedMb: number }
  | { kind: "oom"; at: number; lane: LaneId; error: string }
  | { kind: "ledger"; at: number; snapshot: LedgerSnapshot };

export interface ResourceEventListener {
  (event: ResourceEvent): void;
}
