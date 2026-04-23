/**
 * Workspace pane bus — two channels:
 *
 *   call(target, capability, args)   — addressable request/response
 *   publish(paneId, topic, event)    — ambient, tracked against producer's
 *                                       declared rate ceiling
 *   subscribe(target, topic, h, opt) — rate-contracted consumer
 *
 * No unbounded firehose: every subscription must pick a RateMode.
 * Producers declare an expected rate ceiling; if actual > 3× expected
 * sustained for WATCHDOG_WINDOW_MS, the bus auto-throttles the topic
 * internally (coalesces) and emits a warning to the inspector.
 *
 * Store is module-global but lives behind `globalThis` so Next's HMR
 * doesn't double-register panes across reloads (same pattern as koffi
 * bindings in windows-input.ts).
 */

import {
  CapabilityNotFoundError,
  InvalidRateModeError,
  PaneNotFoundError,
  type CapabilitySpec,
  type PaneHandle,
  type PaneId,
  type PaneSnapshot,
  type RateMode,
  type RegisterPaneArgs,
  type SubscribeOptions,
  type TopicSpec,
} from "./types";

const BUS_KEY = "__controlDeckWorkspaceBus";

// Watchdog: rolling window for rate-vs-declared comparison.
const WATCHDOG_WINDOW_MS = 5_000;
const AUTO_THROTTLE_MULTIPLIER = 3;
/** After auto-throttling, coalesce into this window until violation clears. */
const AUTO_THROTTLE_MS = 250;
const VALID_MODES: ReadonlyArray<RateMode> = [
  "throttle",
  "debounce",
  "coalesce",
  "latest-only",
];

// ── per-pane state ───────────────────────────────────────────────────

interface RegisteredPane {
  handle: PaneHandle;
  capabilities: Record<string, CapabilitySpec>;
  topics: Record<string, TopicSpec>;
  onUnmount?: () => void;
}

interface Subscription {
  paneId: PaneId;
  topic: string;
  mode: RateMode;
  ms: number;
  maxBacklog: number;
  handler: (event: unknown) => void;

  // Per-mode scratch state.
  lastFireAt: number;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  buffered: unknown[];
  latest: { value: unknown; present: boolean };
}

interface RateTracker {
  /** Sliding-window timestamps of recent publishes. */
  stamps: number[];
  /** Unix-ms when auto-throttle was most recently engaged (0 = not). */
  throttledSince: number;
}

interface BusState {
  panes: Map<PaneId, RegisteredPane>;
  subs: Map<string, Set<Subscription>>; // key: `${paneId}:${topic}`
  rates: Map<string, RateTracker>;      // key: `${paneId}:${topic}`
  warnings: Array<{ at: number; paneId: PaneId; topic: string; actual: number; expected: number }>;
}

function getBus(): BusState {
  const g = globalThis as Record<string, unknown>;
  if (!g[BUS_KEY]) {
    const fresh: BusState = {
      panes: new Map(),
      subs: new Map(),
      rates: new Map(),
      warnings: [],
    };
    g[BUS_KEY] = fresh;
  }
  return g[BUS_KEY] as BusState;
}

// ── registration ─────────────────────────────────────────────────────

/**
 * Register a pane with the bus. Returns an unregister function —
 * always call it when the pane unmounts, or the bus leaks capability
 * references.
 */
export function registerPane(args: RegisterPaneArgs): () => void {
  const bus = getBus();
  bus.panes.set(args.handle.id, {
    handle: args.handle,
    capabilities: args.capabilities ?? {},
    topics: args.topics ?? {},
    onUnmount: args.onUnmount,
  });
  return () => unregisterPane(args.handle.id);
}

export function unregisterPane(paneId: PaneId): void {
  const bus = getBus();
  const pane = bus.panes.get(paneId);
  if (!pane) return;
  try { pane.onUnmount?.(); } catch { /* never let a teardown throw */ }
  bus.panes.delete(paneId);

  // Drop subs targeting this pane (the pane is gone — they'd leak otherwise).
  for (const [key, set] of bus.subs) {
    if (key.startsWith(`${paneId}:`)) {
      for (const sub of set) {
        if (sub.pendingTimer) clearTimeout(sub.pendingTimer);
      }
      bus.subs.delete(key);
    }
  }
  // Also clear rate trackers.
  for (const key of bus.rates.keys()) {
    if (key.startsWith(`${paneId}:`)) bus.rates.delete(key);
  }
}

