/**
 * Resource arbiter — every GPU load goes through here.
 *
 *   acquire({ lane, estimateMb, evicts, ttlMs, restoreOnIdle, reason })
 *   → AcquireResult { status, ticket?, freeAfterMb, ... }
 *
 *   release(ticket)
 *   touch(ticket)          // bump lastTouchAt so TTL doesn't fire
 *   reportOom(lane, error) // sidecar saw cuda OOM
 *   snapshot()             // current ledger + reservations
 *
 * Single-process. The deck server is single-process so we keep this in-memory.
 * The ledger module owns nvidia-smi polling and the event bus.
 *
 * Eviction policy:
 *   - hard: drop every non-sticky reservation whose lane is in EVICTABLE_BY[req.lane],
 *           call lane-adapters.unloadLane, wait until freeMb crosses estimate+reserve
 *           or the timeout fires.
 *   - soft: queue, wait up to ttlMs for someone to release.
 *   - none: deny on the spot.
 *
 * Restore-on-idle:
 *   evicted reservations with restoreOnIdle: true are remembered (lane,
 *   estimateMb, modelId, reason). When the ledger reports freeMb >=
 *   restoreThresholdMb AND no active reservations on heavier lanes, the
 *   most-recent restore entry is re-acquired.
 */

import { randomUUID } from "node:crypto";

import {
  emit,
  getSnapshot,
  refreshSnapshot,
  setReservationProvider,
  startLedgerPolling,
} from "./ledger";
import { unloadLane } from "./lane-adapters";
import {
  type AcquireRequest,
  type AcquireResult,
  type EvictMode,
  type LaneId,
  type Reservation,
  STICKY_LANES,
} from "./types";

// ---------------------------------------------------------------------------
// Static policy: which lanes can be evicted to make room for which other lanes.
// Read as "to admit a request on lane X, we may evict reservations on
// lanes EVICTABLE_BY[X]". Self-conflict is implicit — any lane evicts itself.
// ---------------------------------------------------------------------------

const EVICTABLE_BY: Record<LaneId, ReadonlySet<LaneId>> = {
  chat: new Set<LaneId>(["chat"]),                                       // chat doesn't evict others
  vision: new Set<LaneId>(["vision"]),                                   // shares chat lane usually
  tts: new Set<LaneId>(["tts"]),
  stt: new Set<LaneId>(["stt"]),
  image: new Set<LaneId>(["image", "audio", "3d", "video"]),
  audio: new Set<LaneId>(["image", "audio", "3d", "video"]),
  "3d": new Set<LaneId>(["image", "audio", "3d", "chat", "vision"]),     // 3D evicts chat
  video: new Set<LaneId>(["image", "audio", "3d", "video", "chat", "vision"]), // video evicts everything but voice
  omni: new Set<LaneId>(["chat", "vision", "tts", "stt", "omni"]),       // omni takes over the voice stack
};

const DEFAULT_TTL_MS = 0;                                                 // 0 = sticky
const PANIC_RESERVE_MB = (() => {
  const raw = process.env.DECK_VRAM_PANIC_MB;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 256;
})();
const EVICT_WAIT_TIMEOUT_MS = 30_000;
const RESTORE_HEADROOM_MB = 1024;

// ---------------------------------------------------------------------------
// State — pinned to globalThis so Next.js dev HMR doesn't wipe reservations
// between route handler invocations. In production the module loads once.
// ---------------------------------------------------------------------------

interface RestoreEntry {
  lane: LaneId;
  estimateMb: number;
  reason: string;
  modelId?: string;
  evictedAt: number;
  /**
   * If a downgrade-swap left a smaller reservation on the same lane, this
   * is its ticket. maybeRestore() drops it before re-acquiring the original
   * so the lane doesn't double-book during the restoration.
   */
  replacesTicket?: string;
}

interface QueuedRequest {
  req: AcquireRequest;
  resolve: (r: AcquireResult) => void;
  enqueuedAt: number;
  timer: NodeJS.Timeout;
}