export function listPanes(): PaneSnapshot[] {
  const bus = getBus();
  const snapshots: PaneSnapshot[] = [];
  for (const pane of bus.panes.values()) {
    const topics = Object.entries(pane.topics).map(([name, spec]) => {
      const rate = currentRate(pane.handle.id, name);
      return {
        name,
        expectedRatePerSec: spec.expectedRatePerSec,
        actualRatePerSec: rate,
        priority: spec.priority,
      };
    });
    const autoThrottled: string[] = [];
    for (const name of Object.keys(pane.topics)) {
      const tracker = bus.rates.get(`${pane.handle.id}:${name}`);
      if (tracker?.throttledSince) autoThrottled.push(name);
    }
    snapshots.push({
      handle: pane.handle,
      capabilities: Object.entries(pane.capabilities).map(([name, spec]) => ({
        name, description: spec.description,
      })),
      topics,
      autoThrottled,
    });
  }
  return snapshots;
}

export function getPane(paneId: PaneId): PaneHandle | undefined {
  return getBus().panes.get(paneId)?.handle;
}

// ── call channel ─────────────────────────────────────────────────────

/**
 * Invoke a capability on another pane. Throws if the pane or
 * capability doesn't exist — callers should handle the rejection
 * (panes come and go as they unmount).
 */
export async function call<TArgs = unknown, TResult = unknown>(
  target: PaneId,
  capability: string,
  args?: TArgs,
): Promise<TResult> {
  const bus = getBus();
  const pane = bus.panes.get(target);
  if (!pane) throw new PaneNotFoundError(target);
  const cap = pane.capabilities[capability];
  if (!cap) throw new CapabilityNotFoundError(target, capability);
  return Promise.resolve(cap.handler(args)) as Promise<TResult>;
}

// ── publish / subscribe ──────────────────────────────────────────────

/**
 * Publish an event on a topic. The producing pane should declare
 * `topics[name]` at `registerPane` time so the bus can watchdog its
 * rate.
 */
export function publish(paneId: PaneId, topic: string, event: unknown): void {
  const bus = getBus();
  const key = `${paneId}:${topic}`;
  trackRate(paneId, topic);

  const subs = bus.subs.get(key);
  if (!subs || subs.size === 0) return;

  // If the producer is currently auto-throttled, all subscribers get
  // the event coalesced via `coalesce` semantics at AUTO_THROTTLE_MS
  // regardless of their requested mode. This is the watchdog defense.
  const tracker = bus.rates.get(key);
  const throttled = Boolean(tracker?.throttledSince);

  for (const sub of subs) {
    if (throttled && sub.mode !== "coalesce" && sub.mode !== "latest-only") {
      // Force-coalesce under watchdog.
      pushToSub({ ...sub, mode: "coalesce", ms: AUTO_THROTTLE_MS }, event);
    } else {
      pushToSub(sub, event);
    }
  }
}

export function subscribe(
  target: PaneId,
  topic: string,
  handler: (event: unknown) => void,
  opts: SubscribeOptions,
): () => void {
  if (!VALID_MODES.includes(opts.mode)) throw new InvalidRateModeError(opts.mode);
  if (!Number.isFinite(opts.ms) || opts.ms < 16) {
    throw new Error(`subscribe ms must be >= 16 (got ${opts.ms})`);
  }

  const bus = getBus();
  const key = `${target}:${topic}`;
  const sub: Subscription = {
    paneId: target,
    topic,
    mode: opts.mode,
    ms: opts.ms,
    maxBacklog: opts.maxBacklog ?? 64,
    handler,
    lastFireAt: 0,
    pendingTimer: null,
    buffered: [],
    latest: { value: undefined, present: false },
  };

  let set = bus.subs.get(key);
  if (!set) {
    set = new Set();
    bus.subs.set(key, set);
  }
  set.add(sub);

  return () => {
    if (sub.pendingTimer) clearTimeout(sub.pendingTimer);
    set!.delete(sub);
    if (set!.size === 0) bus.subs.delete(key);
  };
}

// ── rate mode dispatch ───────────────────────────────────────────────

function pushToSub(sub: Subscription, event: unknown): void {
  const now = Date.now();
  switch (sub.mode) {
    case "throttle":
      if (now - sub.lastFireAt >= sub.ms) {
        sub.lastFireAt = now;
        invoke(sub, event);
      }
      // else: dropped — this is throttle semantics
      break;

    case "debounce":
      if (sub.pendingTimer) clearTimeout(sub.pendingTimer);
      sub.latest = { value: event, present: true };
      sub.pendingTimer = setTimeout(() => {
        sub.pendingTimer = null;
        const { value } = sub.latest;
        sub.latest = { value: undefined, present: false };
        invoke(sub, value);
      }, sub.ms);
      break;

    case "coalesce":
      sub.buffered.push(event);
      if (sub.buffered.length > sub.maxBacklog) {
        sub.buffered.splice(0, sub.buffered.length - sub.maxBacklog);
      }
      if (!sub.pendingTimer) {
        sub.pendingTimer = setTimeout(() => {
          sub.pendingTimer = null;
          const batch = sub.buffered;
          sub.buffered = [];
          invoke(sub, batch);
        }, sub.ms);
      }
      break;

    case "latest-only":
      sub.latest = { value: event, present: true };
      if (now - sub.lastFireAt >= sub.ms) {
        sub.lastFireAt = now;
        invoke(sub, sub.latest.value);
        sub.latest = { value: undefined, present: false };
      } else if (!sub.pendingTimer) {
        const wait = sub.ms - (now - sub.lastFireAt);
        sub.pendingTimer = setTimeout(() => {
          sub.pendingTimer = null;
          if (sub.latest.present) {
            sub.lastFireAt = Date.now();
            invoke(sub, sub.latest.value);
            sub.latest = { value: undefined, present: false };
          }
        }, wait);
      }
      break;
  }
}

function invoke(sub: Subscription, event: unknown): void {
  try { sub.handler(event); }
  catch (err) {
    console.error(`[workspace.bus] subscriber for ${sub.paneId}:${sub.topic} threw:`, err);
  }
}

// ── rate tracker + auto-throttle ─────────────────────────────────────

function trackRate(paneId: PaneId, topic: string): void {
  const bus = getBus();
  const key = `${paneId}:${topic}`;
  let tracker = bus.rates.get(key);
  if (!tracker) {
    tracker = { stamps: [], throttledSince: 0 };
    bus.rates.set(key, tracker);
  }
  const now = Date.now();
  tracker.stamps.push(now);

  // Trim old stamps.
  const cutoff = now - WATCHDOG_WINDOW_MS;
  while (tracker.stamps.length && tracker.stamps[0] < cutoff) tracker.stamps.shift();

  // Check against declared rate.
  const pane = bus.panes.get(paneId);
  const expected = pane?.topics[topic]?.expectedRatePerSec ?? Infinity;
  if (!Number.isFinite(expected)) return;

  const actual = (tracker.stamps.length / WATCHDOG_WINDOW_MS) * 1000;
  const ceiling = expected * AUTO_THROTTLE_MULTIPLIER;

  if (actual > ceiling) {
    if (!tracker.throttledSince) {
      tracker.throttledSince = now;
      bus.warnings.push({ at: now, paneId, topic, actual, expected });
      // Keep warnings bounded.
      if (bus.warnings.length > 64) bus.warnings.splice(0, bus.warnings.length - 64);
    }
  } else if (tracker.throttledSince && actual <= expected) {
    // Fully recovered — back under declared rate.
    tracker.throttledSince = 0;
  }
}

function currentRate(paneId: PaneId, topic: string): number {
  const tracker = getBus().rates.get(`${paneId}:${topic}`);
  if (!tracker) return 0;
  return (tracker.stamps.length / WATCHDOG_WINDOW_MS) * 1000;
}

// ── debug + inspector surface ────────────────────────────────────────

export function getWarnings(): ReadonlyArray<{
  at: number; paneId: PaneId; topic: string; actual: number; expected: number;
}> {
  return getBus().warnings;
}

/** For tests only. Clears the entire bus. */
export function __resetBus(): void {
  const bus = getBus();
  for (const [, set] of bus.subs) {
    for (const sub of set) if (sub.pendingTimer) clearTimeout(sub.pendingTimer);
  }
  bus.panes.clear();
  bus.subs.clear();
  bus.rates.clear();
  bus.warnings.length = 0;
}