interface ArbiterState {
  reservations: Map<string, Reservation>;
  restoreQueue: RestoreEntry[];
  queue: QueuedRequest[];
  booted: boolean;
  ttlSweepTimer: NodeJS.Timeout | null;
  unloadOverride: ((lane: LaneId, modelId?: string) => Promise<{ ok: boolean; via?: string; error?: string }>) | null;
}

const STATE_KEY = "__controlDeckArbiterState";

function getState(): ArbiterState {
  const g = globalThis as unknown as Record<string, ArbiterState | undefined>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      reservations: new Map<string, Reservation>(),
      restoreQueue: [],
      queue: [],
      booted: false,
      ttlSweepTimer: null,
      unloadOverride: null,
    };
  }
  return g[STATE_KEY]!;
}

const reservations = getState().reservations;
const restoreQueue = getState().restoreQueue;
const queue = getState().queue;

async function doUnload(lane: LaneId, modelId?: string) {
  const override = getState().unloadOverride;
  if (override) return override(lane, modelId);
  return unloadLane(lane, modelId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function ensureArbiterBooted(): void {
  const state = getState();
  if (state.booted) return;
  state.booted = true;
  setReservationProvider(() => Array.from(state.reservations.values()));
  startLedgerPolling();
  state.ttlSweepTimer = setInterval(() => sweepTtl(), 5_000);
  state.ttlSweepTimer.unref?.();
}

export async function acquire(req: AcquireRequest): Promise<AcquireResult> {
  ensureArbiterBooted();
  const evicts: EvictMode = req.evicts ?? (req.priority === "interactive" ? "soft" : "none");
  const priority = req.priority ?? "normal";
  const ttlMs = req.ttlMs ?? DEFAULT_TTL_MS;
  const restoreOnIdle = req.restoreOnIdle ?? STICKY_LANES.has(req.lane);

  await refreshSnapshot();
  const snap = getSnapshot();
  const reserveMb = snap.reserveMb;
  const freeMb = snap.freeMb;

  // Fast path — fits without evicting anything.
  if (freeMb >= req.estimateMb + reserveMb) {
    const ticket = grant(req, evicts, priority, ttlMs, restoreOnIdle);
    return {
      status: "granted",
      ticket: ticket.ticket,
      freeAfterMb: freeMb - req.estimateMb,
      reserveMb,
      reason: `granted (${freeMb - req.estimateMb} MB free after)`,
    };
  }

  // No headroom and caller refuses to evict.
  if (evicts === "none") {
    emit({
      kind: "acquire-denied",
      at: Date.now(),
      lane: req.lane,
      estimateMb: req.estimateMb,
      reason: `${req.estimateMb} MB needed but only ${freeMb} MB free (reserve ${reserveMb}). Caller declined eviction.`,
      freeMb,
    });
    return {
      status: "denied",
      freeAfterMb: freeMb - req.estimateMb,
      reserveMb,
      reason: `${req.estimateMb} MB needed, ${freeMb} MB free, reserve ${reserveMb}.`,
    };
  }

  if (evicts === "soft") {
    return enqueue(req, evicts, priority, ttlMs, restoreOnIdle, reserveMb, freeMb);
  }

  // Hard evict — find evictable holders, unload them, wait for the ledger to clear.
  const evictableLanes = EVICTABLE_BY[req.lane];
  const toEvict = Array.from(reservations.values()).filter((r) => evictableLanes.has(r.lane));
  if (toEvict.length === 0 && freeMb < req.estimateMb + reserveMb) {
    // Nothing we can evict, but caller asked for hard — still try the underlying
    // unloaders (e.g. ComfyUI workflow held memory without a ticket).
    await doUnload(req.lane, req.modelId).catch(() => null);
  }

  for (const victim of toEvict) {
    await evict(victim, `pre-empted by ${req.lane}: ${req.reason}`);
  }

  // Re-read ledger, see if we have room now.
  await refreshSnapshot();
  const after = getSnapshot();
  if (after.freeMb >= req.estimateMb + reserveMb) {
    const ticket = grant(req, evicts, priority, ttlMs, restoreOnIdle);
    return {
      status: "granted",
      ticket: ticket.ticket,
      freeAfterMb: after.freeMb - req.estimateMb,
      reserveMb,
      reason: `granted after evicting ${toEvict.length} reservation(s)`,
    };
  }

  // Eviction didn't free enough. Wait for the ledger to drop, up to the timeout.
  const dropped = await waitForFree(req.estimateMb + reserveMb, EVICT_WAIT_TIMEOUT_MS);
  if (dropped) {
    const ticket = grant(req, evicts, priority, ttlMs, restoreOnIdle);
    return {
      status: "granted",
      ticket: ticket.ticket,
      freeAfterMb: getSnapshot().freeMb - req.estimateMb,
      reserveMb,
      reason: `granted after eviction + ledger settle`,
    };
  }

  emit({
    kind: "acquire-denied",
    at: Date.now(),
    lane: req.lane,
    estimateMb: req.estimateMb,
    reason: `evicted ${toEvict.length} holders but ledger never freed enough VRAM`,
    freeMb: getSnapshot().freeMb,
  });
  return {
    status: "denied",
    freeAfterMb: getSnapshot().freeMb - req.estimateMb,
    reserveMb,
    reason: `eviction did not free enough VRAM within ${EVICT_WAIT_TIMEOUT_MS} ms`,
  };
}

export function release(ticket: string): boolean {
  const r = reservations.get(ticket);
  if (!r) return false;
  reservations.delete(ticket);
  emit({
    kind: "release",
    at: Date.now(),
    ticket,
    lane: r.lane,
    heldMs: Date.now() - r.acquiredAt,
  });
  pumpQueue();
  void maybeRestore();
  return true;
}

export function touch(ticket: string): boolean {
  const r = reservations.get(ticket);
  if (!r) return false;
  r.lastTouchAt = Date.now();
  return true;
}

export async function reportOom(lane: LaneId, error: string): Promise<void> {
  emit({ kind: "oom", at: Date.now(), lane, error });
  // Drop every reservation on this lane to flush whatever leaked.
  for (const [ticket, r] of reservations) {
    if (r.lane === lane) {
      reservations.delete(ticket);
      emit({ kind: "release", at: Date.now(), ticket, lane, heldMs: Date.now() - r.acquiredAt });
    }
  }
  // Force-unload the lane just in case the failing process didn't free its weights.
  await doUnload(lane).catch(() => null);
  await refreshSnapshot();
  pumpQueue();
}

export function snapshot() {
  return getSnapshot();
}

export function listReservations(): Reservation[] {
  return Array.from(reservations.values());
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function grant(
  req: AcquireRequest,
  evicts: EvictMode,
  priority: AcquireRequest["priority"],
  ttlMs: number,
  restoreOnIdle: boolean,
): Reservation {
  const ticket = randomUUID();
  const now = Date.now();
  const r: Reservation = {
    ticket,
    lane: req.lane,
    estimateMb: req.estimateMb,
    reason: req.reason,
    priority: priority ?? "normal",
    evicts,
    restoreOnIdle,
    modelId: req.modelId,
    swapTo: req.swapTo,
    acquiredAt: now,
    lastTouchAt: now,
    ttlMs,
  };
  reservations.set(ticket, r);
  emit({
    kind: "acquire-granted",
    at: now,
    ticket,
    lane: r.lane,
    estimateMb: r.estimateMb,
    reason: r.reason,
  });
  return r;
}

async function evict(victim: Reservation, reason: string): Promise<void> {
  emit({ kind: "evict-start", at: Date.now(), ticket: victim.ticket, lane: victim.lane, reason });
  reservations.delete(victim.ticket);

  // Smaller-while-busy: if the victim declared a swap target, unload the
  // current model but keep the lane warm at the smaller shape. The arbiter
  // inserts a fresh reservation for the swap target and queues the original
  // for restore-on-idle (so the user's preferred big model comes back later).
  if (victim.swapTo) {
    const before = getSnapshot().freeMb;
    const unloaded = await doUnload(victim.lane, victim.modelId);
    await refreshSnapshot();
    const after = getSnapshot().freeMb;
    if (unloaded.ok) {
      const swapTicket = randomUUID();
      const now = Date.now();
      reservations.set(swapTicket, {
        ticket: swapTicket,
        lane: victim.lane,
        estimateMb: victim.swapTo.estimateMb,
        reason: `downgrade for ${reason}`,
        priority: victim.priority,
        evicts: victim.evicts,
        // Don't carry restoreOnIdle on the downgraded shape — the *original*
        // is the thing we want back, and that's already in restoreQueue.
        restoreOnIdle: false,
        modelId: victim.swapTo.modelId,
        acquiredAt: now,
        lastTouchAt: now,
        ttlMs: victim.ttlMs,
      });
      if (victim.restoreOnIdle) {
        restoreQueue.unshift({
          lane: victim.lane,
          estimateMb: victim.estimateMb,
          reason: victim.reason,
          modelId: victim.modelId,
          evictedAt: now,
          replacesTicket: swapTicket,
        });
        emit({ kind: "restore-scheduled", at: now, lane: victim.lane, modelId: victim.modelId });
      }
      emit({
        kind: "downgrade-swap",
        at: now,
        lane: victim.lane,
        fromModelId: victim.modelId,
        toModelId: victim.swapTo.modelId,
        freedMb: Math.max(0, after - before),
      });
      emit({
        kind: "evict-done",
        at: now,
        ticket: victim.ticket,
        lane: victim.lane,
        freedMb: Math.max(0, after - before),
      });
      return;
    }
    // Unload failed — fall through to the full-evict path below to surface the error.
    emit({
      kind: "evict-failed",
      at: Date.now(),
      ticket: victim.ticket,
      lane: victim.lane,
      error: unloaded.error ?? "swap unload failed",
    });
  }

  if (victim.restoreOnIdle) {
    restoreQueue.unshift({
      lane: victim.lane,
      estimateMb: victim.estimateMb,
      reason: victim.reason,
      modelId: victim.modelId,
      evictedAt: Date.now(),
    });
    emit({ kind: "restore-scheduled", at: Date.now(), lane: victim.lane, modelId: victim.modelId });
  }
  const before = getSnapshot().freeMb;
  const res = await doUnload(victim.lane, victim.modelId);
  await refreshSnapshot();
  const after = getSnapshot().freeMb;
  if (res.ok) {
    emit({
      kind: "evict-done",
      at: Date.now(),
      ticket: victim.ticket,
      lane: victim.lane,
      freedMb: Math.max(0, after - before),
    });
  } else {
    emit({
      kind: "evict-failed",
      at: Date.now(),
      ticket: victim.ticket,
      lane: victim.lane,
      error: res.error ?? "unknown",
    });
  }
}

async function waitForFree(neededMb: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await refreshSnapshot();
    if (getSnapshot().freeMb >= neededMb) return true;
    await sleep(500);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function enqueue(
  req: AcquireRequest,
  evicts: EvictMode,
  priority: AcquireRequest["priority"],
  ttlMs: number,
  restoreOnIdle: boolean,
  reserveMb: number,
  freeMb: number,
): Promise<AcquireResult> {
  return new Promise<AcquireResult>((resolve) => {
    const enqueuedAt = Date.now();
    const waitMs = req.ttlMs ?? 30_000;
    const timer = setTimeout(() => {
      const idx = queue.findIndex((q) => q.enqueuedAt === enqueuedAt && q.req === req);
      if (idx >= 0) queue.splice(idx, 1);
      resolve({
        status: "denied",
        freeAfterMb: getSnapshot().freeMb - req.estimateMb,
        reserveMb,
        reason: `soft acquire timed out after ${waitMs} ms`,
      });
    }, waitMs);
    timer.unref?.();
    queue.push({ req: { ...req, evicts, priority, ttlMs, restoreOnIdle }, resolve, enqueuedAt, timer });
    emit({
      kind: "acquire-queued",
      at: enqueuedAt,
      lane: req.lane,
      estimateMb: req.estimateMb,
      waitForLane: heaviestHolderLane(),
    });
    // Caller can't be told a freeAfterMb yet — but we mark the queued event for the UI.
    // Resolving happens later via pumpQueue().
    return { freeMb };
  });
}

function heaviestHolderLane(): LaneId | undefined {
  let lane: LaneId | undefined;
  let biggest = -1;
  for (const r of reservations.values()) {
    if (r.estimateMb > biggest) {
      biggest = r.estimateMb;
      lane = r.lane;
    }
  }
  return lane;
}

function pumpQueue(): void {
  if (queue.length === 0) return;
  // Try each queued request in FIFO order; first-fit serves.
  const snap = getSnapshot();
  for (let i = 0; i < queue.length; ) {
    const q = queue[i];
    if (snap.freeMb >= q.req.estimateMb + snap.reserveMb) {
      const r = grant(q.req, q.req.evicts ?? "none", q.req.priority, q.req.ttlMs ?? 0, q.req.restoreOnIdle ?? false);
      clearTimeout(q.timer);
      q.resolve({
        status: "granted",
        ticket: r.ticket,
        freeAfterMb: snap.freeMb - q.req.estimateMb,
        reserveMb: snap.reserveMb,
        reason: "granted from queue",
      });
      queue.splice(i, 1);
    } else {
      i++;
    }
  }
}

async function maybeRestore(): Promise<void> {
  if (restoreQueue.length === 0) return;
  await refreshSnapshot();
  const snap = getSnapshot();
  // Skip restore if any heavy lane is still active.
  for (const r of reservations.values()) {
    if (r.lane === "3d" || r.lane === "video" || r.lane === "image" || r.lane === "audio") return;
  }
  const next = restoreQueue[0];
  if (!next) return;
  // If a downgrade swap is sitting on the lane, count its VRAM as recoverable
  // headroom — we'll drop it before re-acquiring the original.
  const downgradeMb =
    next.replacesTicket && reservations.get(next.replacesTicket)?.estimateMb || 0;
  if (snap.freeMb + downgradeMb < next.estimateMb + snap.reserveMb + RESTORE_HEADROOM_MB) return;
  restoreQueue.shift();
  if (next.replacesTicket) {
    const downgrade = reservations.get(next.replacesTicket);
    if (downgrade) {
      reservations.delete(next.replacesTicket);
      // Tell the lane to unload the smaller model so the original can lazy-load.
      await doUnload(downgrade.lane, downgrade.modelId).catch(() => null);
      await refreshSnapshot();
      emit({
        kind: "release",
        at: Date.now(),
        ticket: next.replacesTicket,
        lane: downgrade.lane,
        heldMs: Date.now() - downgrade.acquiredAt,
      });
    }
  }
  // Best-effort silent re-acquire. Failures just drop the entry.
  await acquire({
    lane: next.lane,
    estimateMb: next.estimateMb,
    reason: `restore: ${next.reason}`,
    modelId: next.modelId,
    evicts: "none",
    restoreOnIdle: true,
    priority: "background",
  }).catch(() => null);
}

function sweepTtl(): void {
  const now = Date.now();
  for (const [ticket, r] of reservations) {
    if (r.ttlMs > 0 && now - r.lastTouchAt > r.ttlMs) {
      reservations.delete(ticket);
      emit({ kind: "release", at: now, ticket, lane: r.lane, heldMs: now - r.acquiredAt });
    }
  }
  void maybeRestore();
}

export const __test = {
  reset() {
    const state = getState();
    state.reservations.clear();
    state.restoreQueue.length = 0;
    state.queue.forEach((q) => clearTimeout(q.timer));
    state.queue.length = 0;
    state.booted = false;
    state.unloadOverride = null;
    if (state.ttlSweepTimer) {
      clearInterval(state.ttlSweepTimer);
      state.ttlSweepTimer = null;
    }
  },
  setUnloadOverride(fn: ((lane: LaneId, modelId?: string) => Promise<{ ok: boolean; via?: string; error?: string }>) | null) {
    getState().unloadOverride = fn;
  },
  get reservations() { return getState().reservations; },
  get restoreQueue() { return getState().restoreQueue; },
  get queue() { return getState().queue; },
  EVICTABLE_BY,
  PANIC_RESERVE_MB,
};
